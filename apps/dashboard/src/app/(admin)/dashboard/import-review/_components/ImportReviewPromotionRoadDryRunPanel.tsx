"use client";

import { useCallback, useEffect, useState } from "react";

import {
    PromotionSectionHeading,
    PublishEntityFamilyLabel,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import {
    getImportReviewPromotionBatchRoadDryRun,
    isAbortError,
    postImportReviewPromotionBatchRoadDryRun,
    type ImportReviewPromotionRoadDryRunSummaryResponse,
} from "@/src/lib/api";

type Props = {
    batchId: string;
    formatError: (err: unknown) => string;
    onDryRunUpdated?: (result: ImportReviewPromotionRoadDryRunSummaryResponse | null) => void;
};

export default function ImportReviewPromotionRoadDryRunPanel({
    batchId,
    formatError,
    onDryRunUpdated,
}: Props) {
    const [result, setResult] = useState<ImportReviewPromotionRoadDryRunSummaryResponse | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isLoadingCached, setIsLoadingCached] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const applyResult = useCallback(
        (next: ImportReviewPromotionRoadDryRunSummaryResponse | null) => {
            setResult(next);
            onDryRunUpdated?.(next);
        },
        [onDryRunUpdated]
    );

    useEffect(() => {
        const controller = new AbortController();
        setIsLoadingCached(true);
        void getImportReviewPromotionBatchRoadDryRun(batchId, { signal: controller.signal })
            .then((cached) => {
                applyResult(cached);
            })
            .catch((err) => {
                if (!isAbortError(err)) {
                    applyResult(null);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoadingCached(false);
                }
            });
        return () => controller.abort();
    }, [batchId, applyResult]);

    async function handleRunDryRun() {
        setIsRunning(true);
        setError(null);
        try {
            const next = await postImportReviewPromotionBatchRoadDryRun(batchId, {
                revalidate: true,
            });
            applyResult(next);
        } catch (err) {
            setError(formatError(err));
        } finally {
            setIsRunning(false);
        }
    }

    return (
        <section className="border-t border-gray-100 pt-6">
            <PromotionSectionHeading
                title="Road promotion dry-run"
                subtitle="Road preflight plus DB routing-readiness validation for future Valhalla builds. Does not call Valhalla or write to core.core_streets."
            />

            <div className="mt-4 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        disabled={isRunning}
                        onClick={() => void handleRunDryRun()}
                        className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                        {isRunning ? (
                            <span className="inline-flex items-center gap-2">
                                <ImportReviewInlineSpinner label="Running road dry-run…" />
                            </span>
                        ) : (
                            "Run road dry-run"
                        )}
                    </button>
                    {isLoadingCached && !result ? (
                        <ImportReviewInlineSpinner label="Loading cached dry-run…" />
                    ) : null}
                </div>

                {error ? <ImportReviewStatusBanner message={error} tone="error" compact /> : null}

                {result ? (
                    <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                        <div>
                            <p className="font-semibold">Road dry-run</p>
                            <p className="mt-1 text-xs opacity-90">
                                {result.road_dry_run.status === "passed" ? "Passed" : "Failed"} · checked{" "}
                                {result.road_dry_run.checked_count.toLocaleString()} · passed{" "}
                                {result.road_dry_run.passed_count.toLocaleString()} · failed{" "}
                                {result.road_dry_run.failed_count.toLocaleString()}
                            </p>
                        </div>

                        <div>
                            <p className="font-semibold">Routing readiness validation</p>
                            <p className="mt-1 text-xs text-gray-600">
                                Checks DB road fields needed for future Valhalla build. Does not rebuild
                                Valhalla.
                            </p>
                            <p className="mt-1 text-xs opacity-90">
                                {result.routing_readiness_validation.status === "passed"
                                    ? "Passed"
                                    : "Failed"}{" "}
                                · checked {result.routing_readiness_validation.checked_count.toLocaleString()}{" "}
                                · failed {result.routing_readiness_validation.failed_count.toLocaleString()}{" "}
                                · warnings{" "}
                                {result.routing_readiness_validation.warning_count.toLocaleString()}
                            </p>
                        </div>

                        {result.road_dry_run.sample_errors.length > 0 ||
                        result.routing_readiness_validation.sample_errors.length > 0 ? (
                            <div className="overflow-x-auto rounded-md border border-blue-200 bg-white">
                                <table className="min-w-full text-left text-xs">
                                    <thead className="border-b border-gray-200 bg-gray-50 text-gray-600">
                                        <tr>
                                            <th className="px-3 py-2 font-medium">Kind</th>
                                            <th className="px-3 py-2 font-medium">Publish item</th>
                                            <th className="px-3 py-2 font-medium">Code</th>
                                            <th className="px-3 py-2 font-medium">Message</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {result.road_dry_run.sample_errors.map((row) => (
                                            <tr key={`dry-${row.publish_item_id}-${row.code}`}>
                                                <td className="px-3 py-2">dry-run</td>
                                                <td className="px-3 py-2 font-mono">
                                                    {row.publish_item_id}
                                                </td>
                                                <td className="px-3 py-2 font-mono">{row.code}</td>
                                                <td className="px-3 py-2">{row.message}</td>
                                            </tr>
                                        ))}
                                        {result.routing_readiness_validation.sample_errors.map((row) => (
                                            <tr key={`rr-${row.publish_item_id}-${row.code}`}>
                                                <td className="px-3 py-2">routing</td>
                                                <td className="px-3 py-2 font-mono">
                                                    {row.publish_item_id}
                                                </td>
                                                <td className="px-3 py-2 font-mono">{row.code}</td>
                                                <td className="px-3 py-2">{row.message}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : null}

                        <p className="text-xs opacity-75">
                            Ran {new Date(result.road_dry_run.ran_at).toLocaleString()} ·{" "}
                            <PublishEntityFamilyLabel family="roads" />
                        </p>
                    </div>
                ) : !isLoadingCached && !isRunning ? (
                    <p className="text-xs text-gray-500">
                        No cached road dry-run yet. Run dry-run to evaluate road items.
                    </p>
                ) : null}
            </div>
        </section>
    );
}
