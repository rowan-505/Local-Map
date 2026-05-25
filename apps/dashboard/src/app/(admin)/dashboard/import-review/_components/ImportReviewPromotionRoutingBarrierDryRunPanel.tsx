"use client";

import { useCallback, useEffect, useState } from "react";

import { PromotionSectionHeading } from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import {
    getImportReviewPromotionBatchRoutingBarrierDryRun,
    isAbortError,
    postImportReviewPromotionBatchRoutingBarrierDryRun,
    type ImportReviewPromotionRoutingBarrierDryRunResult,
} from "@/src/lib/api";

type Props = {
    batchId: string;
    formatError: (err: unknown) => string;
    onDryRunUpdated?: (result: ImportReviewPromotionRoutingBarrierDryRunResult | null) => void;
};

function Count({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-md border border-purple-200 bg-white px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900">{value.toLocaleString()}</dd>
        </div>
    );
}

export default function ImportReviewPromotionRoutingBarrierDryRunPanel({
    batchId,
    formatError,
    onDryRunUpdated,
}: Props) {
    const [result, setResult] = useState<ImportReviewPromotionRoutingBarrierDryRunResult | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isLoadingCached, setIsLoadingCached] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const applyResult = useCallback(
        (next: ImportReviewPromotionRoutingBarrierDryRunResult | null) => {
            setResult(next);
            onDryRunUpdated?.(next);
        },
        [onDryRunUpdated]
    );

    useEffect(() => {
        const controller = new AbortController();
        setIsLoadingCached(true);
        void getImportReviewPromotionBatchRoutingBarrierDryRun(batchId, { signal: controller.signal })
            .then(applyResult)
            .catch((err) => {
                if (!isAbortError(err)) applyResult(null);
            })
            .finally(() => {
                if (!controller.signal.aborted) setIsLoadingCached(false);
            });
        return () => controller.abort();
    }, [batchId, applyResult]);

    async function handleRunDryRun() {
        setIsRunning(true);
        setError(null);
        try {
            const next = await postImportReviewPromotionBatchRoutingBarrierDryRun(batchId, {
                revalidate: true,
            });
            applyResult(next);
        } catch (err) {
            setError(formatError(err));
        } finally {
            setIsRunning(false);
        }
    }

    const notableItems = result
        ? result.items.filter((item) => item.dry_run_status !== "safe_to_promote").slice(0, 10)
        : [];

    return (
        <section className="border-t border-gray-100 pt-6">
            <PromotionSectionHeading
                title="Routing barrier dry-run"
                subtitle="Preview routing-affecting barrier rows. This does not edit routing_edges or rebuild the graph."
            />

            <div className="mt-4 space-y-4">
                <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-purple-950">
                    <p className="font-medium">Routing barriers are high-risk routing source data.</p>
                    <p className="mt-1 text-xs">
                        Live writes require{" "}
                        <code className="rounded bg-white/80 px-1">
                            ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION=true
                        </code>
                        . More than 5 barriers also require{" "}
                        <code className="rounded bg-white/80 px-1">
                            ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_BULK_PROMOTION=true
                        </code>
                        .
                    </p>
                </div>

                <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => void handleRunDryRun()}
                    className="rounded-md border border-purple-600 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-50"
                >
                    {isRunning ? <ImportReviewInlineSpinner label="Running barrier dry-run..." /> : "Routing barrier dry run"}
                </button>
                {isLoadingCached && !result ? <ImportReviewInlineSpinner label="Loading cached dry-run..." /> : null}
                {error ? <ImportReviewStatusBanner message={error} tone="error" compact /> : null}

                {result ? (
                    <div className="space-y-4 rounded-lg border border-purple-200 bg-purple-50 p-4 text-sm text-purple-950">
                        <p className="font-semibold">{result.message}</p>
                        <p className="text-xs">
                            Gate status:{" "}
                            {result.disabled_because_env_flag_false
                                ? "API env flag is disabled"
                                : "API env flag is enabled"}
                        </p>
                        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <Count label="Total" value={result.total_count} />
                            <Count label="Safe" value={result.safe_to_promote_count} />
                            <Count label="With warning" value={result.promote_with_warning_count} />
                            <Count label="Blocked" value={result.blocked_count} />
                            <Count label="Network warnings" value={result.network_warning_count} />
                            <Count label="Duplicate risk" value={result.duplicate_risk_count} />
                            <Count label="Would insert" value={result.would_insert_count} />
                            <Count label="Would update" value={result.would_update_count} />
                        </dl>
                        {notableItems.length > 0 ? (
                            <div className="rounded-md border border-purple-200 bg-white p-3 text-xs">
                                <p className="mb-2 font-medium text-gray-900">Dry-run warnings and blockers</p>
                                <ul className="space-y-2">
                                    {notableItems.map((item) => (
                                        <li key={item.publish_item_id}>
                                            <span className="font-mono">{item.review_candidate_id}</span>{" "}
                                            {item.dry_run_status}:{" "}
                                            {[...item.blocking_reasons, ...item.warning_codes].join(", ") || "none"}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </section>
    );
}
