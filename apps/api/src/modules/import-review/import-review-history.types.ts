import type { ImportReviewFamilySummaryMetrics } from "./import-review-summary-counts.js";
import type { ImportReviewPublishStageLogItem } from "./import-review-promotion.types.js";

export type ImportReviewHistoryReviewBatchCounts = {
    batch_total_candidates: number;
    active_candidates: number;
    pending_review_candidates: number;
    approved_candidates: number;
    rejected_candidates: number;
    promoted_candidates: number;
    promotion_failed_candidates: number;
};

export type ImportReviewHistoryPublishBatchRollup = {
    publish_batch_count: number;
    validated_at: string | null;
    promoted_at: string | null;
    validation_success_count: number;
    validation_fail_count: number;
    promotion_success_count: number;
    promotion_fail_count: number;
};

export type ImportReviewHistoryReviewBatchListItem = {
    id: string;
    public_id: string;
    batch_name: string;
    source_snapshot_version: string;
    source_snapshot_id_local: string | null;
    status: string;
    created_at: string;
    uploaded_at: string;
    validated_at: string | null;
    promoted_at: string | null;
    total_candidate_count: number;
    entity_families: string[];
    counts: ImportReviewHistoryReviewBatchCounts;
    counts_by_entity_family: ImportReviewFamilySummaryMetrics[];
    publish_batches: ImportReviewHistoryPublishBatchRollup;
};

export type ImportReviewHistoryReviewBatchDetail = ImportReviewHistoryReviewBatchListItem & {
    region_code: string | null;
    upload_mode: string;
    uploaded_candidate_count: number;
    preserved_reviewed_count: number;
    skipped_count: number;
    summary: unknown;
    publish_batch_summaries: ImportReviewHistoryPublishBatchListItem[];
};

export type ImportReviewHistoryPublishBatchListItem = {
    id: string;
    public_id: string;
    batch_name: string;
    status: string;
    source_review_batch_id: string | null;
    source_snapshot_version: string | null;
    region_code: string | null;
    total_item_count: number;
    success_count: number;
    failed_count: number;
    skipped_count: number;
    validation_total: number;
    validation_done: number;
    validation_percent: number;
    validated_at: string | null;
    created_at: string;
    published_at: string | null;
    promoted_at: string | null;
    validation_success_count: number;
    validation_fail_count: number;
};

export type ImportReviewHistoryPublishBatchDetail = ImportReviewHistoryPublishBatchListItem & {
    note: string | null;
    item_counts: {
        pending: number;
        success: number;
        failed: number;
        skipped: number;
        rolled_back: number;
        total: number;
    };
    item_counts_by_entity_family: Record<
        string,
        { pending: number; success: number; failed: number; skipped: number; total: number }
    >;
    validation_summary: unknown;
    promotion_summary: unknown;
    validation_logs_summary: string | null;
    promotion_logs_summary: string | null;
    process_state_logs: ImportReviewPublishStageLogItem[];
    data_state_summary: {
        failed_items: number;
        skipped_items: number;
        success_with_target_id: number;
        success_missing_target_id: number;
    };
    source_review_batch: {
        id: string;
        batch_name: string;
        source_snapshot_version: string;
        status: string;
    } | null;
};

export type ImportReviewHistoryPublishBatchItem = {
    id: string;
    entity_family: string;
    entity_id: string | null;
    publish_action: string | null;
    publish_status: string;
    review_candidate_table: string | null;
    review_candidate_id: string | null;
    external_id: string | null;
    target_schema: string | null;
    target_table: string | null;
    target_id: string | null;
    error_message: string | null;
    validation_result: unknown;
    published_at: string | null;
    created_at: string;
};

export type ImportReviewHistoryPublishBatchLogsResponse = {
    batch_id: string;
    process_state_logs: ImportReviewPublishStageLogItem[];
    validation_logs_summary: string | null;
    promotion_logs_summary: string | null;
};
