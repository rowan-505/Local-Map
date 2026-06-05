"use client";

import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import { PromotionStatusBadge } from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import type { ImportReviewPublishBatchDetail, ImportReviewPublishBatchProgressResponse } from "@/src/lib/api";

import { formatPublishBatchTimestamp } from "./formatPublishBatchTimestamp";

type Props = {
    batchDetail: ImportReviewPublishBatchDetail;
    progress: ImportReviewPublishBatchProgressResponse | null;
    workflowStatusLabel: string;
    polling: boolean;
};

function MetaRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="mt-1 text-sm font-medium text-gray-900">{value}</dd>
        </div>
    );
}

export function ImportReviewPromotionBatchStatusCard({
    batchDetail,
    progress,
    workflowStatusLabel,
    polling,
}: Props) {
    const processed = progress?.processed_count ?? progress?.item_processed_count ?? 0;
    const total = progress?.total ?? progress?.total_item_count ?? batchDetail.total_item_count;
    const percent = progress?.percent ?? progress?.validation_percent ?? 0;
    const stageLabel =
        progress?.current_stage_label ??
        progress?.current_stage ??
        progress?.current_stage_key ??
        "—";
    const heartbeat = formatPublishBatchTimestamp(
        progress?.last_heartbeat_at ??
            progress?.validation_heartbeat_at ??
            progress?.promotion_heartbeat_at ??
            null
    );

    return (
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-gray-900">Batch status</h2>
                <PromotionStatusBadge value={workflowStatusLabel} />
                {polling ? <ImportReviewInlineSpinner label="Updating…" /> : null}
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <MetaRow label="Batch ID" value={batchDetail.id} />
                <MetaRow
                    label="Status"
                    value={progress?.status ?? batchDetail.status}
                />
                <MetaRow label="Current stage" value={stageLabel} />
                <MetaRow
                    label="Processed / total"
                    value={`${processed.toLocaleString()} / ${total.toLocaleString()}`}
                />
                <MetaRow label="Percent" value={`${Math.round(percent)}%`} />
                <MetaRow label="Last heartbeat" value={heartbeat} />
                <MetaRow
                    label="Created"
                    value={formatPublishBatchTimestamp(batchDetail.created_at)}
                />
                <MetaRow
                    label="Validated"
                    value={formatPublishBatchTimestamp(
                        progress?.validated_at ?? null
                    )}
                />
                <MetaRow
                    label="Promoted"
                    value={formatPublishBatchTimestamp(batchDetail.promoted_at)}
                />
            </dl>

            {progress?.current_message ? (
                <p className="mt-3 text-sm text-gray-700">{progress.current_message}</p>
            ) : null}
            {progress?.derived_status_reason ? (
                <p className="mt-1 text-xs text-gray-500">{progress.derived_status_reason}</p>
            ) : null}
        </section>
    );
}
