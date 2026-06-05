"use client";

import type { ReactNode } from "react";
import type {
    ImportReviewPublishBatchProgressResponse,
    ImportReviewPublishBatchVerifyResponse,
} from "@/src/lib/api";
import {
    getDryRunProgress,
    getPromotionProgress,
    getValidationProgress,
} from "@/src/features/import-review/promotion/publishBatchStageProgress";
import { dryRunDisplayStatus } from "@/src/features/import-review/promotion/publishBatchSimpleFlow";

import { formatPublishBatchTimestamp } from "./formatPublishBatchTimestamp";

type Props = {
    progress: ImportReviewPublishBatchProgressResponse | null;
    verifyResult: ImportReviewPublishBatchVerifyResponse | null;
};

function ProgressBar({ percent }: { percent: number }) {
    const p = Math.min(100, Math.max(0, Math.round(percent)));
    return (
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
                className="h-full rounded-full bg-emerald-600 transition-all"
                style={{ width: `${p}%` }}
            />
        </div>
    );
}

function StageSection({
    title,
    percent,
    processed,
    total,
    statusLine,
    extra,
}: {
    title: string;
    percent: number;
    processed: number;
    total: number;
    statusLine: string;
    extra?: ReactNode;
}) {
    return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
            <p className="mt-1 text-xs text-gray-600">{statusLine}</p>
            <ProgressBar percent={percent} />
            <p className="mt-2 text-xs tabular-nums text-gray-700">
                {processed.toLocaleString()} / {total.toLocaleString()} ({Math.round(percent)}%)
            </p>
            {extra}
        </div>
    );
}

export function ImportReviewPromotionBatchProgressSections({ progress, verifyResult }: Props) {
    if (!progress) {
        return null;
    }

    const validation = getValidationProgress(progress);
    const dryRun = getDryRunProgress(progress);
    const promotion = getPromotionProgress(progress);
    const dryRunMeta = progress.dry_run_result;
    const dryRunLabel = dryRunDisplayStatus(dryRunMeta);

    const verifyActive = progress.current_stage === "verify_items";

    return (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Progress</h3>
            <div className="grid gap-3 sm:grid-cols-2">
                <StageSection
                    title="Validation"
                    percent={validation.percent}
                    processed={validation.done}
                    total={validation.total}
                    statusLine={
                        progress.validated_at
                            ? `Completed ${formatPublishBatchTimestamp(progress.validated_at)}`
                            : validation.active
                              ? (progress.current_stage_label ?? "Running")
                              : "Not started"
                    }
                    extra={
                        progress.validation_result ? (
                            <p className="mt-2 text-xs text-gray-600">
                                {(progress.validation_result.ready_count ??
                                    progress.validation_result.valid_count ??
                                    0
                                ).toLocaleString()}{" "}
                                ready ·{" "}
                                {progress.validation_result.blocked_count.toLocaleString()} blocked
                            </p>
                        ) : null
                    }
                />
                <StageSection
                    title="Dry-run"
                    percent={dryRun.percent}
                    processed={dryRun.done}
                    total={dryRun.total}
                    statusLine={
                        dryRun.active
                            ? (progress.current_stage_label ?? "Running")
                            : `Status: ${dryRunLabel.replace("_", " ")}`
                    }
                    extra={
                        dryRunMeta?.blocked_count != null ? (
                            <p className="mt-2 text-xs text-gray-600">
                                {dryRunMeta.ready_count?.toLocaleString() ?? "0"} ready ·{" "}
                                {dryRunMeta.blocked_count.toLocaleString()} blocked in dry-run
                            </p>
                        ) : null
                    }
                />
                <StageSection
                    title="Promotion"
                    percent={promotion.percent}
                    processed={promotion.done}
                    total={promotion.total}
                    statusLine={
                        promotion.active
                            ? (progress.current_stage_label ?? "Promoting")
                            : progress.promotion_status
                              ? `Outcome: ${progress.promotion_status.replace(/_/g, " ")}`
                              : progress.promotion_result
                                ? `Finished ${formatPublishBatchTimestamp(progress.promotion_result.finished_at)}`
                                : "Not started"
                    }
                    extra={
                        progress.publish_item_status_counts ? (
                            <p className="mt-2 text-xs text-gray-600">
                                {progress.publish_item_status_counts.success.toLocaleString()} promoted ·{" "}
                                {progress.publish_item_status_counts.failed.toLocaleString()} failed ·{" "}
                                {progress.publish_item_status_counts.pending.toLocaleString()} pending
                            </p>
                        ) : null
                    }
                />
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <h4 className="text-sm font-semibold text-gray-900">Verification</h4>
                    {verifyResult ? (
                        <>
                            <p className="mt-1 text-xs capitalize text-gray-600">
                                Status: {verifyResult.verification_status}
                            </p>
                            <p className="mt-2 text-xs text-gray-700">
                                Publish items: {verifyResult.publish_items.success} success,{" "}
                                {verifyResult.publish_items.failed} failed,{" "}
                                {verifyResult.publish_items.pending} pending
                            </p>
                            {verifyResult.core_rows_missing > 0 ? (
                                <p className="mt-1 text-xs text-amber-800">
                                    {verifyResult.core_rows_missing} core rows missing
                                </p>
                            ) : null}
                        </>
                    ) : verifyActive ? (
                        <>
                            <p className="mt-1 text-xs text-gray-600">
                                {progress.current_stage_label ?? "Verifying…"}
                            </p>
                            <ProgressBar percent={progress.percent ?? 0} />
                        </>
                    ) : (
                        <p className="mt-1 text-xs text-gray-600">Run verify after promotion completes.</p>
                    )}
                </div>
            </div>
        </section>
    );
}
