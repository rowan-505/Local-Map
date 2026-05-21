import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";

export const CLEANUP_INELIGIBLE_REASONS = [
    "already_cleaned",
    "not_promoted",
    "missing_promoted_core_id",
    "missing_publish_item",
    "publish_item_not_success",
    "publish_batch_not_promoted",
    "core_row_missing",
    "lineage_missing",
    "failed_item_exists",
    "verification_failed",
    "unsupported_entity_family",
] as const;

export type CleanupIneligibleReason = (typeof CLEANUP_INELIGIBLE_REASONS)[number];

export const CLEANUP_SUPPORTED_FAMILIES = [
    "buildings",
    "places",
    "landuse",
    "water_lines",
    "water_polygons",
    "bus_stops",
    "roads",
    "addresses",
    "admin_areas",
    "routing_barriers",
] as const satisfies readonly ImportReviewEntityFamilySlug[];

export type CleanupPromotedScope = {
    reviewBatchId: bigint;
    entityFamilies: ImportReviewEntityFamilySlug[];
    publishBatchId?: bigint;
    olderThanDays?: number;
};

export type CleanupEvaluatedRow = {
    candidate_id: bigint;
    entity_family: ImportReviewEntityFamilySlug;
    reason: CleanupIneligibleReason | null;
    publish_batch_id: bigint | null;
    promoted_core_id: bigint | null;
    promoted_at: Date | null;
    geometry_count: number;
};

export type CleanupExampleRow = {
    candidate_id: string;
    entity_family: string;
    promoted_core_id: string | null;
    promoted_at: string | null;
    publish_batch_id: string | null;
};

export type CleanupBlockedExampleRow = CleanupExampleRow & {
    reason: CleanupIneligibleReason;
};

export type ImportReviewCleanupPromotedDryRunResult = {
    review_batch_id: string;
    publish_batch_id: string | null;
    selected_entity_families: string[];
    eligible_counts_by_entity: Record<string, number>;
    not_eligible_counts_by_reason: Record<string, number>;
    estimated_rows_to_delete: number;
    estimated_geometry_rows_to_delete: number;
    example_eligible_rows: CleanupExampleRow[];
    example_blocked_rows: CleanupBlockedExampleRow[];
    execute_enabled: boolean;
    message: string;
};

export type ImportReviewCleanupPromotedExecuteResult = {
    review_batch_id: string;
    publish_batch_id: string | null;
    deleted_count: number;
    deleted_by_entity: Record<string, number>;
    message: string;
};
