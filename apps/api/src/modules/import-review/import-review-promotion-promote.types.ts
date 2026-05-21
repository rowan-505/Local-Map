export const IMPORT_REVIEW_PUBLISH_PROMOTION_STAGES = [
    { key: "promote_preflight", label: "Preflight", progressEnd: 5 },
    { key: "load_promotable_items", label: "Load items", progressEnd: 10 },
    { key: "final_validation_before_write", label: "Final validation", progressEnd: 20 },
    { key: "promote_buildings_to_core", label: "Promote buildings", progressEnd: 32 },
    { key: "promote_places_to_core", label: "Promote places", progressEnd: 40 },
    { key: "promote_landuse_to_core", label: "Promote landuse", progressEnd: 48 },
    { key: "promote_water_lines_to_core", label: "Promote water lines", progressEnd: 54 },
    { key: "promote_water_polygons_to_core", label: "Promote water polygons", progressEnd: 60 },
    { key: "promote_bus_stops_to_core", label: "Promote bus stops", progressEnd: 66 },
    { key: "write_publish_item_results", label: "Write item results", progressEnd: 70 },
    { key: "verify_core_rows", label: "Verify core rows", progressEnd: 80 },
    { key: "mark_import_review_promoted", label: "Mark import review", progressEnd: 90 },
    { key: "update_batch_summary", label: "Update summary", progressEnd: 95 },
    { key: "promotion_final_response", label: "Final result", progressEnd: 100 },
] as const;

export type ImportReviewPublishPromotionStageKey =
    (typeof IMPORT_REVIEW_PUBLISH_PROMOTION_STAGES)[number]["key"];

export const IMPORT_REVIEW_PUBLISH_PROMOTION_FAMILY_STAGES = [
    {
        key: "promote_buildings_to_core" as const,
        entityFamily: "buildings" as const,
        label: "Promote buildings",
    },
    {
        key: "promote_places_to_core" as const,
        entityFamily: "places" as const,
        label: "Promote places",
    },
    {
        key: "promote_landuse_to_core" as const,
        entityFamily: "landuse" as const,
        label: "Promote landuse",
    },
    {
        key: "promote_water_lines_to_core" as const,
        entityFamily: "water_lines" as const,
        label: "Promote water lines",
    },
    {
        key: "promote_water_polygons_to_core" as const,
        entityFamily: "water_polygons" as const,
        label: "Promote water polygons",
    },
    {
        key: "promote_bus_stops_to_core" as const,
        entityFamily: "bus_stops" as const,
        label: "Promote bus stops",
    },
];

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
    verification_metadata_applied_count: number;
    verification_metadata_skipped_already_verified_count: number;
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
