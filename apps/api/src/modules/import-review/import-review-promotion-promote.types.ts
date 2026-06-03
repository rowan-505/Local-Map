import type { PromotionFailureSample } from "./import-review-promotion-failure.js";
import type { PromotionFailureCause } from "./import-review-promotion-failure-cause.js";
import { PROMOTABLE_PUBLISH_FAMILIES } from "./import-review-promotion-config.js";
import {
    promotionStageKeyForFamily,
    promotionStageLabelForFamily,
} from "./import-review-promotion-promote-api.js";

export type { ImportReviewPublishPromotionStageKey } from "./import-review-promotion-promote-stages.js";

export const IMPORT_REVIEW_PUBLISH_PROMOTION_FAMILY_STAGES = PROMOTABLE_PUBLISH_FAMILIES.map(
    (entityFamily) => ({
        key: promotionStageKeyForFamily(entityFamily),
        entityFamily,
        label: promotionStageLabelForFamily(entityFamily),
    })
);

export type ImportReviewPublishBatchPromotionFamilyCounts = {
    success: number;
    failed: number;
    skipped: number;
    inserted: number;
    updated: number;
};

export type ImportReviewPublishBatchPromotionResult = {
    status: "promoted" | "partially_promoted" | "failed";
    promoted_count: number;
    skipped_blocked_count: number;
    skipped_warning_count: number;
    inserted_count: number;
    updated_count: number;
    /** @deprecated Prefer promoted_count */
    success_count: number;
    failed_count: number;
    skipped_count: number;
    total: number;
    partial_promotion?: boolean;
    core_verified_count: number;
    import_review_marked_promoted_count: number;
    verification_metadata_applied_count: number;
    verification_metadata_skipped_already_verified_count: number;
    partial_success?: boolean;
    started_at: string;
    finished_at: string;
    duration_ms: number;
    promoted_entity_families: string[];
    by_entity_family: Record<string, ImportReviewPublishBatchPromotionFamilyCounts>;
    sample_failures?: PromotionFailureSample[];
};

export type PromoteItemOutcome = "inserted" | "updated" | "skipped" | "failed";

export type PromoteItemResult = {
    publish_item_id: bigint;
    outcome: PromoteItemOutcome;
    target_id: bigint | null;
    error_message: string | null;
    before_data: unknown | null;
    after_data: unknown | null;
    /** Structured cause for applyItemFailure (not persisted on result row directly). */
    failure_cause?: PromotionFailureCause | null;
    verification_metadata_applied?: boolean;
    verification_metadata_skipped_already_verified?: boolean;
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
