export const IMPORT_REVIEW_PUBLISH_ACTIVE_BATCH_STATUSES = [
    "draft",
    "validating",
    "ready",
    "promoting",
] as const;

export type ImportReviewPromotionReadyCounts = {
    entity_family: "buildings";
    review_batch_id: string;
    source_snapshot_version: string;
    ready_count: number;
    already_batched_count: number;
    promoted_count: number;
    blocked_in_active_publish_batch_count: number;
};

export type ImportReviewPublishBatchSummary = {
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
    note: string | null;
    created_at: string;
    published_at: string | null;
    promoted_at: string | null;
};

export type ImportReviewPublishBatchDetail = ImportReviewPublishBatchSummary & {
    item_counts: {
        pending: number;
        success: number;
        failed: number;
        skipped: number;
        rolled_back: number;
        total: number;
    };
    building_item_counts: {
        pending: number;
        success: number;
        failed: number;
        skipped: number;
        rolled_back: number;
        total: number;
    };
};

export type ImportReviewCreatePublishBatchResult = {
    message: string;
    batch: ImportReviewPublishBatchDetail;
    items_added: number;
    building_candidates_marked_batched: number;
};

export type ImportReviewPromotionReadyCandidateItem = {
    id: string;
    public_id: string;
    external_id: string | null;
    name: string | null;
    canonical_name: string | null;
    class_code: string | null;
    building_type: string | null;
    building_type_id: string | null;
    confidence_score: number | null;
    match_status: string | null;
    auto_action: string | null;
    review_status: string | null;
    review_decision: string | null;
    promotion_status: string | null;
    validation_warnings_count: number;
    validation_errors_count: number;
    updated_at: string;
    source_snapshot_version: string;
    review_batch_id: string;
    normalized_data: unknown;
    review_overrides: unknown;
    source_refs: unknown;
    geometry: Record<string, unknown> | null;
};

export type ImportReviewPublishBatchValidationResultSummary = {
    outcome: "passed" | "blocked";
    valid_count: number;
    warning_count: number;
    blocked_count: number;
    total_items: number;
    by_publish_action: { insert: number; update: number; merge: number };
    entity_family: { buildings: number };
};

export type ImportReviewPublishBatchPromotionResultSummary = {
    status: "promoted" | "failed";
    inserted_count: number;
    updated_count: number;
    success_count: number;
    failed_count: number;
    skipped_count: number;
    total: number;
    core_verified_count: number;
    import_review_marked_promoted_count: number;
    partial_success?: boolean;
    started_at: string;
    finished_at: string;
    duration_ms: number;
    promoted_entity_families: string[];
};

export type ImportReviewPublishBatchProgressResponse = {
    batch_id: string;
    status: string;
    workflow: "validation" | "promotion" | "idle";
    validation_total: number;
    validation_done: number;
    validation_percent: number;
    validated_at: string | null;
    current_stage_key: string | null;
    current_stage_label: string | null;
    current_stage_status: string | null;
    current_message: string | null;
    validation_result: ImportReviewPublishBatchValidationResultSummary | null;
    validation_logs_summary: string | null;
    promotion_result: ImportReviewPublishBatchPromotionResultSummary | null;
    promotion_logs_summary: string | null;
};

export type ImportReviewStartPublishBatchPromotionResponse = {
    batch_id: string;
    status: string;
    message: string;
};

export type ImportReviewPublishBatchVerifyResponse = {
    batch_id: string;
    verification_status: "passed" | "warning" | "failed";
    publish_items: {
        success: number;
        failed: number;
        pending: number;
        skipped: number;
        success_missing_target_id: number;
    };
    core_rows_missing: number;
    core_rows_inactive: number;
    candidates_promoted_missing_core_id: number;
    lineage_warnings: number;
    geometry_warnings: number;
    issues: { code: string; message: string; severity: "error" | "warning" }[];
};

export type ImportReviewPublishStageLogItem = {
    id: string;
    stage_key: string;
    stage_label: string;
    stage_status: string;
    message: string | null;
    progress_percent: number;
    details: unknown;
    started_at: string;
    finished_at: string | null;
};

export type ImportReviewPublishBatchLogsResponse = {
    batch_id: string;
    items: ImportReviewPublishStageLogItem[];
};

export type ImportReviewStartPublishBatchValidationResponse = {
    batch_id: string;
    status: string;
    message: string;
};

export type ImportReviewPromotionReadyCandidatesResponse = {
    items: ImportReviewPromotionReadyCandidateItem[];
    total: number;
    limit: number;
    offset: number;
    counts: {
        ready: number;
        already_batched: number;
        promoted: number;
        blocked_active_batch: number;
    };
};
