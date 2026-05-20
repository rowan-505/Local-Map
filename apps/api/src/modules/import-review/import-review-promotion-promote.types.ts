export const IMPORT_REVIEW_PUBLISH_PROMOTION_STAGES = [
    { key: "promote_preflight", label: "Preflight", progressEnd: 5 },
    { key: "load_promotable_items", label: "Load items", progressEnd: 10 },
    { key: "final_validation_before_write", label: "Final validation", progressEnd: 20 },
    { key: "promote_buildings_to_core", label: "Promote to core", progressEnd: 60 },
    { key: "write_publish_item_results", label: "Write item results", progressEnd: 70 },
    { key: "verify_core_rows", label: "Verify core rows", progressEnd: 80 },
    { key: "mark_import_review_promoted", label: "Mark import review", progressEnd: 90 },
    { key: "update_batch_summary", label: "Update summary", progressEnd: 95 },
    { key: "promotion_final_response", label: "Final result", progressEnd: 100 },
] as const;

export type ImportReviewPublishPromotionStageKey =
    (typeof IMPORT_REVIEW_PUBLISH_PROMOTION_STAGES)[number]["key"];

export type ImportReviewPublishBatchPromotionResult = {
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

export type PromoteItemOutcome = "inserted" | "updated" | "skipped" | "failed";

export type PromoteItemResult = {
    publish_item_id: bigint;
    outcome: PromoteItemOutcome;
    target_id: bigint | null;
    error_message: string | null;
    before_data: unknown | null;
    after_data: unknown | null;
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
