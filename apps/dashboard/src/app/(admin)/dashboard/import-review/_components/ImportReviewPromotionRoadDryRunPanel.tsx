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
    type ImportReviewPromotionRoadDryRunResult,
    type RoadDryRunItemStatus,
} from "@/src/lib/api";

const STATUS_LABELS: Record<RoadDryRunItemStatus, string> = {
    blocked: "Blocked",
    warning: "Warning",
    eligible: "Eligible",
    eligible_if_confirmed: "Eligible if confirmed",
};

function statusBadgeClass(status: RoadDryRunItemStatus): string {
    switch (status) {
        case "eligible":
            return "bg-emerald-50 text-emerald-800 ring-emerald-200";
        case "warning":
            return "bg-amber-50 text-amber-900 ring-amber-200";
        case "eligible_if_confirmed":
            return "bg-orange-50 text-orange-900 ring-orange-200";
        case "blocked":
        default:
            return "bg-red-50 text-red-800 ring-red-200";
    }
}

type Props = {
    batchId: string;
    formatError: (err: unknown) => string;
    onDryRunUpdated?: (result: ImportReviewPromotionRoadDryRunResult | null) => void;
};

export default function ImportReviewPromotionRoadDryRunPanel({
    batchId,
    formatError,
    onDryRunUpdated,
}: Props) {
    const [result, setResult] = useState<ImportReviewPromotionRoadDryRunResult | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isLoadingCached, setIsLoadingCached] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const applyResult = useCallback(
        (next: ImportReviewPromotionRoadDryRunResult | null) => {
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
            const next = await postImportReviewPromotionBatchRoadDryRun(batchId, {});
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
                subtitle="Preview road publish items with blocking checks and routing validation. Does not write to core.core_streets."
            />

            <div className="mt-4 space-y-4">
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-950">
                    <p className="font-medium">Roads affect routing and are not bulk-promoted by default.</p>
                    <p className="mt-1 text-xs">
                        Run road dry-run before considering promotion. Real road promotion requires{" "}
                        <code className="rounded bg-red-100 px-1">ENABLE_IMPORT_REVIEW_ROAD_PROMOTION=true</code> on
                        the API server.
                    </p>
                </div>

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
                            "Road dry run"
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
                            <p className="font-semibold">Dry-run result</p>
                            <p className="mt-1 text-xs opacity-90">{result.message}</p>
                            {result.disabled_because_env_flag_false ? (
                                <p className="mt-2 text-xs font-medium text-red-900">
                                    Road promotion is disabled on the API (
                                    <code className="rounded bg-red-100 px-1">
                                        ENABLE_IMPORT_REVIEW_ROAD_PROMOTION
                                    </code>{" "}
                                    is not true).
                                </p>
                            ) : (
                                <p className="mt-2 text-xs font-medium text-emerald-900">
                                    Road promotion env flag is enabled on the API (core writes still require a
                                    future promote module).
                                </p>
                            )}
                        </div>

                        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <Count label="Would insert" value={result.would_insert_count} />
                            <Count label="Would update" value={result.would_update_count} />
                            <Count label="Blocked" value={result.blocked_count} tone="error" />
                            <Count label="Warnings" value={result.warning_count} tone="warning" />
                            <Count label="Routing warnings" value={result.routing_warning_count} />
                            <Count label="Serious warnings" value={result.serious_warning_count} />
                            <Count label="Duplicate risk" value={result.duplicate_risk_count} />
                            <Count
                                label="Eligible if confirmed"
                                value={result.eligible_if_confirmed_count}
                            />
                        </dl>

                        {result.items.length > 0 ? (
                            <div className="overflow-x-auto rounded-md border border-blue-200 bg-white">
                                <table className="min-w-full text-left text-xs">
                                    <thead className="border-b border-gray-200 bg-gray-50 text-gray-600">
                                        <tr>
                                            <th className="px-3 py-2 font-medium">Status</th>
                                            <th className="px-3 py-2 font-medium">External id</th>
                                            <th className="px-3 py-2 font-medium">Action</th>
                                            <th className="px-3 py-2 font-medium">Blockers</th>
                                            <th className="px-3 py-2 font-medium">Warnings</th>
                                            <th className="px-3 py-2 font-medium">Core match</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {result.items.map((item) => (
                                            <tr key={item.publish_item_id} className="text-gray-800">
                                                <td className="px-3 py-2">
                                                    <span
                                                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${statusBadgeClass(item.dry_run_status)}`}
                                                    >
                                                        {STATUS_LABELS[item.dry_run_status]}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 font-mono">
                                                    {item.external_id ?? "—"}
                                                </td>
                                                <td className="px-3 py-2">{item.publish_action}</td>
                                                <td className="px-3 py-2">
                                                    {item.blocking_reasons.length > 0
                                                        ? item.blocking_reasons.join(", ")
                                                        : "—"}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {item.warning_codes.length > 0
                                                        ? item.warning_codes.join(", ")
                                                        : "—"}
                                                </td>
                                                <td className="px-3 py-2 font-mono">
                                                    {item.matched_core_id ?? "—"}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-xs">No road publish items in this batch.</p>
                        )}

                        <p className="text-xs opacity-75">
                            Finished {new Date(result.finished_at).toLocaleString()} ·{" "}
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

function Count({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone?: "error" | "warning";
}) {
    const valueCls =
        tone === "error"
            ? "text-red-800"
            : tone === "warning"
              ? "text-amber-800"
              : "text-blue-950";
    return (
        <div>
            <dt className="text-xs uppercase tracking-wide opacity-75">{label}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${valueCls}`}>
                {value.toLocaleString()}
            </dd>
        </div>
    );
}
