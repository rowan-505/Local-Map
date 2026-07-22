"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { Card, CardContent } from "@/src/components/ui/card";
import { useImportReviewSummary } from "@/src/features/import-review/hooks/useImportReviewSummary";
import ImportReviewBatchPicker from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewBatchPicker";
import ImportReviewErrorState from "@/src/features/import-review/components/ImportReviewErrorState";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import { ImportReviewLoadingBannerWithSpinner } from "@/src/features/import-review/components/ImportReviewLoadingState";
import ImportReviewSkeletonCards from "@/src/features/import-review/components/ImportReviewSkeletonCards";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import {
    applyImportReviewScopeSearchParams,
    importReviewScopeQueryFromSearch,
    reviewBatchIdFromImportReviewSearch,
    snapshotVersionFromImportReviewSearch,
    syncImportReviewUrlToResolvedBatch,
} from "@/src/lib/importReviewSnapshot";
import { importReviewPath } from "@/src/lib/dashboardNavigation";
import {
    getImportReviewEntityByApiFamily,
    importReviewEntityHref,
} from "@/src/lib/importReviewEntityConfig";
import { replaceImportReviewSearchParams } from "@/src/features/import-review/navigation/replaceImportReviewSearchParams";
import {
    logImportReviewPageRender,
    logImportReviewUrlSync,
    logImportReviewUserAction,
    diffImportReviewSearchKeys,
} from "@/src/features/import-review/utils/importReviewRequestDebug";
import type { ImportReviewFamilySummaryMetrics } from "@/src/lib/api";
import { isDeprecatedCoreBusImportReviewFamily } from "@/src/features/import-review/utils/deprecatedCoreBusPromotion";

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

function snapshotOptionsFromEnv(): string[] {
    const raw = process.env.NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_OPTIONS?.trim();
    if (!raw) {
        return [];
    }

    return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

/** Overview-only: loads GET /api/import-review/summary — no entity list/filter/options hooks. */
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
    const searchKey = searchParams.toString();
    const prevSearchKeyRef = useRef<string | null>(null);

    const apiScope = useMemo(
        () => importReviewScopeQueryFromSearch(searchParams, envDefault, { useEnvDefault: true }),
        [searchParams, envDefault]
    );

    useEffect(() => {
        logImportReviewPageRender({
            component: "ImportReviewSummaryInner",
            route_slug: "overview",
            route_family: null,
            pathname: importReviewPath(),
            route_active: true,
            scope: {
                review_batch_id: urlBatch || null,
                source_snapshot_version: urlVersion || null,
            },
        });
    }, [urlBatch, urlVersion]);

    useEffect(() => {
        const prev = prevSearchKeyRef.current;
        if (prev !== null && prev !== searchKey) {
            logImportReviewUrlSync({
                source: "ImportReviewSummaryInner",
                reason: "searchParams_changed",
                pathname: importReviewPath(),
                previous_query: prev,
                next_query: searchKey,
                changed_keys: diffImportReviewSearchKeys(prev, searchKey),
            });
        }
        prevSearchKeyRef.current = searchKey;
    }, [searchKey]);

    const {
        data,
        isLoading,
        isFetching,
        error,
        ambiguousBatches,
        ambiguousSnapshot,
        dataUpdatedAt,
    } = useImportReviewSummary(apiScope);

    const lastUpdated = dataUpdatedAt > 0 ? new Date(dataUpdatedAt) : null;
    const lastLoaded = useMemo((): LoadedScope | null => {
        if (!data) {
            return null;
        }
        const batch = data.review_batch_id?.trim();
        if (batch) {
            return { kind: "review_batch", value: batch };
        }
        const snap = data.source_snapshot_version?.trim();
        return snap ? { kind: "source_snapshot", value: snap } : null;
    }, [data]);

    useEffect(() => {
        setVersionInput(urlBatch ? "" : urlVersion || envDefault || presetOptions[0] || "");
    }, [urlVersion, envDefault, presetOptions, urlBatch]);

    useEffect(() => {
        setBatchInput(urlBatch || "");
    }, [urlBatch]);

    const applyScopeToUrl = useCallback(
        (opts: { snapshotVersion: string; reviewBatchId: string; latest?: boolean }) => {
            const snap = opts.snapshotVersion.trim();
            const batch = opts.reviewBatchId.trim();
            logImportReviewUserAction({
                action: "apply_scope",
                source: "overview:apply_scope",
                route_slug: "overview",
                scope: {
                    review_batch_id: batch || null,
                    source_snapshot_version: snap || null,
                },
            });
            replaceImportReviewSearchParams(
                router,
                importReviewPath(),
                searchParams,
                (params) => {
                    applyImportReviewScopeSearchParams(params, snap, batch);
                    if (opts.latest) {
                        params.set("latest", "true");
                    } else {
                        params.delete("latest");
                    }
                },
                { source: "overview:apply_scope" }
            );
        },
        [router, searchParams]
    );

    useEffect(() => {
        const resolvedBatch = data?.review_batch_id?.trim();
        if (!resolvedBatch || urlBatch) {
            return;
        }
        logImportReviewUrlSync({
            source: "ImportReviewSummaryInner",
            reason: "sync_summary_review_batch_id",
            pathname: importReviewPath(),
            previous_query: searchKey,
            next_query: `${searchKey}${searchKey ? "&" : ""}review_batch_id=${resolvedBatch}`,
            changed_keys: ["review_batch_id"],
        });
        replaceImportReviewSearchParams(
            router,
            importReviewPath(),
            searchParams,
            (params) => {
                syncImportReviewUrlToResolvedBatch(params, resolvedBatch);
            },
            { source: "overview:sync_summary_batch" }
        );
    }, [data?.review_batch_id, urlBatch, router, searchParams, searchKey]);

    const rollup = data?.rollup ?? null;
    const familySummaries = useMemo(
        () =>
            (data?.family_summaries ? familySummariesForDisplay(data.family_summaries) : []).filter(
                (f) => !isDeprecatedCoreBusImportReviewFamily(f.entity_family)
            ),
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
                                Conflict-only workspace: decide duplicates, conflicts, protected matches, and
                                possible deletes. Safe inserts/updates load outside this queue.
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
                                    applyScopeToUrl({
                                        snapshotVersion: versionInput,
                                        reviewBatchId: batchInput,
                                    })
                                }
                                disabled={isLoading || isFetching}
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
                        onSelectBatch={(batchId) => {
                            setVersionInput("");
                            setBatchInput(batchId);
                            applyScopeToUrl({
                                snapshotVersion: "",
                                reviewBatchId: batchId,
                            });
                        }}
                        onUseLatest={() => {
                            const snap =
                                ambiguousSnapshot ||
                                snapshotVersionFromImportReviewSearch(searchParams) ||
                                versionInput.trim();
                            applyScopeToUrl({
                                snapshotVersion: snap,
                                reviewBatchId: "",
                                latest: true,
                            });
                        }}
                    />
                    </>
                ) : null}

                {error ? <ImportReviewErrorState message={error} /> : null}

                {isFetching && data ? (
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
                                Showing the active conflict batch
                                {data.batch_name ? (
                                    <>
                                        {" "}
                                        <span className="font-medium text-gray-700">{data.batch_name}</span>
                                    </>
                                ) : null}
                                .
                            </p>
                        ) : null}

                        <section aria-labelledby="import-review-totals">
                            <SectionTitle
                                id="import-review-totals"
                                title="Conflict workspace"
                                subtitle="Active conflict batch only. Safe/new/unchanged rows are not shown here."
                            />
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                <StatsCard
                                    title="Active conflict batch"
                                    value={data.batch_name ?? data.review_batch_id ?? "—"}
                                    description={
                                        data.source_snapshot_version
                                            ? `Snapshot ${data.source_snapshot_version}`
                                            : "Select a batch or snapshot above"
                                    }
                                />
                                <StatsCard
                                    title="Source snapshot"
                                    value={data.source_snapshot_version ?? "—"}
                                />
                                <StatsCard
                                    title="Pending conflicts"
                                    value={rollup.pending_review_candidates}
                                    statusColor="warning"
                                />
                                <StatsCard
                                    title="Needs more review"
                                    value={rollup.needs_review_candidates}
                                    statusColor="warning"
                                />
                                <StatsCard
                                    title="Ready to apply"
                                    value={rollup.ready_for_publish_candidates}
                                    statusColor="success"
                                />
                                <StatsCard title="Applied" value={rollup.promoted_candidates} />
                                <StatsCard
                                    title="Failed"
                                    value={rollup.promotion_failed_candidates}
                                    statusColor="danger"
                                />
                                <StatsCard
                                    title="Active conflicts"
                                    value={rollup.active_candidates}
                                    description="Excludes applied rows."
                                />
                            </div>
                        </section>

                        <section aria-labelledby="import-review-family-metrics">
                            <SectionTitle
                                id="import-review-family-metrics"
                                title="Counts by family"
                                subtitle="Open a family queue to decide conflicts."
                            />
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                                {familySummaries.map((f) => (
                                    <Card key={`metrics-${f.entity_family}`}>
                                        <CardContent className="space-y-3 p-5">
                                            <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-3">
                                                <div>
                                                    <h3 className="text-base font-semibold text-gray-900">{f.label}</h3>
                                                    <p className="text-sm text-gray-600">
                                                        Active: {f.active.toLocaleString()}
                                                    </p>
                                                </div>
                                                {f.slug ? (
                                                    <Link
                                                        href={entityReviewHref(f.slug)}
                                                        prefetch={false}
                                                        className="shrink-0 text-xs font-medium text-blue-700 underline"
                                                    >
                                                        Open queue
                                                    </Link>
                                                ) : null}
                                            </div>
                                            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                                <dt className="text-gray-500">Pending</dt>
                                                <dd className="tabular-nums font-medium">
                                                    {f.pending_review.toLocaleString()}
                                                </dd>
                                                <dt className="text-gray-500">Needs more review</dt>
                                                <dd className="tabular-nums font-medium">
                                                    {f.needs_review.toLocaleString()}
                                                </dd>
                                                <dt className="text-gray-500">Ready to apply</dt>
                                                <dd className="tabular-nums font-medium">
                                                    {f.ready_for_publish.toLocaleString()}
                                                </dd>
                                                <dt className="text-gray-500">Applied</dt>
                                                <dd className="tabular-nums font-medium">
                                                    {f.promoted.toLocaleString()}
                                                </dd>
                                                <dt className="text-gray-500">Failed</dt>
                                                <dd className="tabular-nums font-medium">
                                                    {f.promotion_failed.toLocaleString()}
                                                </dd>
                                            </dl>
                                        </CardContent>
                                    </Card>
                                ))}
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
