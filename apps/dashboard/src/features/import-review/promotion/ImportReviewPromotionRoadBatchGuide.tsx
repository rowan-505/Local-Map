"use client";

import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import {
    buildRoadSqlBulkPsqlCommand,
    ROAD_API_BULK_PROMOTION_ENV_VAR,
    ROAD_API_BULK_PROMOTION_PUBLIC_ENV,
    ROAD_SQL_BULK_PROMOTE_SCRIPT,
    ROAD_SQL_BULK_VALIDATE_SCRIPT,
    type RoadBulkPromotionUxPolicy,
} from "@/src/features/import-review/promotion/roadBulkPromotionUx";

type BatchStateCounts = {
    promoted: number;
    failed: number;
    pendingReady: number;
    blocked: number;
    warnings: number;
};

type Props = {
    batchId: string;
    sourceReviewBatchId?: string | null;
    policy: RoadBulkPromotionUxPolicy;
    batchState: BatchStateCounts;
    canCreateRetryBatch: boolean;
    retryBatchButtonLabel: string | null;
    isCreatingRetryBatch: boolean;
    onCreateRetryBatch?: () => void;
};

function StateTile({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone?: "success" | "warning" | "error" | "neutral";
}) {
    const toneClass =
        tone === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : tone === "warning"
              ? "border-amber-200 bg-amber-50 text-amber-950"
              : tone === "error"
                ? "border-red-200 bg-red-50 text-red-950"
                : "border-gray-200 bg-white text-gray-900";
    return (
        <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
            <p className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
        </div>
    );
}

export default function ImportReviewPromotionRoadBatchGuide({
    batchId,
    sourceReviewBatchId,
    policy,
    batchState,
    canCreateRetryBatch,
    retryBatchButtonLabel,
    isCreatingRetryBatch,
    onCreateRetryBatch,
}: Props) {
    const validateCmd = buildRoadSqlBulkPsqlCommand({
        script: ROAD_SQL_BULK_VALIDATE_SCRIPT,
        publishBatchId: batchId,
        dryRun: true,
    });
    const promoteDryRunCmd = buildRoadSqlBulkPsqlCommand({
        script: ROAD_SQL_BULK_PROMOTE_SCRIPT,
        publishBatchId: batchId,
        reviewBatchId: sourceReviewBatchId,
        dryRun: true,
        limitRows: 50,
    });
    const promoteCommitCmd = buildRoadSqlBulkPsqlCommand({
        script: ROAD_SQL_BULK_PROMOTE_SCRIPT,
        publishBatchId: batchId,
        reviewBatchId: sourceReviewBatchId,
        dryRun: false,
    });

    return (
        <section className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50/60 p-4">
            <div>
                <h3 className="text-sm font-semibold text-indigo-950">Road batch — what to do next</h3>
                <p className="mt-1 text-sm text-indigo-900">
                    {policy.recommendSqlBulk
                        ? `This batch has ${policy.roadsReadyCount.toLocaleString()} ready road(s) at validation (more than 50). Use SQL bulk scripts for reliable promotion.`
                        : `Small road batch (${policy.roadsReadyCount.toLocaleString()} ready): dashboard API promotion is fine after validation and road dry-run.`}
                </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <StateTile label="Promoted (success)" value={batchState.promoted} tone="success" />
                <StateTile label="Failed" value={batchState.failed} tone="error" />
                <StateTile
                    label="Pending ready"
                    value={batchState.pendingReady}
                    tone={batchState.pendingReady > 0 ? "success" : "neutral"}
                />
                <StateTile label="Blocked (validation)" value={batchState.blocked} tone="error" />
            </div>
            {batchState.warnings > 0 ? (
                <p className="text-sm text-indigo-900">
                    {batchState.warnings.toLocaleString()} validation warning
                    {batchState.warnings === 1 ? "" : "s"} — optional to promote with confirmation when using API on small batches.
                </p>
            ) : null}

            {policy.recommendSqlBulk && policy.sqlBulkWarning ? (
                <ImportReviewStatusBanner message={policy.sqlBulkWarning} tone="warning" compact />
            ) : null}

            {policy.recommendSqlBulk ? (
                <div className="space-y-3 rounded-md border border-indigo-300 bg-white/80 p-3 text-sm text-indigo-950">
                    <p className="font-medium">SQL bulk promotion (recommended)</p>
                    <ol className="list-decimal space-y-1 pl-5">
                        {policy.nextSteps.map((step) => (
                            <li key={step}>{step}</li>
                        ))}
                    </ol>
                    <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-indigo-800">
                            Validate (dry-run)
                        </p>
                        <pre className="overflow-x-auto rounded bg-indigo-950/90 p-2 text-xs text-indigo-50">
                            {validateCmd}
                        </pre>
                        <p className="text-xs font-medium uppercase tracking-wide text-indigo-800">
                            Promote dry-run (50 rows)
                        </p>
                        <pre className="overflow-x-auto rounded bg-indigo-950/90 p-2 text-xs text-indigo-50">
                            {promoteDryRunCmd}
                        </pre>
                        <p className="text-xs font-medium uppercase tracking-wide text-indigo-800">
                            Promote commit
                        </p>
                        <pre className="overflow-x-auto rounded bg-indigo-950/90 p-2 text-xs text-indigo-50">
                            {promoteCommitCmd}
                        </pre>
                        <p className="text-xs text-indigo-800">
                            Script path:{" "}
                            <code className="rounded bg-indigo-100 px-1">{ROAD_SQL_BULK_PROMOTE_SCRIPT}</code>
                            {sourceReviewBatchId ? (
                                <>
                                    {" "}
                                    · review_batch_id={sourceReviewBatchId}
                                </>
                            ) : null}
                        </p>
                    </div>
                    {!policy.apiBulkPromotionAllowed ? (
                        <p className="text-xs text-indigo-800">
                            Dashboard <strong>Promote</strong> is disabled for this batch. Dev-only API override:{" "}
                            <code className="rounded bg-indigo-100 px-1">{ROAD_API_BULK_PROMOTION_ENV_VAR}</code> on the API
                            and{" "}
                            <code className="rounded bg-indigo-100 px-1">{ROAD_API_BULK_PROMOTION_PUBLIC_ENV}=true</code>{" "}
                            for the dashboard.
                        </p>
                    ) : null}
                </div>
            ) : policy.nextSteps.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-indigo-900">
                    {policy.nextSteps.map((step) => (
                        <li key={step}>{step}</li>
                    ))}
                </ul>
            ) : null}

            {canCreateRetryBatch && onCreateRetryBatch ? (
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                    <p className="text-sm text-amber-950">
                        No pending-ready items left, but failed+ready items can move to a new publish batch.
                    </p>
                    <button
                        type="button"
                        onClick={onCreateRetryBatch}
                        disabled={isCreatingRetryBatch}
                        className="rounded-md border border-amber-500 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50"
                    >
                        {isCreatingRetryBatch ? "Creating retry batch…" : retryBatchButtonLabel}
                    </button>
                </div>
            ) : null}
        </section>
    );
}
