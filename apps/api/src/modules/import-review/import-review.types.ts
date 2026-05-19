/** Grouped rollup row for `/api/import-review/summary` (imports every requested dimension explicitly). */

export type ImportReviewSummaryBucketRow = {
    entity_family: string;
    review_batch_id: string;
    source_snapshot_version: string;
    match_status: string | null;
    auto_action: string | null;
    review_status: string | null;
    review_decision: string | null;
    promotion_status: string | null;
    row_count: number;
};

export type ImportReviewSummaryEnvelope = {
    source_snapshot_version: string;
    review_batch_id: string | null;
    /** Mirrors `review_batches.source_snapshot_id_local`; optional pipeline link metadata. */
    source_snapshot_id_local: string | null;
};

export type ImportReviewSummaryResponse = ImportReviewSummaryEnvelope & {
    entity_summaries: ImportReviewSummaryBucketRow[];
    /** Non-fatal rollup gaps (missing optional candidate tables). */
    warnings?: string[];
    total_pending_review_count: number;
    total_approved_count: number;
    total_rejected_count: number;
};

/** GeoJSON object from PostGIS ST_AsGeoJSON */
export type ImportReviewGeoJson = Record<string, unknown>;

/** Building candidate row surfaced from `import_review.building_candidates`; family list responses reuse this shape with NULLed building-specific fields where not applicable. */
export type ImportReviewBuildingListItem = {
    id: string;
    public_id: string;
    review_batch_id: string;
    source_snapshot_version: string;
    local_staging_id: string;
    /** Optional link to originating local snapshot PK when mirrored from pipeline. */
    source_snapshot_id_local: string | null;
    external_id: string | null;
    canonical_name: string | null;
    name: string | null;
    class_code: string | null;
    building_type: string | null;
    building_type_id: string | null;
    admin_area_id: string | null;
    levels: number | null;
    height_m: number | null;
    area_m2: number | null;
    confidence_score: number | null;
    match_status: string | null;
    auto_action: string | null;
    review_status: string | null;
    /** Stored API decision values match `needs_more_review`, etc.; DB column aligns with ingestion. */
    review_decision: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_note: string | null;
    normalized_data: unknown;
    source_refs: unknown;
    review_overrides: unknown;
    matched_core_id: string | null;
    matched_core_table: string | null;
    matched_core_data: unknown;
    f2_comparison: unknown;
    validation_warnings: unknown;
    validation_errors: unknown;
    promotion_status: string | null;
    promoted_core_id: string | null;
    created_at: string;
    updated_at: string;
    /** Prefer `geom`; kept for dashboards that still bind `geometry` for MapLibre preview. */
    geometry: ImportReviewGeoJson | null;
    geom: ImportReviewGeoJson | null;
    centroid: ImportReviewGeoJson | null;
    /** Road list/PATCH only (`import_review.road_candidates`). */
    road_candidate_road_class_id: string | null;
    road_candidate_class_label: string | null;
    road_candidate_surface: string | null;
    road_candidate_is_oneway: boolean | null;
};

export type ImportReviewBuildingsListResponse = ImportReviewSummaryEnvelope & {
    items: ImportReviewBuildingListItem[];
    total: number;
    limit: number;
    offset: number;
};

/** GET /api/import-review/buildings/filter-options */
export type ImportReviewBuildingsFilterOptionsResponse = ImportReviewSummaryEnvelope & {
    match_status: string[];
    auto_action: string[];
    review_status: string[];
    review_decision: string[];
    class_code: string[];
    promotion_status: string[];
};

export type ImportReviewBulkSkippedReason = {
    reason: string;
    count: number;
};

/** Repository-layer bulk result before service adds envelope. */
export type ImportReviewBulkDecisionRepoResult = {
    updated_count: number;
    skipped_count: number;
    skipped_reasons: ImportReviewBulkSkippedReason[];
    dry_run: boolean;
};

export type ImportReviewBulkDecisionResponse = ImportReviewSummaryEnvelope &
    ImportReviewBulkDecisionRepoResult;
