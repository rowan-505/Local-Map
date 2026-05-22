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

export type {
    ImportReviewFamilySummaryMetrics,
    ImportReviewSummaryRollupMetrics,
} from "./import-review-summary-counts.js";

export type ImportReviewSummaryEnvelope = {
    source_snapshot_version: string;
    review_batch_id: string | null;
    /** Mirrors `review_batches.source_snapshot_id_local`; optional pipeline link metadata. */
    source_snapshot_id_local: string | null;
    batch_name: string | null;
    selected_by:
        | "review_batch_id"
        | "source_snapshot_version_unique"
        | "source_snapshot_version_latest"
        | null;
    status?: string;
    uploaded_at?: string;
    total_candidate_count?: number;
    entity_families?: string[];
};

export type { ImportReviewBatchChoice } from "./import-review-batch-resolver.js";

export type ImportReviewSummaryResponse = ImportReviewSummaryEnvelope & {
    /** Dimension bucket rows for breakdown charts (match_status, review_decision, etc.). */
    entity_summaries: ImportReviewSummaryBucketRow[];
    /** Per-family counts with explicit definitions (sums to `rollup`). */
    family_summaries: import("./import-review-summary-counts.js").ImportReviewFamilySummaryMetrics[];
    /** Batch-wide totals; equals sum of `family_summaries` fields. */
    rollup: import("./import-review-summary-counts.js").ImportReviewSummaryRollupMetrics;
    /** Non-fatal rollup gaps (missing optional candidate tables). */
    warnings?: string[];
    /** @deprecated Prefer `rollup.pending_review_candidates`. */
    total_pending_review_count: number;
    /** @deprecated Prefer `rollup.approved_candidates`. */
    total_approved_count: number;
    /** @deprecated Prefer `rollup.rejected_candidates`. */
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
    /** Reviewer-facing Myanmar label (override + imported sources). */
    name_mm?: string | null;
    /** Reviewer-facing English label (override + imported sources). */
    name_en?: string | null;
    name: string | null;
    class_code: string | null;
    building_type: string | null;
    building_type_id: string | null;
    /** From ref.ref_building_types join (effective building_type_id). */
    building_type_code?: string | null;
    building_type_name?: string | null;
    /** Landuse list/patch only — effective ref.ref_landuse_classes id. */
    landuse_class_id?: string | null;
    /** From ref.ref_landuse_classes join (effective landuse_class_id). */
    landuse_class_code?: string | null;
    landuse_class_name?: string | null;
    landuse_class_name_mm?: string | null;
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
    /** Meters along effective centerline (override geom when present). Roads only. */
    length_m?: number | null;
    /** Merged view: review_overrides[field] when present, else imported/normalized. */
    effective_name?: string | null;
    effective_name_mm?: string | null;
    effective_name_en?: string | null;
    /** Undetermined-language label preserved from tags.name when not mapped to en/mm. */
    effective_name_und?: string | null;
    effective_name_local?: string | null;
    effective_stop_code?: string | null;
    effective_canonical_name?: string | null;
    effective_class_code?: string | null;
    effective_landuse_class_id?: string | null;
    effective_admin_area_id?: string | null;
    effective_admin_area_name?: string | null;
    /** Roads list: resolved admin area display name */
    admin_area_name?: string | null;
    effective_levels?: number | null;
    effective_height_m?: number | null;
    effective_full_address?: string | null;
    effective_house_number?: string | null;
    effective_street_name?: string | null;
    effective_quarter?: string | null;
    effective_township?: string | null;
    /** Addresses: generated from import_review.address_components (readonly). */
    generated_full_address_en?: string | null;
    generated_full_address_my?: string | null;
    display_full_address?: string | null;
    source_entity_type?: string | null;
    source_name?: string | null;
    source_type_hint?: string | null;
    source_context?: import("./import-review-address-responses.js").AddressSourceContext;
    map_preview_layers?: import("./import-review-address-responses.js").AddressMapPreviewLayers | null;
    validation_status?: string | null;
    promotion_blockers?: unknown;
    promotion_warnings?: unknown;
    /** Addresses detail: grouped components by type and language. */
    address_components?: import("./import-review-address-responses.js").AddressComponentsGrouped;
    address_components_flat?: import("./import-review-address-responses.js").AddressComponentDto[];
    components_by_type?: Record<
        string,
        import("../addresses/address-composer.types.js").AddressComponentTypeSummary
    >;
    composition_warnings?: string[];
    source_tags?: unknown;
    matched_admin_area_id?: string | null;
    matched_street_id?: string | null;
    matched_building_id?: string | null;
    matched_place_id?: string | null;
    admin_match_type?: string | null;
    street_match_type?: string | null;
    admin_match_confidence?: number | null;
    street_match_confidence?: number | null;
    promoted_core_address_id?: string | null;
    validated_at?: string | null;
    entrance_geometry?: ImportReviewGeoJson | null;
    /** List: township/village/quarter display from components. */
    locality?: string | null;
    street?: string | null;
    house_number?: string | null;
    city?: string | null;
    effective_admin_level_id?: string | null;
    effective_parent_id?: string | null;
    effective_slug?: string | null;
    effective_barrier_type?: string | null;
    has_overrides?: boolean;
    overridden_fields?: string[];
};

export type ImportReviewCandidateListItem = ImportReviewBuildingListItem;

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

/** GET /api/import-review/:family/filter-options */
export type ImportReviewFilterOptionsResponse = ImportReviewSummaryEnvelope & {
    [key: string]: string[] | string | number | null | undefined;
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
