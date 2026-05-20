"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { Card, CardContent } from "@/src/components/ui/card";
import {
    getImportReviewSummary,
    isAbortError,
    isImportReviewBatchAmbiguousError,
    type ImportReviewBatchChoice,
    type ImportReviewSummaryResponse,
} from "@/src/lib/api";
import ImportReviewBatchPicker from "@/src/app/(admin)/import-review/_components/ImportReviewBatchPicker";
import ImportReviewErrorState from "@/src/features/import-review/components/ImportReviewErrorState";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import ImportReviewSkeletonCards from "@/src/features/import-review/components/ImportReviewSkeletonCards";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import {
    applyImportReviewScopeSearchParams,
    reviewBatchIdFromImportReviewSearch,
    snapshotVersionFromImportReviewSearch,
    syncImportReviewUrlToResolvedBatch,
} from "@/src/lib/importReviewSnapshot";
import {
    getImportReviewEntityByApiFamily,
    importReviewEntityHref,
} from "@/src/lib/importReviewEntityConfig";
import { aggregateBy, familyBucketRows } from "@/src/lib/importReviewSummaryRollups";
import type { ImportReviewFamilySummaryMetrics } from "@/src/lib/api";

type FamilySummaryView = ImportReviewFamilySummaryMetrics & {
    label: string;
    slug: string | null;
};

function familySummariesForDisplay(families: ImportReviewFamilySummaryMetrics[]): FamilySummaryView[] {
    return families.map((f) => {
        const cfg = getImportReviewEntityByApiFamily(f.entity_family);
        return {
            ...f,
            label: cfg?.pluralLabel ?? f.entity_family.replace(/_/g, " "),
            slug: cfg?.slug ?? null,
        };
    });
}

type LoadedScope =
    | { kind: "source_snapshot"; value: string }
    | { kind: "review_batch"; value: string };

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
    const [ambiguousBatches, setAmbiguousBatches] = useState<ImportReviewBatchChoice[] | null>(null);
    const [ambiguousSnapshot, setAmbiguousSnapshot] = useState("");
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
                latest?: boolean;
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
                ? { source_snapshot_version: snap, ...(opts.latest ? { latest: true } : {}) }
                : { review_batch_id: batch };

            setIsLoading(true);
            setError("");
            setAmbiguousBatches(null);
            setAmbiguousSnapshot("");

            try {
                const response = await getImportReviewSummary(
                    query,
                    opts.signal ? { signal: opts.signal } : undefined
                );
                setData(response);
                const resolvedBatch = response.review_batch_id?.trim() ?? batch;
                setLastLoaded(
                    resolvedBatch
                        ? { kind: "review_batch", value: resolvedBatch }
                        : snap
                          ? { kind: "source_snapshot", value: snap }
                          : null
                );
                setLastUpdated(new Date());
                if (opts.syncUrl) {
                    const params = new URLSearchParams(searchParams.toString());
                    if (snap && response.review_batch_id) {
                        syncImportReviewUrlToResolvedBatch(params, response.review_batch_id);
                    } else {
                        applyImportReviewScopeSearchParams(params, snap, batch);
                    }
                    router.replace(`/import-review?${params.toString()}`, { scroll: false });
                }
                return true;
            } catch (err) {
                if (isAbortError(err)) {
                    return false;
                }
                if (isImportReviewBatchAmbiguousError(err)) {
                    setAmbiguousBatches(err.batches);
                    setAmbiguousSnapshot(err.sourceSnapshotVersion || snap);
                    setError("");
                    setData(null);
                    setLastLoaded(null);
                    setLastUpdated(null);
                    return false;
                }
                setAmbiguousBatches(null);
                setAmbiguousSnapshot("");
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
    const latestFromUrl = (() => {
        const raw = searchParams.get("latest")?.trim().toLowerCase();
        return raw === "true" || raw === "1";
    })();

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
            latest: latestFromUrl,
            signal: controller.signal,
            syncUrl: false,
        });
        return () => controller.abort();
    }, [chosenBatch, chosenSnapshot, latestFromUrl]);

    useEffect(() => {
        const resolvedBatch = data?.review_batch_id?.trim();
        if (!resolvedBatch || urlBatch) {
            return;
        }
        const params = new URLSearchParams(searchParams.toString());
        if (syncImportReviewUrlToResolvedBatch(params, resolvedBatch)) {
            router.replace(`/import-review?${params.toString()}`, { scroll: false });
        }
    }, [data?.review_batch_id, urlBatch, router, searchParams]);

    const rollup = data?.rollup ?? null;
    const familySummaries = useMemo(
        () => (data?.family_summaries ? familySummariesForDisplay(data.family_summaries) : []),
        [data]
    );

    const resolvedReviewBatchId = data?.review_batch_id?.trim() || urlBatch || "";
    const entityReviewHref = (slug: string) =>
        importReviewEntityHref(slug, searchParams, resolvedReviewBatchId || null);

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
                                {data?.batch_name ? (
                                    <>
                                        <span className="text-gray-500">Batch </span>
                                        <span className="font-medium text-gray-900">{data.batch_name}</span>
                                        {data.review_batch_id ? (
                                            <>
                                                <span className="mx-1 text-gray-400">·</span>
                                                <span className="font-mono text-gray-700">#{data.review_batch_id}</span>
                                            </>
                                        ) : null}
                                        {data.selected_by ? (
                                            <>
                                                <span className="mx-1 text-gray-400">·</span>
                                                <span className="text-xs text-gray-500">{data.selected_by}</span>
                                            </>
                                        ) : null}
                                    </>
                                ) : lastLoaded.kind === "source_snapshot" ? (
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
                                {isLoading ? IMPORT_REVIEW_LOADING.loadingOverviewSummary : "Load summary"}
                            </button>
                        </div>
                    </div>
                </header>

                {ambiguousBatches && ambiguousBatches.length > 0 ? (
                    <>
                        <ImportReviewStatusBanner
                            message={IMPORT_REVIEW_LOADING.multipleBatchesFound}
                            tone="warning"
                        />
                        <ImportReviewBatchPicker
                        sourceSnapshotVersion={ambiguousSnapshot}
                        batches={ambiguousBatches}
                        onUseLatest={() => {
                            const snap =
                                ambiguousSnapshot ||
                                snapshotVersionFromImportReviewSearch(searchParams) ||
                                versionInput.trim();
                            void load({
                                snapshotVersion: snap,
                                reviewBatchId: "",
                                latest: true,
                                syncUrl: true,
                            });
                        }}
                    />
                    </>
                ) : null}

                {error ? <ImportReviewErrorState message={error} /> : null}

                {isLoading && data ? (
                    <div className="flex justify-end">
                        <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingOverviewSummary} />
                    </div>
                ) : null}

                {data?.warnings?.length ? (
                    <ImportReviewStatusBanner
                        message={`Summary warnings: ${(data.warnings ?? []).join(" · ")}`}
                        tone="warning"
                    />
                ) : null}

                {data && rollup ? (
                    <>
                        {data.review_batch_id ? (
                            <p className="text-xs text-gray-500">
                                Counts are scoped to review_batch_id=
                                <span className="font-mono font-medium text-gray-700">{data.review_batch_id}</span>.
                                Batch total includes promoted rows. Active review excludes promoted rows.
                            </p>
                        ) : null}

                        <section aria-labelledby="import-review-totals">
                            <SectionTitle
                                id="import-review-totals"
                                title="Batch rollups"
                                subtitle="Precise counts from SQL aggregation for the selected review batch."
                            />
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                <StatsCard title="Batch total candidates" value={rollup.batch_total_candidates} />
                                <StatsCard
                                    title="Active review candidates"
                                    value={rollup.active_candidates}
                                    description="Excludes promoted rows."
                                />
                                <StatsCard
                                    title="Pending review"
                                    value={rollup.pending_review_candidates}
                                    statusColor="warning"
                                />
                                <StatsCard
                                    title="Ready for publish"
                                    value={rollup.ready_for_publish_candidates}
                                    statusColor="success"
                                />
                                <StatsCard title="Approved" value={rollup.approved_candidates} statusColor="success" />
                                <StatsCard title="Rejected" value={rollup.rejected_candidates} statusColor="danger" />
                                <StatsCard title="Needs review" value={rollup.needs_review_candidates} />
                                <StatsCard title="Ignored" value={rollup.ignored_candidates} />
                                <StatsCard title="Merged" value={rollup.merged_candidates} />
                                <StatsCard title="Promoted" value={rollup.promoted_candidates} />
                                <StatsCard
                                    title="Promotion failed"
                                    value={rollup.promotion_failed_candidates}
                                    statusColor="danger"
                                />
                            </div>
                        </section>

                        <section aria-labelledby="import-review-family-metrics">
                            <SectionTitle
                                id="import-review-family-metrics"
                                title="Per-family review metrics"
                                subtitle="Each family sums into the batch rollups above."
                            />
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                                {familySummaries.map((f) => (
                                    <Card key={`metrics-${f.entity_family}`}>
                                        <CardContent className="space-y-3 p-5">
                                            <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-3">
                                                <div>
                                                    <h3 className="text-base font-semibold text-gray-900">{f.label}</h3>
                                                    <p className="text-sm text-gray-600">
                                                        Batch total: {f.batch_total.toLocaleString()}
                                                    </p>
                                                </div>
                                                {f.slug ? (
                                                    <Link
                                                        href={entityReviewHref(f.slug)}
                                                        className="shrink-0 text-xs font-medium text-blue-700 underline"
                                                    >
                                                        Open queue
                                                    </Link>
                                                ) : null}
                                            </div>
                                            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                                <dt className="text-gray-500">Active</dt>
                                                <dd className="tabular-nums font-medium">{f.active.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Promoted</dt>
                                                <dd className="tabular-nums font-medium">{f.promoted.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Pending</dt>
                                                <dd className="tabular-nums font-medium">{f.pending_review.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Ready for publish</dt>
                                                <dd className="tabular-nums font-medium">
                                                    {f.ready_for_publish.toLocaleString()}
                                                </dd>
                                                <dt className="text-gray-500">Approved</dt>
                                                <dd className="tabular-nums font-medium">{f.approved.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Rejected</dt>
                                                <dd className="tabular-nums font-medium">{f.rejected.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Needs review</dt>
                                                <dd className="tabular-nums font-medium">{f.needs_review.toLocaleString()}</dd>
                                                <dt className="text-gray-500">Promotion failed</dt>
                                                <dd className="tabular-nums font-medium">
                                                    {f.promotion_failed.toLocaleString()}
                                                </dd>
                                                {f.validation_error_count > 0 || f.validation_warning_count > 0 ? (
                                                    <>
                                                        <dt className="text-gray-500">Validation errors</dt>
                                                        <dd className="tabular-nums font-medium">
                                                            {f.validation_error_count.toLocaleString()}
                                                        </dd>
                                                        <dt className="text-gray-500">Validation warnings</dt>
                                                        <dd className="tabular-nums font-medium">
                                                            {f.validation_warning_count.toLocaleString()}
                                                        </dd>
                                                    </>
                                                ) : null}
                                            </dl>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </section>

                        <section aria-labelledby="import-review-by-family">
                            <SectionTitle
                                id="import-review-by-family"
                                title="By entity — breakdown"
                                subtitle="Counts grouped across dimensions present in bucket rows."
                            />
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
                                {familySummaries.map((f) => {
                                    const rows = data ? familyBucketRows(data.entity_summaries, f.entity_family) : [];
                                    return (
                                        <Card key={`breakdown-${f.entity_family}`}>
                                            <CardContent className="space-y-4 p-5">
                                                <div className="border-b border-gray-100 pb-3">
                                                    <h3 className="text-base font-semibold text-gray-900">{f.label}</h3>
                                                    <p className="text-sm text-gray-600">
                                                        Batch total: {f.batch_total.toLocaleString()} · Active:{" "}
                                                        {f.active.toLocaleString()}
                                                    </p>
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

                {isLoading && !data && !error ? (
                    <>
                        <ImportReviewLoadingBannerWithSpinner
                            message={IMPORT_REVIEW_LOADING.loadingOverviewSummary}
                        />
                        <ImportReviewSkeletonCards
                            count={10}
                            columns={4}
                            message={IMPORT_REVIEW_LOADING.loadingOverviewSummary}
                        />
                    </>
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
                    <div className="mx-auto max-w-7xl">
                        <ImportReviewLoadingBannerWithSpinner
                            message={IMPORT_REVIEW_LOADING.loadingOverviewSummary}
                        />
                    </div>
                </main>
            }
        >
            <ImportReviewSummaryInner />
        </Suspense>
    );
}
