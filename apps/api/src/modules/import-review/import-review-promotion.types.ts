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
    derived_status: string;
    derived_status_reason: string | null;
    stored_status_recommendation: string | null;
    status_note: string | null;
    source_review_batch_id: string | null;
    source_snapshot_version: string | null;
    region_code: string | null;
    total_item_count: number;
    success_count: number;
    failed_count: number;
    skipped_count: number;
    core_verified_count: number;
    import_review_marked_promoted_count: number;
    inserted_count: number;
    updated_count: number;
    note: string | null;
    created_at: string;
    published_at: string | null;
    promoted_at: string | null;
};

export type ImportReviewPublishBatchEntityItemCounts = {
    pending: number;
    success: number;
    failed: number;
    skipped: number;
    total: number;
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
    /** Buildings-only counts (legacy). */
    building_item_counts: {
        pending: number;
        success: number;
        failed: number;
        skipped: number;
        rolled_back: number;
        total: number;
    };
    item_counts_by_entity_family: Record<string, ImportReviewPublishBatchEntityItemCounts>;
};

export type ImportReviewPromotionSkippedReasonCount = {
    reason: string;
    count: number;
};

export type ImportReviewPromotionFamilyEligibilityCounts = {
    entity_family: string;
    table_name: string;
    approved_ready: number;
    with_warnings: number;
    blocked: number;
    already_promoted: number;
    excluded: number;
    skipped_reasons: ImportReviewPromotionSkippedReasonCount[];
};

export type ImportReviewPromotionBatchEligibilityResponse = {
    review_batch_id: string;
    source_snapshot_version: string;
    entity_families: string[];
    by_family: ImportReviewPromotionFamilyEligibilityCounts[];
    totals: {
        approved_ready: number;
        with_warnings: number;
        blocked: number;
        already_promoted: number;
    };
};

export type ImportReviewPromotionCreateBatchFamilyResult = {
    entity_family: string;
    items_added: number;
    marked_batched: number;
    skipped_reasons: ImportReviewPromotionSkippedReasonCount[];
};

export type ImportReviewPromotionCreateBatchStage = {
    stage_key: string;
    stage_label: string;
    message: string;
    counts: Record<string, number>;
};

export type ImportReviewCreatePublishBatchTimingMs = {
    resolve_ms: number;
    eligibility_ms: number;
    payload_ms: number;
    transaction_ms: number;
    total_ms: number;
};

export type ImportReviewCreatePublishBatchDryRunResult = {
    dry_run: true;
    batch_name: string;
    entity_families: string[];
    totals: { included: number; excluded: number; skipped: number };
    by_family: Array<{
        entity_family: string;
        included: number;
        excluded: number;
        skipped: number;
        skipped_reasons: ImportReviewPromotionSkippedReasonCount[];
    }>;
    stages: ImportReviewPromotionCreateBatchStage[];
    message: string;
    total_selected: number;
    by_entity: Record<string, number>;
    skipped: number;
    timing_ms: ImportReviewCreatePublishBatchTimingMs;
};

export type ImportReviewCreatePublishBatchResult = {
    dry_run?: false;
    message: string;
    batch: ImportReviewPublishBatchDetail;
    batch_id: string;
    status: string;
    items_added: number;
    total_selected: number;
    candidates_marked_batched: number;
    by_family: ImportReviewPromotionCreateBatchFamilyResult[];
    by_entity: Record<string, number>;
    skipped: number;
    timing_ms: ImportReviewCreatePublishBatchTimingMs;
    /** @deprecated Use candidates_marked_batched / by_family for buildings slice */
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
    building_type_code: string | null;
    building_type_name: string | null;
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

export type ImportReviewPublishBatchEntityValidationCounts = {
    total: number;
    valid: number;
    warning: number;
    blocked: number;
    skipped: number;
};

export type ImportReviewPublishBatchValidationResultSummary = {
    outcome: "passed" | "blocked";
    can_promote: boolean;
    requires_warning_confirmation: boolean;
    valid_count: number;
    warning_count: number;
    blocked_count: number;
    skipped_count: number;
    total_items: number;
    by_publish_action: { insert: number; update: number; merge: number };
    by_entity: Record<string, ImportReviewPublishBatchEntityValidationCounts>;
    /** @deprecated Use by_entity */
    entity_family: { buildings: number };
    promotable_entity_families: string[];
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
    verification_metadata_applied_count: number;
    verification_metadata_skipped_already_verified_count: number;
    partial_success?: boolean;
    started_at: string;
    finished_at: string;
    duration_ms: number;
    promoted_entity_families: string[];
};

export type ImportReviewPublishBatchProgressResponse = {
    batch_id: string;
    status: string;
    derived_status: string;
    derived_status_reason: string | null;
    stored_status_recommendation: string | null;
    status_note: string | null;
    workflow: "validation" | "promotion" | "idle";
    validation_total: number;
    validation_done: number;
    validation_percent: number;
    /** Total publish items included in validation progress. */
    total_item_count: number;
    /** Items that completed all validation substages (never exceeds total_item_count). */
    item_processed_count: number;
    /** Number of per-item validation substages. */
    stage_count: number;
    validated_at: string | null;
    current_stage_key: string | null;
    current_stage_label: string | null;
    current_stage_status: string | null;
    current_entity_family: string | null;
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

export type ImportReviewRepairInvalidPromotedBatchesResponse = {
    scanned: number;
    repaired: number;
    skipped: number;
    batches: Array<{
        id: string;
        previous_status: string;
        new_status: string;
        derived_status: string;
    }>;
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

import type { PublishStageStatus } from "./import-review-promotion-stage-status.js";

export type ImportReviewPublishStageLogItem = {
    id: string;
    stage_key: string;
    stage_label: string;
    stage_status: PublishStageStatus;
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
