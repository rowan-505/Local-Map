"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { Card, CardContent } from "@/src/components/ui/card";
import {
    getImportReviewSummary,
    isAbortError,
    type ImportReviewSummaryBucketRow,
    type ImportReviewSummaryResponse,
} from "@/src/lib/api";
import {
    applyImportReviewScopeSearchParams,
    reviewBatchIdFromImportReviewSearch,
    snapshotVersionFromImportReviewSearch,
} from "@/src/lib/importReviewSnapshot";

const FAMILIES = ["buildings", "places", "roads"] as const;
type Family = (typeof FAMILIES)[number];

const FAMILY_LABEL: Record<Family, string> = {
    buildings: "Buildings",
    places: "Places",
    roads: "Roads",
};

type LoadedScope =
    | { kind: "source_snapshot"; value: string }
    | { kind: "review_batch"; value: string };

function lc(s: string | null | undefined): string {
    return (s ?? "").trim().toLowerCase();
}

function sumBucketWhere(
    rows: ImportReviewSummaryBucketRow[],
    pred: (r: ImportReviewSummaryBucketRow) => boolean
): number {
    let n = 0;
    for (const r of rows) {
        if (pred(r)) {
            n += r.row_count;
        }
    }
    return n;
}

function rollupFromSummaries(rows: ImportReviewSummaryBucketRow[]) {
    const pending = rows.reduce((s, r) => s + r.row_count, 0); // API total_pending is authoritative; we'll show API field

    const needsReview = sumBucketWhere(
        rows,
        (r) =>
            lc(r.review_status) === "needs_review" ||
            lc(r.review_status) === "needs_more_review" ||
            lc(r.review_decision) === "needs_more_review"
    );
    const ignored = sumBucketWhere(
        rows,
        (r) => lc(r.review_decision) === "ignored" || lc(r.review_status) === "ignored"
    );
    const merged = sumBucketWhere(
        rows,
        (r) => lc(r.review_decision) === "merged" || lc(r.review_status) === "merged"
    );
    const promoted = sumBucketWhere(rows, (r) => lc(r.promotion_status) === "promoted");
    const promotionFailed = sumBucketWhere(rows, (r) => lc(r.promotion_status) === "promotion_failed");
    const readyForPublish = sumBucketWhere(
        rows,
        (r) =>
            lc(r.review_decision) === "approved" &&
            lc(r.review_status) === "approved" &&
            lc(r.promotion_status) !== "promoted" &&
            lc(r.promotion_status) !== "promotion_failed"
    );

    void pending;
    const buildings = sumBucketWhere(rows, (r) => lc(r.entity_family) === "buildings");
    const places = sumBucketWhere(rows, (r) => lc(r.entity_family) === "places");
    const roads = sumBucketWhere(rows, (r) => lc(r.entity_family) === "roads");
    const totalCandidates = buildings + places + roads;

    return {
        buildings,
        places,
        roads,
        totalCandidates,
        needsReview,
        ignored,
        merged,
        promoted,
        promotionFailed,
        readyForPublish,
    };
}

function SectionTitle({ title, subtitle, id }: { title: string; subtitle?: string; id?: string }) {
    return (
        <div className="mb-4">
            <h2 id={id} className="text-lg font-semibold tracking-tight text-gray-900">
                {title}
            </h2>
            {subtitle ? <p className="mt-1 text-sm text-gray-600">{subtitle}</p> : null}
        </div>
    );
}

function aggregateBy(
    rows: ImportReviewSummaryBucketRow[],
    key: "match_status" | "auto_action" | "review_decision" | "promotion_status"
): Record<string, number> {
    const m: Record<string, number> = {};

    for (const r of rows) {
        const raw = r[key];
        const label = raw === null || raw === undefined || raw === "" ? "(empty)" : raw;
        m[label] = (m[label] ?? 0) + r.row_count;
    }

    return m;
}

function BreakdownBlock({
    title,
    counts,
}: {
    title: string;
    counts: Record<string, number>;
}) {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    if (entries.length === 0) {
        return (
            <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
                <p className="mt-2 text-sm text-gray-500">No rows in this bucket.</p>
            </div>
        );
    }

    return (
        <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
            <dl className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1 text-sm">
                {entries.map(([k, v]) => (
                    <div key={`${title}-${k}`} className="flex justify-between gap-4">
                        <dt className="min-w-0 truncate text-gray-600" title={k}>
                            {k}
                        </dt>
                        <dd className="shrink-0 tabular-nums font-medium text-gray-900">{v.toLocaleString()}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

function snapshotOptionsFromEnv(): string[] {
    const raw = process.env.NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_OPTIONS?.trim();
    if (!raw) {
        return [];
    }

    return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

function ImportReviewSummaryInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const urlVersion = snapshotVersionFromImportReviewSearch(searchParams);
    const urlBatch = reviewBatchIdFromImportReviewSearch(searchParams);
    const envDefault = process.env.NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_VERSION?.trim() ?? "";
    const presetOptions = useMemo(() => snapshotOptionsFromEnv(), []);

    const [versionInput, setVersionInput] = useState(
        () => (urlBatch ? "" : urlVersion || envDefault || presetOptions[0] || "")
    );
    const [batchInput, setBatchInput] = useState(() => urlBatch || "");
    const [data, setData] = useState<ImportReviewSummaryResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [lastLoaded, setLastLoaded] = useState<LoadedScope | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    useEffect(() => {
        setVersionInput(urlBatch ? "" : urlVersion || envDefault || presetOptions[0] || "");
    }, [urlVersion, envDefault, presetOptions, urlBatch]);

    useEffect(() => {
        setBatchInput(urlBatch || "");
    }, [urlBatch]);

    const load = useCallback(
        async (
            opts: {
                snapshotVersion: string;
                reviewBatchId: string;
                signal?: AbortSignal;
                syncUrl: boolean;
            }
        ): Promise<boolean> => {
            const snap = opts.snapshotVersion.trim();
            const batch = opts.reviewBatchId.trim();

            if (!snap && !batch) {
                setError("Provide source_snapshot_version or review_batch_id.");
                setData(null);
                setLastLoaded(null);
                setLastUpdated(null);
                return false;
            }
            if (snap && batch) {
                setError("Use only one of source_snapshot_version or review_batch_id.");
                setData(null);
                setLastLoaded(null);
                setLastUpdated(null);
                return false;
            }

            const query = snap
                ? { source_snapshot_version: snap }
                : { review_batch_id: batch };

            setIsLoading(true);
            setError("");

            try {
                const response = await getImportReviewSummary(
                    query,
                    opts.signal ? { signal: opts.signal } : undefined
                );
                setData(response);
                setLastLoaded(
                    snap ? { kind: "source_snapshot", value: snap } : { kind: "review_batch", value: batch }
                );
                setLastUpdated(new Date());
                if (opts.syncUrl) {
                    const params = new URLSearchParams(searchParams.toString());
                    applyImportReviewScopeSearchParams(params, snap, batch);
                    router.replace(`/import-review?${params.toString()}`, { scroll: false });
                }
                return true;
            } catch (err) {
                if (isAbortError(err)) {
                    return false;
                }
                setError(formatImportReviewUiError(err));
                setData(null);
                setLastLoaded(null);
                setLastUpdated(null);
                return false;
            } finally {
                setIsLoading(false);
            }
        },
        [router, searchParams]
    );

    function formatImportReviewUiError(err: unknown): string {
        if (!(err instanceof Error)) {
            return "Failed to load import review summary.";
        }
        const m = err.message;
        if (m.includes("401") || m.toLowerCase().includes("authentication")) {
            return "Unauthorized — sign in as an admin. Import review endpoints are admin-only.";
        }
        if (m.includes("403") || m.toLowerCase().includes("admin")) {
            return "Forbidden — import review requires an admin-capable token.";
        }
        return m;
    }

    const loadRef = useRef(load);
    loadRef.current = load;

    const firstPreset = presetOptions[0] ?? "";
    const chosenSnapshot = urlBatch ? "" : urlVersion || envDefault || firstPreset;
    const chosenBatch = urlBatch;

    useEffect(() => {
        if (chosenBatch) {
            const controller = new AbortController();
            void loadRef.current({
                snapshotVersion: "",
                reviewBatchId: chosenBatch,
                signal: controller.signal,
                syncUrl: false,
            });
            return () => controller.abort();
        }
        const v = chosenSnapshot.trim();
        if (!v) {
            return;
        }
        const controller = new AbortController();
        void loadRef.current({
            snapshotVersion: v,
            reviewBatchId: "",
            signal: controller.signal,
            syncUrl: false,
        });
        return () => controller.abort();
    }, [chosenBatch, chosenSnapshot]);

    const rollups = useMemo(() => (data ? rollupFromSummaries(data.entity_summaries) : null), [data]);

    const familyRows = useCallback(
        (family: Family) => {
            if (!data) {
                return [];
            }
            return data.entity_summaries.filter((r) => lc(r.entity_family) === family);
        },
        [data]
    );

    const scopeForLinks =
        lastLoaded ??
        (batchInput.trim()
            ? ({ kind: "review_batch", value: batchInput.trim() } satisfies LoadedScope)
            : versionInput.trim()
              ? ({ kind: "source_snapshot", value: versionInput.trim() } satisfies LoadedScope)
              : null);

    const reviewHref = (segment: "buildings" | "places" | "roads") => {
        const p = new URLSearchParams();
        if (!scopeForLinks) {
            return `/import-review/${segment}`;
        }
        if (scopeForLinks.kind === "review_batch") {
            p.set("review_batch_id", scopeForLinks.value);
        } else {
            p.set("source_snapshot_version", scopeForLinks.value);
        }
        const qs = p.toString();
        return qs ? `/import-review/${segment}?${qs}` : `/import-review/${segment}`;
    };

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-10">
                <header className="border-b border-gray-200 pb-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Import review</h1>
                            <p className="mt-1 max-w-2xl text-sm text-gray-600">
                                Review-package snapshot from Supabase{" "}
                                <code className="rounded bg-gray-100 px-1 text-xs">import_review</code> via the API (
                                grouped candidate counts). Promotion to core ships later — this dashboard only edits
                                review candidates.
                            </p>
                            <p className="mt-2 text-xs text-gray-500">
                                Data source: <strong>Supabase import_review</strong> (dashboard uses{" "}
                                <code className="rounded bg-gray-50 px-1">NEXT_PUBLIC_API_BASE_URL</code> only — no DB
                                connection here).
                            </p>
                        </div>
                        {lastUpdated && lastLoaded ? (
                            <div className="shrink-0 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                                {lastLoaded.kind === "source_snapshot" ? (
                                    <>
                                        <span className="text-gray-500">Source snapshot </span>
                                        <span className="font-medium text-gray-900">{lastLoaded.value}</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-gray-500">Review batch ID </span>
                                        <span className="font-mono font-medium text-gray-900">{lastLoaded.value}</span>
                                    </>
                                )}
                                <span className="mx-1 text-gray-400">·</span>
                                <time dateTime={lastUpdated.toISOString()} className="font-medium text-gray-900">
                                    {lastUpdated.toLocaleString()}
                                </time>
                            </div>
                        ) : null}
                    </div>

                    <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                        <div className="flex min-w-0 flex-col gap-1">
                            <label htmlFor="source-snapshot-version" className="text-xs font-medium text-gray-600">
                                Source snapshot version
                            </label>
                            <input
                                id="source-snapshot-version"
                                type="text"
                                value={versionInput}
                                onChange={(e) => setVersionInput(e.target.value)}
                                placeholder="Xor with review_batch_id"
                                disabled={Boolean(batchInput.trim())}
                                className="w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-100"
                                autoComplete="off"
                                list="import-review-snapshot-presets"
                            />
                            {presetOptions.length > 0 ? (
                                <datalist id="import-review-snapshot-presets">
                                    {presetOptions.map((opt) => (
                                        <option key={opt} value={opt} />
                                    ))}
                                </datalist>
                            ) : null}
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                            <label htmlFor="review-batch-id" className="text-xs font-medium text-gray-600">
                                Review batch ID
                            </label>
                            <input
                                id="review-batch-id"
                                type="text"
                                inputMode="numeric"
                                value={batchInput}
                                onChange={(e) => setBatchInput(e.target.value)}
                                placeholder="Xor with source_snapshot_version"
                                disabled={Boolean(versionInput.trim())}
                                className="w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-100"
                                autoComplete="off"
                            />
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                            {presetOptions.length > 0 ? (
                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <label htmlFor="snapshot-preset" className="text-xs font-medium text-gray-600">
                                        Snapshot presets
                                    </label>
                                    <select
                                        id="snapshot-preset"
                                        value={
                                            batchInput.trim() ? "" : presetOptions.includes(versionInput) ? versionInput : ""
                                        }
                                        disabled={Boolean(batchInput.trim())}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (v) {
                                                setBatchInput("");
                                                setVersionInput(v);
                                            }
                                        }}
                                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-100"
                                    >
                                        <option value="">—</option>
                                        {presetOptions.map((opt) => (
                                            <option key={opt} value={opt}>
                                                {opt}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ) : null}
                            <button
                                type="button"
                                onClick={() =>
                                    void load({
                                        snapshotVersion: versionInput,
                                        reviewBatchId: batchInput,
                                        syncUrl: true,
                                    })
                                }
                                disabled={isLoading}
                                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-50"
                            >
                                {isLoading ? "Loading…" : "Load summary"}
                            </button>
                        </div>
                    </div>
                </header>

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 whitespace-pre-wrap">
                        {error}
                    </div>
                ) : null}

                {data?.warnings?.length ? (
                    <div
                        role="status"
                        className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 whitespace-pre-wrap"
                    >
                        <div className="font-semibold">Summary warnings</div>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                            {(data.warnings ?? []).map((w) => (
                                <li key={w}>{w}</li>
                            ))}
                        </ul>
                    </div>
                ) : null}

                {data && rollups ? (
                    <>
                        <section aria-labelledby="import-review-scope-counts">
                            <SectionTitle
                                id="import-review-scope-counts"
                                title="By entity family"
                                subtitle="Totals rolled up across match/auto/review buckets (disjoint partitions of candidates)."
                            />
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                <StatsCard title="Buildings candidates" value={rollups.buildings} />
                                <StatsCard title="Places candidates" value={rollups.places} />
                                <StatsCard title="Roads candidates" value={rollups.roads} />
                                <StatsCard
                                    title="All entities (sum)"
                                    value={rollups.totalCandidates}
                                    description="Should equal total candidates shown below when every family table exists."
                                />
                            </div>
                        </section>

                        <section aria-labelledby="import-review-totals">
                            <SectionTitle
                                id="import-review-totals"
                                title="Rollups"
                                subtitle="Combined from grouped candidate buckets for this scope (API envelopes still expose aggregate pending/approved/rejected totals)."
                            />
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                <StatsCard title="Total candidates" value={rollups.totalCandidates} />
                                <StatsCard
                                    title="Pending review"
                                    value={data.total_pending_review_count}
                                    description="From API rollup (pipeline definition of pending)."
                                    statusColor="warning"
                                />
                                <StatsCard
                                    title="Approved (decision)"
                                    value={data.total_approved_count}
                                    statusColor="success"
                                />
                                <StatsCard title="Rejected" value={data.total_rejected_count} statusColor="danger" />
                                <StatsCard title="Needs review / needs_review" value={rollups.needsReview} />
                                <StatsCard title="Ignored" value={rollups.ignored} />
                                <StatsCard title="Merged" value={rollups.merged} />
                                <StatsCard
                                    title="Ready for publish batch"
                                    value={rollups.readyForPublish}
                                    description="Approved decision + approved review_status, excluding promoted/failed promotions."
                                    statusColor="success"
                                />
                                <StatsCard title="Promoted" value={rollups.promoted} />
                                <StatsCard title="Promotion failed" value={rollups.promotionFailed} statusColor="danger" />
                            </div>
                        </section>

                        <section aria-labelledby="import-review-nav">
                            <SectionTitle
                                id="import-review-nav"
                                title="Review queues"
                                subtitle="Opens list UIs wired to Supabase-backed import_review via the API (no direct DB)."
                            />
                            <div className="flex flex-wrap gap-3">
                                <Link
                                    href={reviewHref("buildings")}
                                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                                >
                                    Review buildings
                                </Link>
                                <Link
                                    href={reviewHref("places")}
                                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                                >
                                    Review places
                                </Link>
                                <Link
                                    href={reviewHref("roads")}
                                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                                >
                                    Review roads
                                </Link>
                                <Link
                                    href={(() => {
                                        const p = new URLSearchParams();
                                        if (scopeForLinks?.kind === "review_batch") {
                                            p.set("review_batch_id", scopeForLinks.value);
                                        } else if (scopeForLinks?.kind === "source_snapshot") {
                                            p.set("source_snapshot_version", scopeForLinks.value);
                                        }
                                        const qs = p.toString();
                                        return qs
                                            ? `/import-review/promotion?${qs}`
                                            : "/import-review/promotion";
                                    })()}
                                    className="rounded-md border border-emerald-600 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 shadow-sm hover:bg-emerald-100"
                                >
                                    Publish batches
                                </Link>
                            </div>
                        </section>

                        <section aria-labelledby="import-review-by-family">
                            <SectionTitle
                                id="import-review-by-family"
                                title="By entity — breakdown"
                                subtitle="Counts grouped across dimensions present in bucket rows."
                            />
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                                {FAMILIES.map((family) => {
                                    const rows = familyRows(family);
                                    const total = rows.reduce((s, r) => s + r.row_count, 0);
                                    return (
                                        <Card key={family}>
                                            <CardContent className="space-y-4 p-5">
                                                <div className="border-b border-gray-100 pb-3">
                                                    <h3 className="text-base font-semibold text-gray-900">
                                                        {FAMILY_LABEL[family]}
                                                    </h3>
                                                    <p className="text-sm text-gray-600">{total.toLocaleString()} candidates</p>
                                                </div>
                                                <div className="grid gap-4 sm:grid-cols-1">
                                                    <BreakdownBlock
                                                        title="Match status"
                                                        counts={aggregateBy(rows, "match_status")}
                                                    />
                                                    <BreakdownBlock
                                                        title="Auto action"
                                                        counts={aggregateBy(rows, "auto_action")}
                                                    />
                                                    <BreakdownBlock
                                                        title="Review decision"
                                                        counts={aggregateBy(rows, "review_decision")}
                                                    />
                                                    <BreakdownBlock
                                                        title="Promotion status"
                                                        counts={aggregateBy(rows, "promotion_status")}
                                                    />
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        </section>
                    </>
                ) : !isLoading && !error ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
                        Enter exactly one of <strong>source_snapshot_version</strong> or{" "}
                        <strong>review_batch_id</strong>, choose <strong>Load summary</strong>, or rely on defaults from
                        the URL / <code className="rounded bg-gray-100 px-1 text-xs">NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_VERSION</code>.
                    </div>
                ) : null}

                {isLoading && !data ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-700 shadow-sm">
                        Loading import review summary…
                    </div>
                ) : null}
            </div>
        </main>
    );
}

export default function ImportReviewPage() {
    return (
        <Suspense
            fallback={
                <main className="p-6">
                    <div className="mx-auto max-w-7xl rounded-lg border border-gray-200 bg-white p-6 text-gray-700 shadow-sm">
                        Loading…
                    </div>
                </main>
            }
        >
            <ImportReviewSummaryInner />
        </Suspense>
    );
}
