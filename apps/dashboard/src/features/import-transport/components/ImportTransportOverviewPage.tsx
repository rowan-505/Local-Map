"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { Card, CardContent } from "@/src/components/ui/card";
import { postImportTransportBatchValidation } from "@/src/features/import-transport/api/importTransportApiClient";
import ImportTransportBatchScopePanel from "@/src/features/import-transport/components/ImportTransportBatchScopePanel";
import ImportTransportEmptyState from "@/src/features/import-transport/components/ImportTransportEmptyState";
import ImportTransportErrorState from "@/src/features/import-transport/components/ImportTransportErrorState";
import { ImportTransportLoadingBannerWithSpinner } from "@/src/features/import-transport/components/ImportTransportLoadingState";
import { useImportTransportBatchContext } from "@/src/features/import-transport/hooks/useImportTransportBatchContext";
import { useImportTransportBatches } from "@/src/features/import-transport/hooks/useImportTransportOverview";
import { listImportTransportEntityConfigs } from "@/src/features/import-transport/config/importTransportEntityConfigs";
import type { ImportTransportSummaryResponse } from "@/src/features/import-transport/config/types";
import { IMPORT_TRANSPORT_LOADING } from "@/src/features/import-transport/utils/loadingMessages";
import { preserveImportTransportScopeInParams } from "@/src/features/import-transport/utils/importTransportScope";
import { importTransportPath } from "@/src/lib/dashboardPaths";

const LEGACY_BUS_DEPRECATION_MESSAGE =
    "Legacy core.core_bus_* tables are deprecated. New transport promotion uses import_transport → core_transport only — not import-review bus queues or core.core_bus_*.";

const PIPELINE_STEPS = [
    {
        title: "import_transport",
        description: "Messy ingest batches and candidate rows from GTFS, operator feeds, and manual uploads.",
    },
    {
        title: "Validation & review",
        description: "Structured validation issues and admin review decisions on candidates in the dashboard.",
    },
    {
        title: "core_transport",
        description: "Verified production network data for map tiles, search, and API consumers.",
    },
    {
        title: "gtfs_export",
        description: "Generated GTFS bundles and OTP graph build metadata — OTP reads files, not Postgres.",
    },
] as const;

function familyTotal(summary: ImportTransportSummaryResponse | null, entityFamily: string): number {
    return summary?.families.find((f) => f.entity_family === entityFamily)?.total ?? 0;
}

function scopedHref(slug: string, searchParams: URLSearchParams): string {
    const scope = preserveImportTransportScopeInParams(searchParams);
    const qs = scope.toString();
    return qs ? `${importTransportPath(slug)}?${qs}` : importTransportPath(slug);
}

function OverviewSkeletonCards() {
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
                <Card key={i} className="animate-pulse border-gray-200">
                    <CardContent className="space-y-3 py-6">
                        <div className="h-3 w-24 rounded bg-gray-200" />
                        <div className="h-8 w-16 rounded bg-gray-200" />
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

function ImportTransportOverviewInner() {
    const searchParams = useSearchParams();
    const searchKey = searchParams.toString();
    const batchContext = useImportTransportBatchContext();

    const batchesQuery = useImportTransportBatches({ limit: 100, offset: 0 }, batchContext.status === "resolved");
    const summary = batchContext.summary;
    const hasScope = batchContext.status === "resolved" && batchContext.apiScopeQuery !== null;
    const isInitialLoad = hasScope && !summary;

    const [batchValidateMessage, setBatchValidateMessage] = useState("");
    const [batchValidateError, setBatchValidateError] = useState("");
    const [isBatchValidating, setIsBatchValidating] = useState(false);

    const runBatchValidation = useCallback(async () => {
        if (!batchContext.apiScopeQuery) {
            return;
        }
        setIsBatchValidating(true);
        setBatchValidateError("");
        setBatchValidateMessage("");
        try {
            const result = await postImportTransportBatchValidation({ ...batchContext.apiScopeQuery });
            setBatchValidateMessage(
                `Validated ${result.validated_count.toLocaleString()} candidates (${result.valid_count} valid, ${result.warning_count} warning, ${result.blocked_count} blocked).`
            );
        } catch (err) {
            setBatchValidateError(err instanceof Error ? err.message : "Batch validation failed.");
        } finally {
            setIsBatchValidating(false);
        }
    }, [batchContext.apiScopeQuery]);

    const entityConfigs = listImportTransportEntityConfigs();
    const batchesTotal = batchesQuery.data?.total ?? 0;
    const listError = batchContext.error || batchesQuery.error;

    const cardValue = (value: number | null | undefined) => {
        if (!hasScope) {
            return "—";
        }
        return value ?? 0;
    };

    const entityHrefParams = useMemo(() => new URLSearchParams(searchParams.toString()), [searchKey]);

    return (
        <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
            <div className="mx-auto max-w-7xl space-y-8">
                <header className="border-b border-gray-200 pb-6">
                    <h1 className="text-2xl font-bold text-gray-900">Import transport</h1>
                    <p className="mt-1 max-w-3xl text-sm text-gray-600">
                        Review and validate transport import candidates in{" "}
                        <code className="rounded bg-gray-100 px-1 text-xs">import_transport</code> before promotion
                        to production{" "}
                        <code className="rounded bg-gray-100 px-1 text-xs">core_transport</code>. Dashboard calls the
                        API only — no direct database access.
                    </p>
                </header>

                <Card className="border-sky-200 bg-sky-50/60 shadow-sm">
                    <CardContent className="space-y-4 p-5">
                        <h2 className="text-sm font-semibold text-sky-950">Transport data pipeline</h2>
                        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            {PIPELINE_STEPS.map((step, index) => (
                                <li key={step.title} className="rounded-lg border border-sky-100 bg-white p-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
                                        {index + 1}. {step.title}
                                    </p>
                                    <p className="mt-1 text-sm text-gray-700">{step.description}</p>
                                </li>
                            ))}
                        </ol>
                    </CardContent>
                </Card>

                <div
                    className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm"
                    role="status"
                >
                    {LEGACY_BUS_DEPRECATION_MESSAGE}
                </div>

                <ImportTransportBatchScopePanel disabled={isBatchValidating} />

                <ImportTransportErrorState message={listError} />

                {isInitialLoad ? (
                    <>
                        <ImportTransportLoadingBannerWithSpinner
                            message={IMPORT_TRANSPORT_LOADING.loadingBatchContext}
                        />
                        <OverviewSkeletonCards />
                    </>
                ) : null}

                {hasScope && !isInitialLoad ? (
                    <>
                        {summary ? (
                            <Card className="border-gray-200 shadow-sm">
                                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                                    <div>
                                        <h2 className="text-sm font-semibold text-gray-900">Batch validation</h2>
                                        <p className="mt-1 text-sm text-gray-600">
                                            Run structured validation for routes, stops, variants, and route stops in
                                            this import batch.
                                        </p>
                                        {batchValidateMessage ? (
                                            <p className="mt-2 text-sm text-emerald-800">{batchValidateMessage}</p>
                                        ) : null}
                                        <ImportTransportErrorState message={batchValidateError} compact />
                                    </div>
                                    <button
                                        type="button"
                                        disabled={isBatchValidating}
                                        onClick={() => void runBatchValidation()}
                                        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                                    >
                                        {isBatchValidating ? "Validating batch…" : "Validate batch"}
                                    </button>
                                </CardContent>
                            </Card>
                        ) : null}

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            <StatsCard
                                title="Import batches"
                                value={batchesTotal}
                                description="Total batches registered in import_transport (all scopes)."
                            />
                            <StatsCard
                                title="Route candidates"
                                value={cardValue(familyTotal(summary, "routes"))}
                                description="Logical routes in the selected import batch."
                            />
                            <StatsCard
                                title="Stop candidates"
                                value={cardValue(familyTotal(summary, "stops"))}
                                description="Stop points in the selected import batch."
                            />
                            <StatsCard
                                title="Variant candidates"
                                value={cardValue(familyTotal(summary, "variants"))}
                                description="Route direction/pattern variants."
                            />
                            <StatsCard
                                title="Route stop candidates"
                                value={cardValue(familyTotal(summary, "route_stops"))}
                                description="Ordered stop membership per variant."
                            />
                            <StatsCard
                                title="Validation blocked"
                                value={cardValue(summary?.validation?.blocked_count)}
                                statusColor={
                                    (summary?.validation?.blocked_count ?? 0) > 0 ? "danger" : "default"
                                }
                                description="Open error/critical validation issues for this batch."
                            />
                            <StatsCard
                                title="Validation warnings"
                                value={cardValue(summary?.validation?.warning_count)}
                                statusColor={
                                    (summary?.validation?.warning_count ?? 0) > 0 ? "warning" : "default"
                                }
                                description="Open warning-level validation issues for this batch."
                            />
                            <StatsCard
                                title="Ready for promotion"
                                value={cardValue(summary?.rollup?.ready_for_promotion)}
                                statusColor="success"
                                description="Review-approved candidates in this batch."
                            />
                            <StatsCard
                                title="Promoted"
                                value={cardValue(summary?.rollup?.promoted)}
                                description="Candidates already marked promoted in this batch."
                            />
                        </div>

                        {summary?.rollup?.total_candidates === 0 ? (
                            <ImportTransportEmptyState
                                title="No candidates in this batch"
                                description="The import batch exists but candidate tables are empty for this scope."
                            />
                        ) : null}

                        <section>
                            <h2 className="mb-3 text-lg font-semibold text-gray-900">Entity queues</h2>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                {entityConfigs.map((cfg) => (
                                    <Link
                                        key={cfg.slug}
                                        href={scopedHref(cfg.slug, entityHrefParams)}
                                        className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
                                    >
                                        <p className="font-medium text-gray-900">{cfg.pluralLabel}</p>
                                        <p className="mt-1 text-xs text-gray-500">
                                            {`${cardValue(familyTotal(summary, cfg.apiFamily)).toLocaleString()} candidates`}
                                        </p>
                                    </Link>
                                ))}
                            </div>
                        </section>
                    </>
                ) : null}
            </div>
        </main>
    );
}

export default function ImportTransportOverviewPage() {
    return (
        <Suspense fallback={null}>
            <ImportTransportOverviewInner />
        </Suspense>
    );
}
