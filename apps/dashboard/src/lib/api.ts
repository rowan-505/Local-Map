import {
    attachImportReviewDevAdminTokenHeader,
    isImportReviewDevRouteBypassActive,
    isImportReviewApiPath,
    logImportReviewAuthDecision,
    markImportReviewApiAuthFailed,
    readImportReviewAuthDebugState,
} from "./importReviewDevAccess";
import { resolveImportReviewApiFamily } from "@/src/features/import-review/utils/importReviewApiFamily";

type QueryValue = string | number | boolean | null | undefined;

/** True when `fetch` was aborted (Strict Mode remount, navigation, dependency change). */
export function isAbortError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    return (error as { name?: string }).name === "AbortError";
}

export type Place = {
    id: string;
    public_id: string;
    primary_name: string;
    secondary_name: string | null;
    name_local: string | null;
    display_name: string;
    myanmarName: string | null;
    englishName: string | null;
    /** Optional API fields (snake/camel variants) — used by dashboard preview labels when present */
    nameMm?: string | null;
    nameEn?: string | null;
    myanmar_name?: string | null;
    english_name?: string | null;
    name_mm?: string | null;
    name_en?: string | null;
    category_id: string;
    admin_area_id: string | null;
    lat: number;
    lng: number;
    is_public: boolean;
    is_verified: boolean;
    names: PlaceName[];
    category_name: string | null;
    admin_area_name: string | null;
    /** ISO timestamps from GET /places (list and detail). */
    created_at: string;
    updated_at: string;
};

export type PlaceDetail = Place & {
    plus_code: string | null;
    importance_score: number | null;
    popularity_score: number | null;
    confidence_score: number | null;
    source_type_id: string;
    publish_status_id: string | null;
};

export type PlaceName = {
    id: string;
    name: string;
    language_code: string | null;
    script_code: string | null;
    name_type: string;
    is_primary: boolean;
    search_weight: number;
};

export type PlacesParams = {
    q?: string;
    category?: string;
    is_public?: boolean;
    is_verified?: boolean;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
};

/** Max `limit` for GET /places (API rejects values above this). */
export const PLACES_LIST_LIMIT = 100;

export type Category = {
    id: string;
    code: string;
    name: string;
    name_mm: string | null;
    sort_order: number;
};

export type AdminArea = {
    id: string;
    parent_id: string | null;
    admin_level_id: string;
    canonical_name: string;
    slug: string;
    is_active: boolean;
};

export type PlaceFormOption = {
    id: string;
    label: string;
    code?: string;
};

export type PlaceFormOptions = {
    categories: PlaceFormOption[];
    admin_areas: PlaceFormOption[];
    source_types: PlaceFormOption[];
    publish_statuses: PlaceFormOption[];
};

/** Body for POST /places — field names match the API */
export type CreatePlacePayload = {
    myanmarName?: string;
    englishName?: string;
    categoryId: string;
    adminAreaId?: string | null;
    lat: number;
    lng: number;
    plusCode?: string | null;
    importanceScore?: number;
    popularityScore?: number;
    confidenceScore?: number;
    isPublic?: boolean;
    isVerified?: boolean;
    sourceTypeId?: string | null;
    publishStatusId?: string | null;
};

export type UpdatePlacePayload = Partial<CreatePlacePayload>;

/** GeoJSON from API (existing OSM rows may be MultiLineString). */
export type StreetGeometry =
    | {
          type: "LineString";
          coordinates: number[][];
      }
    | {
          type: "MultiLineString";
          coordinates: number[][][];
      }
    | null;

/** Payload for POST/PATCH centerline (API accepts LineString only). */
export type StreetLineStringGeoJson = {
    type: "LineString";
    coordinates: number[][];
};

export type Street = {
    public_id: string;
    canonical_name: string;
    myanmarName: string | null;
    englishName: string | null;
    names: StreetName[];
    admin_area_id: string | null;
    admin_area_name: string | null;
    source_type_id?: string;
    road_class_id: string | null;
    road_class: string | null;
    road_class_name: string | null;
    surface: string | null;
    is_oneway: boolean;
    bridge: boolean;
    tunnel: boolean;
    manual_override: boolean;
    edit_status: string;
    routing_status: string;
    deleted_at: string | null;
    last_edited_at: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    geometry: StreetGeometry;
};

export type StreetDetail = Street;

export type UpdateStreetPayload = {
    myanmarName?: string;
    englishName?: string;
    admin_area_id?: string | null;
    geometry?: StreetLineStringGeoJson;
    road_class_id?: string | null;
    is_oneway?: boolean;
    surface?: string | null;
    edit_reason?: string;
    bridge?: boolean;
    tunnel?: boolean;
};

export type CreateStreetPayload = {
    myanmarName?: string;
    englishName?: string;
    admin_area_id?: string | null;
    road_class_id: string;
    is_oneway?: boolean;
    surface?: string | null;
    bridge?: boolean;
    tunnel?: boolean;
    geometry: StreetLineStringGeoJson;
};

export type DeleteStreetPayload = {
    edit_reason?: string;
};

export type RoadClassOption = {
    id: string;
    code: string;
    name: string;
    rank: number;
};

export type StreetName = {
    id: string;
    name: string;
    language_code: string | null;
    script_code: string | null;
    name_type: string;
    is_primary: boolean;
};

export type StreetsParams = {
    limit?: number;
    q?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    /** When true, include soft-deleted streets. */
    include_deleted?: boolean;
};

/** GET /streets/nearest-point — `street_id` is core street `public_id` (UUID). */
export type NearestStreetPointHit = {
    street_id: string;
    nearest: { lng: number; lat: number };
    distance_m: number;
    street_name: string | null;
    road_class: string | null;
};

/** POST /streets/validate-geometry — camelCase response. */
export type StreetGeometryConnectionApi = {
    streetId: string;
    nearest: { lng: number; lat: number };
    distanceM: number;
    streetName: string | null;
    roadClass: string | null;
} | null;

export type StreetGeometryCrossingApi = {
    streetId: string;
    streetName: string | null;
    roadClass: string | null;
};

export type StreetGeometryDuplicateApi = StreetGeometryCrossingApi & {
    kind: "overlap" | "near_duplicate";
};

export type ValidateStreetGeometryResponse = {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    startConnection: StreetGeometryConnectionApi;
    endConnection: StreetGeometryConnectionApi;
    crossings: StreetGeometryCrossingApi[];
    duplicates: StreetGeometryDuplicateApi[];
};

export type BuildingPolygonGeometry = {
    type: "Polygon";
    coordinates: number[][][];
};

export type BuildingMultiPolygonGeometry = {
    type: "MultiPolygon";
    coordinates: number[][][][];
};

export type BuildingGeometry = BuildingPolygonGeometry | BuildingMultiPolygonGeometry;

/** Row from ref.ref_landuse_classes (GET /admin/ref/landuse-classes). */
export type RefLanduseClass = {
    id: string;
    code: string;
    name_en: string;
    name_mm: string | null;
    parent_id: string | null;
    sort_order: number | null;
    min_zoom: number | null;
    is_active: boolean;
};

/** Row from ref.ref_boundary_statuses (GET /admin/ref/boundary-statuses). */
export type RefBoundaryStatus = {
    id: string;
    code: string;
    name_en: string;
    name_mm: string | null;
    helper_en: string | null;
    helper_mm: string | null;
    sort_order: number;
    default_is_official_boundary: boolean;
    default_boundary_confidence_score: number;
    default_address_usage_code: string | null;
    is_active: boolean;
};

/** Row from ref.ref_address_usage_types (GET /admin/ref/address-usage-types). */
export type RefAddressUsageType = {
    id: string;
    code: string;
    name_en: string;
    name_mm: string | null;
    helper_en: string | null;
    helper_mm: string | null;
    sort_order: number;
    is_active: boolean;
};

/** Row from ref.ref_building_types (GET /building-types and embedded on buildings). */
export type RefBuildingType = {
    id: string;
    code: string;
    name: string;
    name_mm: string | null;
    parent_id: string | null;
    /** Present on GET /building-types; omitted on embedded building references. */
    sort_order?: number;
};

/** Embedded admin area on building API responses. */
export type BuildingAdminAreaRef = {
    id: string;
    canonical_name: string;
    slug: string;
};

export type Building = {
    id: string;
    public_id: string;
    source_staging_id: string | null;
    external_id: string | null;
    name_mm?: string | null;
    name_en?: string | null;
    fallback_name?: string | null;
    /** Coalesced display label (mm → en → fallback). */
    name: string | null;
    /** FK to ref.ref_building_types (when exposed by API). */
    building_type_id?: string | null;
    /** Resolved taxonomy; null when not linked to ref or inactive. */
    building_type: RefBuildingType | null;
    /** From ref join (flat); use for display when building_type object is null. */
    building_type_code?: string | null;
    building_type_name?: string | null;
    building_type_name_mm?: string | null;
    /** Optional FK to core.core_admin_areas. */
    admin_area_id?: string | null;
    admin_area?: BuildingAdminAreaRef | null;
    class_code: string;
    normalized_data: Record<string, unknown>;
    source_refs: Record<string, unknown>;
    levels: number | null;
    height_m: number | null;
    area_m2: number | null;
    confidence_score: number | null;
    is_verified: boolean;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    /** Omitted in some list responses — fetch `GET /buildings/:id` for full footprint when missing. */
    geometry?: BuildingGeometry | null;
};

/** Default/max `limit` for GET /buildings (aligned with API default 100). */
export const BUILDINGS_LIST_LIMIT = 100;

export type BuildingsParams = {
    q?: string;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
};

/** GET /dashboard/stats — matches Fastify dashboard stats payload. */
export type DashboardStatsMainCounts = {
    places: number;
    map_buildings: number;
    streets: number;
    admin_areas: number;
    addresses: number;
};

export type DashboardStatsMetadataCounts = {
    place_names: number;
    street_names: number;
    admin_area_names: number;
    place_contacts: number;
    place_sources: number;
    place_media: number;
    place_versions: number;
};

export type DashboardStatsTransitCounts = {
    bus_routes: number;
    bus_route_variants: number;
    bus_stops: number;
    bus_route_stops: number;
};

export type DashboardStatsHealthCounts = {
    places_active: number;
    places_deleted: number;
    places_verified: number;
    places_unverified: number;
    buildings_active: number;
    buildings_deleted: number;
    streets_active: number;
    streets_inactive: number;
};

export type DashboardStatsOverview = {
    total_main_rows: number;
    total_metadata_rows: number;
    total_transit_rows: number;
};

export type DashboardStatsResponse = {
    overview: DashboardStatsOverview;
    main: DashboardStatsMainCounts;
    metadata: DashboardStatsMetadataCounts;
    transit: DashboardStatsTransitCounts;
    health: DashboardStatsHealthCounts;
};
export type ImportReviewEnvelopeFields = {
    source_snapshot_version: string;
    review_batch_id: string | null;
    source_snapshot_id_local: string | null;
    batch_name?: string | null;
    selected_by?:
        | "review_batch_id"
        | "source_snapshot_version_unique"
        | "source_snapshot_version_latest"
        | null;
    status?: string;
    uploaded_at?: string;
    total_candidate_count?: number;
    entity_families?: string[];
};

export type ImportReviewBatchChoice = {
    id: string;
    batch_name: string;
    status: string;
    uploaded_at: string;
    total_candidate_count: number;
    entity_families: string[];
};

/** Thrown when multiple non-archived review batches share a source_snapshot_version. */
export class ImportReviewBatchAmbiguousError extends Error {
    readonly status = 409;

    constructor(
        public readonly sourceSnapshotVersion: string,
        public readonly batches: ImportReviewBatchChoice[],
        message?: string
    ) {
        super(message ?? "Multiple review batches matched source_snapshot_version");
        this.name = "ImportReviewBatchAmbiguousError";
    }
}

export function isImportReviewBatchAmbiguousError(err: unknown): err is ImportReviewBatchAmbiguousError {
    return err instanceof ImportReviewBatchAmbiguousError;
}

/** Query/body selectors accepted by `/api/import-review/*` — prefer `review_batch_id` when set. */
export type ImportReviewEnvelopeQuery = {
    source_snapshot_version?: string;
    snapshot_version?: string;
    review_batch_id?: string;
    latest?: boolean;
};

function normalizedImportReviewUrlParams(params?: Record<string, QueryValue>): Record<string, QueryValue> | undefined {
    if (!params) {
        return undefined;
    }

    const next: Record<string, QueryValue> = { ...params };
    const batchRaw = next.review_batch_id;
    const batchId =
        batchRaw !== undefined && batchRaw !== null && String(batchRaw).trim() !== ""
            ? String(batchRaw).trim()
            : "";

    const snapshotAlias = next.snapshot_version;
    delete next.snapshot_version;

    if (batchId) {
        next.review_batch_id = batchId;
        delete next.source_snapshot_version;
        delete next.latest;
        return next;
    }

    const snapshotCanon = next.source_snapshot_version;

    const ssv =
        snapshotCanon !== undefined &&
        snapshotCanon !== null &&
        String(snapshotCanon).trim() !== ""
            ? String(snapshotCanon).trim()
            : snapshotAlias !== undefined &&
                snapshotAlias !== null &&
                String(snapshotAlias).trim() !== ""
              ? String(snapshotAlias).trim()
              : "";

    if (ssv) {
        next.source_snapshot_version = ssv;
    } else {
        delete next.source_snapshot_version;
    }

    delete next.review_batch_id;

    return next;
}

function wireImportReviewJsonBody(body: Record<string, unknown>): Record<string, unknown> {
    const next = { ...body };
    delete next.snapshot_version;

    const batchRaw = next.review_batch_id;
    const batchId = typeof batchRaw === "string" || typeof batchRaw === "number" ? String(batchRaw).trim() : "";
    if (batchId) {
        next.review_batch_id = batchId;
        delete next.source_snapshot_version;
        delete next.latest;
        return next;
    }

    const raw = next.source_snapshot_version;
    if (typeof raw === "string" && raw.trim()) {
        next.source_snapshot_version = raw.trim();
    } else {
        delete next.source_snapshot_version;
    }
    delete next.review_batch_id;

    return next;
}

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

export type ImportReviewFamilySummaryMetrics = {
    entity_family: string;
    table_name: string;
    batch_total: number;
    active: number;
    pending_review: number;
    approved: number;
    rejected: number;
    needs_review: number;
    ignored: number;
    merged: number;
    ready_for_publish: number;
    promoted: number;
    promotion_failed: number;
    validation_error_count: number;
    validation_warning_count: number;
};

export type ImportReviewSummaryRollupMetrics = {
    batch_total_candidates: number;
    active_candidates: number;
    pending_review_candidates: number;
    approved_candidates: number;
    rejected_candidates: number;
    needs_review_candidates: number;
    ignored_candidates: number;
    merged_candidates: number;
    ready_for_publish_candidates: number;
    promoted_candidates: number;
    promotion_failed_candidates: number;
};

export type ImportReviewSummaryResponse = ImportReviewEnvelopeFields & {
    entity_summaries: ImportReviewSummaryBucketRow[];
    family_summaries: ImportReviewFamilySummaryMetrics[];
    rollup: ImportReviewSummaryRollupMetrics;
    warnings?: string[];
    /** @deprecated Prefer rollup.pending_review_candidates */
    total_pending_review_count: number;
    /** @deprecated Prefer rollup.approved_candidates */
    total_approved_count: number;
    /** @deprecated Prefer rollup.rejected_candidates */
    total_rejected_count: number;
};

/** GeoJSON geometry for import-review rows when include_geometry=true. */
export type ImportReviewGeoJson = Record<string, unknown>;

export type ImportReviewBuildingListItem = {
    id: string;
    public_id: string;
    review_batch_id: string;
    source_snapshot_version: string;
    local_staging_id: string;
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
    building_type_code?: string | null;
    building_type_name?: string | null;
    landuse_class_id?: string | null;
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
    review_decision: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_note: string | null;
    normalized_data: unknown;
    source_refs: unknown;
    review_overrides?: unknown;
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
    geometry: ImportReviewGeoJson | null;
    geom?: ImportReviewGeoJson | null;
    centroid?: ImportReviewGeoJson | null;
    /** Populated on road endpoints when available. */
    road_candidate_road_class_id?: string | null;
    road_candidate_class_label?: string | null;
    road_candidate_surface?: string | null;
    road_candidate_is_oneway?: boolean | null;
    /** Meters along effective centerline (roads list/detail). */
    length_m?: number | null;
    /** Roads: resolved admin area display name */
    admin_area_name?: string | null;
    effective_name?: string | null;
    effective_name_mm?: string | null;
    effective_name_en?: string | null;
    effective_name_und?: string | null;
    effective_name_local?: string | null;
    effective_stop_code?: string | null;
    effective_canonical_name?: string | null;
    effective_class_code?: string | null;
    effective_landuse_class_id?: string | null;
    effective_admin_area_id?: string | null;
    effective_admin_area_name?: string | null;
    effective_levels?: number | null;
    effective_height_m?: number | null;
    effective_full_address?: string | null;
    /** Addresses list/detail: API-composed display address. */
    display_full_address?: string | null;
    generated_full_address_en?: string | null;
    generated_full_address_my?: string | null;
    house_number?: string | null;
    street?: string | null;
    locality?: string | null;
    city?: string | null;
    validation_status?: string | null;
    promotion_blockers?: unknown;
    promotion_warnings?: unknown;
    matched_admin_area_id?: string | null;
    matched_street_id?: string | null;
    matched_building_id?: string | null;
    matched_place_id?: string | null;
    admin_match_type?: string | null;
    street_match_type?: string | null;
    admin_match_confidence?: number | null;
    street_match_confidence?: number | null;
    validated_at?: string | null;
    source_tags?: unknown;
    source_entity_type?: string | null;
    source_name?: string | null;
    source_type_hint?: string | null;
    source_context?: ImportReviewAddressSourceContext;
    map_preview_layers?: ImportReviewAddressMapPreviewLayers | null;
    address_components_flat?: ImportReviewAddressComponentDto[];
    address_components?: Record<string, Record<string, ImportReviewAddressComponentDto[]>>;
    composition_warnings?: string[];
    entrance_geometry?: ImportReviewGeoJson | null;
    effective_house_number?: string | null;
    effective_street_name?: string | null;
    effective_quarter?: string | null;
    effective_township?: string | null;
    effective_admin_level_id?: string | null;
    effective_parent_id?: string | null;
    effective_slug?: string | null;
    effective_barrier_type?: string | null;
    has_overrides?: boolean;
    overridden_fields?: string[];
};

export type ImportReviewBuildingsListResponse = ImportReviewEnvelopeFields & {
    items: ImportReviewBuildingListItem[];
    total: number;
    limit: number;
    offset: number;
};



export type ImportReviewBuildingsFilterOptionsResponse = ImportReviewEnvelopeFields & {
    match_status: string[];
    auto_action: string[];
    review_status: string[];
    review_decision: string[];
    class_code: string[];
    promotion_status: string[];
};

export type ImportReviewDecision =
    | "approved"
    | "rejected"
    | "needs_more_review"
    | "ignored"
    | "merged";

export type ImportReviewBuildingsListParams = ImportReviewEnvelopeQuery & {
    match_status?: string;
    auto_action?: string;
    review_status?: string;
    review_decision?: string;
    promotion_status?: string;
    class_code?: string;
    q?: string;
    limit?: number;
    offset?: number;
    sort?: string;
    include_geometry?: boolean;
    include_promoted?: boolean;
};

/** Generic entity family list (underscore apiFamily in URL path). */
export type ImportReviewFamilyListParams = Omit<ImportReviewBuildingsListParams, "class_code">;

export type ImportReviewFamilyFilterOptionsResponse = ImportReviewEnvelopeFields & {
    match_status: string[];
    auto_action: string[];
    review_status: string[];
    review_decision: string[];
    promotion_status: string[];
    class_code?: string[];
    [key: string]: string[] | string | number | null | undefined;
};

/** Places/roads list — same as buildings but no `class_code` filter. */
export type ImportReviewPlacesListParams = Omit<ImportReviewBuildingsListParams, "class_code">;
export type ImportReviewRoadsListParams = Omit<ImportReviewBuildingsListParams, "class_code">;

export type PatchImportReviewBuildingDecisionBody = ImportReviewEnvelopeQuery & {
    review_decision: ImportReviewDecision;
    review_note?: string | null;
    force?: boolean;
    confirm_duplicate_reviewed?: boolean;
    /** Roads: approving when matched as auto-update candidate requires confirmation. */
    confirm_matched_auto_update?: boolean;
    /** Roads: approving while `validation_warnings` remain requires this or `force`. */
    confirm_routing_warnings?: boolean;
};

export type PatchImportReviewBuildingOverridesBody = ImportReviewEnvelopeQuery & {
    review_overrides: Record<string, unknown>;
    review_note?: string | null;
};

export type ImportReviewRoadReviewOverridesLeaf = {
    name_mm?: string | null;
    name_en?: string | null;
    road_class_id?: string | number | bigint | null;
    admin_area_id?: string | number | bigint | null;
    is_oneway?: boolean | null;
    surface?: string | null;
    confidence_score?: number | null;
    geom?: ImportReviewGeoJson | null;
    /** @deprecated Legacy road override key. */
    canonical_name?: string | null;
    /** @deprecated Legacy road override key. */
    road_class_code?: string | null;
};

export type PatchImportReviewRoadOverridesBody = ImportReviewEnvelopeQuery & {
    review_overrides: ImportReviewRoadReviewOverridesLeaf;
    review_note?: string | null;
    routing_validation_tolerance_meters?: number;
    confirm_acknowledge_routing_warnings?: boolean;
};

export type ImportReviewBulkFiltersBody = {
    match_status?: string;
    auto_action?: string;
    review_decision?: string | null;
};

export type PostImportReviewBuildingsBulkBody = ImportReviewEnvelopeQuery & {
    review_decision: ImportReviewDecision;
    review_note?: string | null;
    force?: boolean;
    dry_run?: boolean;
    ids?: (string | number)[];
    filters?: ImportReviewBulkFiltersBody;
};

export type ImportReviewBulkSkippedReason = {
    reason: string;
    count: number;
};

export type ImportReviewBulkDecisionResponse = ImportReviewEnvelopeFields & {
    updated_count: number;
    skipped_count: number;
    skipped_reasons: ImportReviewBulkSkippedReason[];
    dry_run: boolean;
};

export type DeleteBuildingResponse = {
    ok: boolean;
    deleted: boolean;
    public_id: string;
};

export type PlaceBuildingRelationType = "inside" | "entrance" | "nearby" | "compound";

export type LinkedBuildingSummaryApi = {
    relation_type: string;
    is_primary: boolean;
    created_at: string;
    building: {
        public_id: string;
        name: string | null;
        building_type_id?: string | null;
        building_type: RefBuildingType | null;
        building_type_code?: string | null;
        building_type_name?: string | null;
        building_type_name_mm?: string | null;
        class_code: string;
        area_m2: number | null;
        admin_area?: BuildingAdminAreaRef | null;
    };
};

export type LinkedPlaceSummaryApi = {
    relation_type: string;
    is_primary: boolean;
    created_at: string;
    place: {
        public_id: string;
        primary_name: string | null;
        display_name: string | null;
        lat?: number | null;
        lng?: number | null;
        category_name: string | null;
    };
};

export type LinkedPlacesForBuildingResponse = {
    items: LinkedPlaceSummaryApi[];
};

export type LinkedPlaceBuildingListResponse = {
    items: LinkedBuildingSummaryApi[];
};

export type LinkPlaceBuildingPayload = {
    building_id: string;
    relation_type?: PlaceBuildingRelationType;
    is_primary?: boolean;
};

export type PatchPlaceBuildingPayload = {
    relation_type?: PlaceBuildingRelationType;
    is_primary?: boolean;
};

/** POST /places/:id/buildings */
export type LinkPlaceBuildingResponse = LinkedBuildingSummaryApi & {
    place_id: string;
};

/** PATCH /places/:id/buildings/:buildingId */
export type PatchPlaceBuildingResponse = LinkPlaceBuildingResponse;

/** POST/PATCH bodies — snake_case matches API JSON */
export type CreateBuildingPayload = {
    geometry: BuildingGeometry;
    /** Fallback/imported label (core_map_buildings.name). */
    name?: string | null;
    name_mm?: string | null;
    name_en?: string | null;
    /** Prefer {@link building_type_id} when both are set (API resolves ref codes). */
    building_type?: string;
    /** Omit or null: create omits; PATCH may send null to clear FK. */
    building_type_id?: string | null;
    /** Omit, set, or null (PATCH) to clear. */
    admin_area_id?: string | null;
    levels?: number;
    height_m?: number;
    confidence_score?: number;
    is_verified?: boolean;
};

export type UpdateBuildingPayload = Partial<CreateBuildingPayload>;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

function getApiBaseUrl(): string {
    if (!API_BASE_URL) {
        throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.");
    }

    return API_BASE_URL.replace(/\/+$/, "");
}

function buildUrl(path: string, params?: Record<string, QueryValue>): string {
    const url = new URL(path, `${getApiBaseUrl()}/`);

    if (!params) {
        return url.toString();
    }

    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") {
            continue;
        }

        url.searchParams.set(key, String(value));
    }

    return url.toString();
}

function getAccessToken(): string | null {
    if (typeof window === "undefined") {
        return null;
    }

    return window.localStorage.getItem("accessToken");
}

function clearAuthTokens() {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.removeItem("accessToken");
    window.localStorage.removeItem("token");
    window.localStorage.removeItem("authToken");
    window.localStorage.removeItem("jwt");
}

function redirectToLogin(reason: string) {
    if (typeof window === "undefined") {
        return;
    }

    const pathname = window.location.pathname;

    if (pathname === "/login") {
        return;
    }

    if (isImportReviewDevRouteBypassActive(pathname)) {
        logImportReviewAuthDecision(
            "apiFetch.redirectToLogin",
            `skip-dev-route-bypass:${reason}`,
            readImportReviewAuthDebugState(pathname, false)
        );
        return;
    }

    logImportReviewAuthDecision(
        "apiFetch.redirectToLogin",
        reason,
        readImportReviewAuthDebugState(pathname, false)
    );

    window.location.replace("/login");
}

/** Formats API `issues` from Zod `.flatten()` or `{ path, message }[]` (e.g. building geometry validation). */
function formatApiIssuesBlock(issues: unknown): string {
    if (issues === undefined || issues === null) {
        return "";
    }

    if (Array.isArray(issues)) {
        const lines: string[] = [];

        for (const item of issues) {
            if (item && typeof item === "object" && !Array.isArray(item)) {
                const rec = item as { path?: unknown; message?: unknown };
                const path = typeof rec.path === "string" && rec.path.trim() ? rec.path.trim() : "";
                const msg = typeof rec.message === "string" && rec.message.trim() ? rec.message.trim() : "";

                if (path && msg) {
                    lines.push(`• ${path}: ${msg}`);
                } else if (msg) {
                    lines.push(`• ${msg}`);
                } else {
                    lines.push(`• ${JSON.stringify(item)}`);
                }
            } else {
                lines.push(`• ${String(item)}`);
            }
        }

        return lines.join("\n");
    }

    if (typeof issues === "object") {
        const o = issues as { formErrors?: unknown; fieldErrors?: Record<string, unknown> };
        const lines: string[] = [];

        if (Array.isArray(o.formErrors)) {
            for (const fe of o.formErrors) {
                if (typeof fe === "string" && fe.trim()) {
                    lines.push(`• ${fe.trim()}`);
                }
            }
        }

        if (o.fieldErrors && typeof o.fieldErrors === "object") {
            for (const [field, errs] of Object.entries(o.fieldErrors)) {
                if (Array.isArray(errs)) {
                    for (const err of errs) {
                        if (typeof err === "string" && err.trim()) {
                            lines.push(`• ${field}: ${err.trim()}`);
                        }
                    }
                }
            }
        }

        return lines.join("\n");
    }

    return `• ${String(issues)}`;
}

async function getErrorMessage(response: Response): Promise<string> {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
        let data: Record<string, unknown>;

        try {
            data = (await response.json()) as Record<string, unknown>;
        } catch {
            return `Request failed with status ${response.status}`;
        }

        const headline: string[] = [];

        if (typeof data.message === "string" && data.message.trim()) {
            headline.push(data.message.trim());
        }

        if (typeof data.error === "string" && data.error.trim()) {
            headline.push(data.error.trim());
        }

        const issuesBlock = formatApiIssuesBlock(data.issues);

        if (issuesBlock) {
            return headline.length > 0 ? `${headline.join(" — ")}\n\n${issuesBlock}` : issuesBlock;
        }

        const extraBullets: string[] = [];

        if (Array.isArray(data.errors)) {
            for (const entry of data.errors) {
                if (typeof entry === "string" && entry.trim()) {
                    extraBullets.push(`✗ ${entry.trim()}`);
                }
            }
        }

        if (Array.isArray(data.warnings)) {
            for (const entry of data.warnings) {
                if (typeof entry === "string" && entry.trim()) {
                    extraBullets.push(`⚠ ${entry.trim()}`);
                }
            }
        }

        const extraBlock =
            extraBullets.length > 0
                ? extraBullets.length <= 30
                    ? extraBullets.join("\n")
                    : `${extraBullets.slice(0, 25).join("\n")}\n…(+${extraBullets.length - 25} more)`
                : "";

        if (extraBlock) {
            return headline.length > 0 ? `${headline.join(" — ")}\n\n${extraBlock}` : extraBlock;
        }

        if (headline.length > 0) {
            return headline.join(" — ");
        }

        return JSON.stringify(data);
    }

    const text = await response.text();

    if (text.trim()) {
        return text;
    }

    return `Request failed with status ${response.status}`;
}

export async function apiFetch<T>(
    path: string,
    init: RequestInit = {},
    params?: Record<string, QueryValue>
): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");

    const importReviewHeaderFallbackOk = attachImportReviewDevAdminTokenHeader(headers, path);
    const accessToken = getAccessToken();
    const importReviewApiDevAuth = importReviewHeaderFallbackOk && isImportReviewApiPath(path);

    if (accessToken && !importReviewApiDevAuth) {
        headers.set("Authorization", `Bearer ${accessToken}`);
    } else if (accessToken && importReviewApiDevAuth) {
        logImportReviewAuthDecision(
            "apiFetch",
            "omit-bearer-for-import-review-dev-admin-header",
            readImportReviewAuthDebugState(
                typeof window !== "undefined" ? window.location.pathname : "",
                false
            )
        );
    }

    if (!accessToken && !importReviewHeaderFallbackOk) {
        redirectToLogin("missing-credentials");
        throw new Error("Authentication required");
    }

    const response = await fetch(buildUrl(path, params), {
        ...init,
        headers,
    });

    if (response.status === 401) {
        if (isImportReviewApiPath(path)) {
            markImportReviewApiAuthFailed();
        }
        if (!importReviewHeaderFallbackOk) {
            clearAuthTokens();
            redirectToLogin("http-401");
        } else {
            logImportReviewAuthDecision(
                "apiFetch",
                "http-401-with-dev-admin-header-no-redirect",
                readImportReviewAuthDebugState(
                    typeof window !== "undefined" ? window.location.pathname : "",
                    false
                )
            );
        }
        throw new Error("Session expired. Please log in again.");
    }

    if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? "";

        if (
            response.status === 409 &&
            isImportReviewApiPath(path) &&
            contentType.includes("application/json")
        ) {
            let data: Record<string, unknown>;
            try {
                data = (await response.json()) as Record<string, unknown>;
            } catch {
                throw new Error(`Request failed with status ${response.status}`);
            }

            if (Array.isArray(data.batches) && data.batches.length > 0) {
                const batches = data.batches as ImportReviewBatchChoice[];
                const snap =
                    typeof data.source_snapshot_version === "string"
                        ? data.source_snapshot_version
                        : "";
                const msg = typeof data.message === "string" ? data.message : undefined;
                throw new ImportReviewBatchAmbiguousError(snap, batches, msg);
            }

            const headline: string[] = [];
            if (typeof data.message === "string" && data.message.trim()) {
                headline.push(data.message.trim());
            }
            throw new Error(headline.length > 0 ? headline.join(" — ") : `Request failed with status 409`);
        }

        const message = await getErrorMessage(response);
        throw new Error(message);
    }

    return (await response.json()) as T;
}

export function getPlaces(params?: PlacesParams, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<Place[]>("/places", { method: "GET", ...fetchInit }, params);
}

export function getPlace(id: string, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<PlaceDetail>(`/places/${id}`, { method: "GET", ...fetchInit });
}

export function getPlaceFormOptions() {
    return apiFetch<PlaceFormOptions>("/place-form-options", { method: "GET" });
}

export function updatePlace(id: string, payload: UpdatePlacePayload) {
    return apiFetch<PlaceDetail>(`/places/${id}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function createPlace(payload: CreatePlacePayload) {
    return apiFetch<PlaceDetail>("/places", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function deletePlace(id: string) {
    return apiFetch<{ success: boolean; public_id: string }>(`/places/${id}`, {
        method: "DELETE",
    });
}

export function getCategories() {
    return apiFetch<Category[]>("/categories", { method: "GET" });
}

export function getAdminAreas() {
    return apiFetch<AdminArea[]>("/admin-areas", { method: "GET" });
}

export type AdminAreaOption = {
    id: string;
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
    admin_level_id: string;
    admin_level_code: string;
    admin_level_name?: string | null;
    parent_id: string | null;
    parent_label?: string | null;
    boundary_status?: string | null;
    address_usage?: string | null;
};

export function getAdminAreaOptions(params?: { limit?: number; q?: string }) {
    const search = new URLSearchParams();
    if (params?.limit !== undefined) {
        search.set("limit", String(params.limit));
    }
    if (params?.q?.trim()) {
        search.set("q", params.q.trim());
    }
    const qs = search.toString();
    return apiFetch<AdminAreaOption[]>(`/admin-areas/options${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export function getDashboardStats(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<DashboardStatsResponse>("/dashboard/stats", {
        method: "GET",
        ...fetchInit,
    });
}

export function getImportReviewSummary(params: ImportReviewEnvelopeQuery, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<ImportReviewSummaryResponse>(
        "/api/import-review/summary",
        {
            method: "GET",
            ...fetchInit,
        },
        normalizedImportReviewUrlParams(params as Record<string, QueryValue>)
    );
}

export function getImportReviewBuildingsFilterOptions(
    params: ImportReviewEnvelopeQuery,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewBuildingsFilterOptionsResponse>(
        "/api/import-review/buildings/filter-options",
        { method: "GET", ...fetchInit },
        normalizedImportReviewUrlParams(params as Record<string, QueryValue>)
    );
}

export function getImportReviewBuildings(
    params: ImportReviewBuildingsListParams,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const { include_geometry = false, ...rest } = params;
    return apiFetch<ImportReviewBuildingsListResponse>(
        "/api/import-review/buildings",
        { method: "GET", ...fetchInit },
        normalizedImportReviewUrlParams({ ...rest, include_geometry } as Record<string, QueryValue>)
    );
}

export function patchImportReviewBuildingDecision(
    id: string,
    body: PatchImportReviewBuildingDecisionBody
) {
    return apiFetch<ImportReviewBuildingListItem>(`/api/import-review/buildings/${id}/decision`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(wireImportReviewJsonBody(body as unknown as Record<string, unknown>)),
    });
}

export function patchImportReviewBuildingOverrides(id: string, body: PatchImportReviewBuildingOverridesBody) {
    return apiFetch<ImportReviewBuildingListItem>(`/api/import-review/buildings/${id}/overrides`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(wireImportReviewJsonBody(body as unknown as Record<string, unknown>)),
    });
}

export type ImportReviewReferenceOptionDto = {
    id: string;
    code: string | null;
    name: string | null;
};

export type ImportReviewReferenceOptionsResponse = {
    ref_poi_categories: ImportReviewReferenceOptionDto[];
    ref_road_classes: ImportReviewReferenceOptionDto[];
    ref_building_types: ImportReviewReferenceOptionDto[];
    ref_landuse_classes: ImportReviewReferenceOptionDto[];
    ref_admin_levels: ImportReviewReferenceOptionDto[];
    ref_address_component_types: ImportReviewReferenceOptionDto[];
    ref_source_types: ImportReviewReferenceOptionDto[];
    core_admin_areas: ImportReviewReferenceOptionDto[];
};

export type ImportReviewFormOption = {
    value: string | number;
    label: string;
    code?: string | null;
    name_mm?: string | null;
    name_en?: string | null;
};

export type ImportReviewAdminAreaFormOption = ImportReviewFormOption & {
    id: string;
    canonical_name: string;
    admin_level_id: string;
    parent_id?: string | null;
};

export type ImportReviewFormOptionsResponse = {
    admin_areas: ImportReviewAdminAreaFormOption[];
    admin_levels: ImportReviewFormOption[];
    road_classes: ImportReviewFormOption[];
    poi_categories: ImportReviewFormOption[];
    building_types: ImportReviewFormOption[];
    landuse_classes: ImportReviewFormOption[];
    waterway_classes: ImportReviewFormOption[];
    water_classes: ImportReviewFormOption[];
    barrier_types: ImportReviewFormOption[];
    surface_presets: ImportReviewFormOption[];
};

export function getImportReviewFormOptions(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<ImportReviewFormOptionsResponse>("/api/import-review/options", {
        method: "GET",
        ...fetchInit,
    });
}

export function getImportReviewReferenceOptions(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<ImportReviewReferenceOptionsResponse>("/api/import-review/reference-options", {
        method: "GET",
        ...fetchInit,
    });
}

export function patchImportReviewFamilyOverrides(
    family: string,
    id: string,
    body: PatchImportReviewBuildingOverridesBody
) {
    const familyPath = encodeURIComponent(resolveImportReviewApiFamily(family));
    return apiFetch<ImportReviewBuildingListItem>(`/api/import-review/${familyPath}/${id}/overrides`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(wireImportReviewJsonBody(body as unknown as Record<string, unknown>)),
    });
}

export function postImportReviewBuildingsBulkDecision(body: PostImportReviewBuildingsBulkBody) {
    return apiFetch<ImportReviewBulkDecisionResponse>("/api/import-review/buildings/bulk-decision", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(wireImportReviewJsonBody(body as unknown as Record<string, unknown>)),
    });
}

export function getImportReviewPlaces(
    params: ImportReviewPlacesListParams,
    fetchInit?: Pick<RequestInit, "signal">,
) {
    const { include_geometry = true, ...rest } = params;
    return apiFetch<ImportReviewBuildingsListResponse>(
        "/api/import-review/places",
        { method: "GET", ...fetchInit },
        normalizedImportReviewUrlParams({ ...rest, include_geometry } as Record<string, QueryValue>),
    );
}

export function getImportReviewRoads(
    params: ImportReviewRoadsListParams,
    fetchInit?: Pick<RequestInit, "signal">,
) {
    const { include_geometry = false, ...rest } = params;
    return apiFetch<ImportReviewBuildingsListResponse>(
        "/api/import-review/roads",
        { method: "GET", ...fetchInit },
        normalizedImportReviewUrlParams({ ...rest, include_geometry } as Record<string, QueryValue>),
    );
}

export function patchImportReviewPlaceDecision(id: string, body: PatchImportReviewBuildingDecisionBody) {
    return apiFetch<ImportReviewBuildingListItem>(`/api/import-review/places/${id}/decision`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(wireImportReviewJsonBody(body as unknown as Record<string, unknown>)),
    });
}

export function patchImportReviewRoadDecision(id: string, body: PatchImportReviewBuildingDecisionBody) {
    return apiFetch<ImportReviewBuildingListItem>(`/api/import-review/roads/${id}/decision`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(wireImportReviewJsonBody(body as unknown as Record<string, unknown>)),
    });
}

export type ImportReviewRoadValidationIssue = {
    code: string;
    message: string;
    severity: "error" | "warning" | "info";
};

export type ImportReviewRoadRoutingValidationStats = {
    nearby_core_roads: number;
    nearby_review_roads: number;
    connected_endpoints: number;
    isolated_endpoints: number;
    possible_duplicates: number;
    possible_unsplit_intersections: number;
    length_m: number;
};

export type ImportReviewRoadRoutingValidationResponse = {
    candidate_id: string;
    validation_mode: "existing_region" | "new_region";
    can_save: boolean;
    can_approve: boolean;
    errors: ImportReviewRoadValidationIssue[];
    warnings: ImportReviewRoadValidationIssue[];
    info?: ImportReviewRoadValidationIssue[];
    stats: ImportReviewRoadRoutingValidationStats;
};

export type PostImportReviewRoadValidateRoutingBody = ImportReviewEnvelopeQuery & {
    use_review_overrides?: boolean;
    connectivity_threshold_m?: number;
    duplicate_threshold_m?: number;
    confirm_warnings?: boolean;
};

export function postImportReviewRoadValidateRouting(id: string, body: PostImportReviewRoadValidateRoutingBody) {
    return apiFetch<ImportReviewRoadRoutingValidationResponse>(
        `/api/import-review/roads/${id}/validate-routing`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(wireImportReviewJsonBody(body as unknown as Record<string, unknown>)),
        },
    );
}

export function patchImportReviewRoadOverrides(id: string, body: PatchImportReviewRoadOverridesBody) {
    const ro = { ...(body.review_overrides ?? {}) };
    const rc = ro.road_class_id as unknown;
    if (typeof rc === "bigint") {
        ro.road_class_id = rc.toString();
    }

    const payload: PatchImportReviewRoadOverridesBody = {
        ...body,
        review_overrides: ro,
    };

    return apiFetch<ImportReviewBuildingListItem>(`/api/import-review/roads/${id}/overrides`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(wireImportReviewJsonBody(payload as unknown as Record<string, unknown>)),
    });
}

export function postImportReviewPlacesBulkDecision(body: PostImportReviewBuildingsBulkBody) {
    return apiFetch<ImportReviewBulkDecisionResponse>("/api/import-review/places/bulk-decision", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(wireImportReviewJsonBody(body as unknown as Record<string, unknown>)),
    });
}

export function postImportReviewRoadsBulkDecision(body: PostImportReviewBuildingsBulkBody) {
    return apiFetch<ImportReviewBulkDecisionResponse>("/api/import-review/roads/bulk-decision", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(wireImportReviewJsonBody(body as unknown as Record<string, unknown>)),
    });
}

function importReviewFamilyPath(apiFamily: string): string {
    return `/api/import-review/${encodeURIComponent(resolveImportReviewApiFamily(apiFamily))}`;
}

export function getImportReviewFamilyFilterOptions(
    apiFamily: string,
    params: ImportReviewEnvelopeQuery,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewFamilyFilterOptionsResponse>(
        `${importReviewFamilyPath(apiFamily)}/filter-options`,
        { method: "GET", ...fetchInit },
        normalizedImportReviewUrlParams(params as Record<string, QueryValue>)
    );
}

export function getImportReviewFamilyCandidates(
    apiFamily: string,
    params: ImportReviewFamilyListParams,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const { include_geometry = false, ...rest } = params;
    return apiFetch<ImportReviewBuildingsListResponse>(
        importReviewFamilyPath(apiFamily),
        { method: "GET", ...fetchInit },
        normalizedImportReviewUrlParams({ ...rest, include_geometry } as Record<string, QueryValue>)
    );
}

export function getImportReviewFamilyCandidateById(
    apiFamily: string,
    id: string,
    params: ImportReviewEnvelopeQuery & { include_geometry?: boolean },
    fetchInit?: Pick<RequestInit, "signal">
) {
    const { include_geometry = true, ...scope } = params;
    return apiFetch<ImportReviewBuildingListItem>(
        `${importReviewFamilyPath(apiFamily)}/${encodeURIComponent(id)}`,
        { method: "GET", ...fetchInit },
        normalizedImportReviewUrlParams({ ...scope, include_geometry } as Record<string, QueryValue>)
    );
}

export function patchImportReviewFamilyDecision(
    apiFamily: string,
    id: string,
    body: PatchImportReviewBuildingDecisionBody
) {
    return apiFetch<ImportReviewBuildingListItem>(
        `${importReviewFamilyPath(apiFamily)}/${encodeURIComponent(id)}/decision`,
        {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(wireImportReviewJsonBody(body as unknown as Record<string, unknown>)),
        }
    );
}

export type ImportReviewAddressComponentDto = {
    id: string;
    component_type_code: string;
    component_value: string;
    language_code: string;
    sort_order: number | null;
    confidence_score: number | null;
    match_type: string | null;
    source_tag: string | null;
    is_inferred: boolean;
    is_reviewed: boolean;
    source_admin_area_id: string | null;
    boundary_status: string | null;
    address_usage: string | null;
};

export type ImportReviewAddressMatchOptionStreet = {
    id: string;
    canonical_name: string;
    name_en: string | null;
    name_my: string | null;
    name_und: string | null;
    distance_m: number;
    match_score: number;
    match_method: string;
};

export type ImportReviewAddressSourceContext = {
    source_name: string | null;
    source_name_en: string | null;
    source_name_my: string | null;
    source_type_hint: string | null;
    source_category_hint: string | null;
    phone: string | null;
    email: string | null;
    opening_hours: string | null;
    raw_relevant_tags: Record<string, string>;
};

export type ImportReviewAddressMapPreviewLayers = {
    candidate_point: ImportReviewGeoJson | null;
    entrance_point: ImportReviewGeoJson | null;
    matched_building: ImportReviewGeoJson | null;
    matched_street: ImportReviewGeoJson | null;
    matched_admin_area: ImportReviewGeoJson | null;
};

export type ImportReviewAddressMatchOptionBuilding = {
    id: string;
    label: string;
    building_type: string | null;
    distance_m: number;
    match_score: number;
    match_method: string;
};

export type ImportReviewAddressMatchOptionPlace = {
    id: string;
    display_name: string;
    name_en: string | null;
    name_my: string | null;
    category: string | null;
    distance_m: number;
    match_score: number;
    match_method: string;
};

export type ImportReviewAddressMatchOptionAdminArea = {
    id: string;
    canonical_name: string;
    name_en: string | null;
    name_my: string | null;
    admin_level_code: string;
    boundary_status: string | null;
    address_usage: string | null;
    distance_m: number | null;
    match_score: number;
    match_method: string;
};

export type ImportReviewAddressOptionsResponse = {
    address_candidate_id: string;
    streets: ImportReviewAddressMatchOptionStreet[];
    adminAreas: ImportReviewAddressMatchOptionAdminArea[];
    postcodes: Array<{ value: string; language_code: string | null; source: string }>;
    buildings: ImportReviewAddressMatchOptionBuilding[];
    places: ImportReviewAddressMatchOptionPlace[];
};

export type ImportReviewAddressValidationIssue = {
    code: string;
    message: string;
    severity: "error" | "warning";
    field?: string;
    component_id?: string;
};

export type ImportReviewAddressValidateResultItem = {
    address_candidate_id: string;
    validation_status: "blocked" | "valid_with_warnings" | "valid";
    promotion_blockers: ImportReviewAddressValidationIssue[];
    promotion_warnings: ImportReviewAddressValidationIssue[];
    validated_at: string;
};

export type ImportReviewAddressValidateResponse = {
    review_batch_id: string | null;
    candidate_count: number;
    summary: { blocked: number; valid_with_warnings: number; valid: number };
    results: ImportReviewAddressValidateResultItem[];
};

export type PatchImportReviewAddressComponentsBody = {
    upsert: Array<{
        id?: string;
        component_type_code: string;
        component_value: string;
        language_code: "en" | "my" | "und";
        confidence_score?: number | null;
        match_type?: string | null;
        is_reviewed?: boolean;
    }>;
    delete_ids?: string[];
};

export type PatchImportReviewAddressMatchesBody = {
    matched_street_id?: string | null;
    matched_admin_area_id?: string | null;
    matched_building_id?: string | null;
    matched_place_id?: string | null;
    street_match_confidence?: number;
    replace_reviewed_street_components?: boolean;
};

export function getImportReviewAddressOptions(id: string, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<ImportReviewAddressOptionsResponse>(
        `/api/import-review/addresses/${encodeURIComponent(id)}/options`,
        { method: "GET", ...fetchInit }
    );
}

export function patchImportReviewAddressComponents(
    id: string,
    body: PatchImportReviewAddressComponentsBody
) {
    return apiFetch<ImportReviewBuildingListItem>(
        `/api/import-review/addresses/${encodeURIComponent(id)}/components`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }
    );
}

export function patchImportReviewAddressMatches(id: string, body: PatchImportReviewAddressMatchesBody) {
    return apiFetch<{
        address_candidate_id: string;
        matched_street_id: string | null;
        matched_admin_area_id: string | null;
        matched_building_id: string | null;
        matched_place_id: string | null;
        street_match_type: string | null;
        street_match_confidence: number | null;
        street_components_synced: Array<{ language_code: string; action: string }>;
    }>(`/api/import-review/addresses/${encodeURIComponent(id)}/matches`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export function postImportReviewAddressValidate(body: {
    review_batch_id?: string;
    candidate_ids?: string[];
}) {
    return apiFetch<ImportReviewAddressValidateResponse>(`/api/import-review/addresses/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export type ImportReviewAddressPromotionItem = {
    address_candidate_id: string;
    external_id: string | null;
    outcome:
        | "promoted"
        | "would_promote"
        | "skipped"
        | "duplicate_review_needed"
        | "failed";
    reasons: string[];
    core_address_id: string | null;
    promotion_warnings: ImportReviewAddressValidationIssue[];
    promotion_blockers: ImportReviewAddressValidationIssue[];
};

export type ImportReviewAddressPromotionResponse = {
    dry_run: boolean;
    review_batch_id: string | null;
    candidate_count: number;
    promoted: number;
    skipped: number;
    duplicate_review_needed: number;
    failed: number;
    warnings: string[];
    items: ImportReviewAddressPromotionItem[];
    finished_at: string;
    disabled_because_env_flag_false?: boolean;
    message?: string;
};

export function postImportReviewAddressPromoteDryRun(body: {
    review_batch_id?: string;
    candidate_ids?: string[];
    confirm_warnings?: boolean;
}) {
    return apiFetch<ImportReviewAddressPromotionResponse>(
        `/api/import-review/addresses/promote-dry-run`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }
    );
}

export function postImportReviewAddressPromote(body: {
    review_batch_id?: string;
    candidate_ids?: string[];
    confirm_warnings?: boolean;
}) {
    return apiFetch<ImportReviewAddressPromotionResponse>(`/api/import-review/addresses/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export function getAdminReverseAddressDebug(
    lat: number,
    lng: number,
    lang: "en" | "my" = "en",
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<import("@/src/features/addresses/reverseAddress.types").ReverseAddressDebugResponse>(
        "/admin/addresses/reverse-debug",
        { method: "GET", ...fetchInit },
        { lat, lng, lang }
    );
}

export function postImportReviewFamilyBulkDecision(apiFamily: string, body: PostImportReviewBuildingsBulkBody) {
    return apiFetch<ImportReviewBulkDecisionResponse>(
        `${importReviewFamilyPath(apiFamily)}/bulk-decision`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(wireImportReviewJsonBody(body as unknown as Record<string, unknown>)),
        }
    );
}

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

export type ImportReviewPublishBatchItemCounts = {
    pending: number;
    success: number;
    failed: number;
    skipped: number;
    rolled_back: number;
    total: number;
};

export type ImportReviewPublishBatchEntityItemCounts = {
    pending: number;
    success: number;
    failed: number;
    skipped: number;
    total: number;
};

export type ImportReviewPublishBatchDetail = ImportReviewPublishBatchSummary & {
    item_counts: ImportReviewPublishBatchItemCounts;
    building_item_counts: ImportReviewPublishBatchItemCounts;
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
    stages: Array<{
        stage_key: string;
        stage_label: string;
        message: string;
        counts: Record<string, number>;
    }>;
    message: string;
};

export type ImportReviewCreatePublishBatchResult = {
    message: string;
    batch: ImportReviewPublishBatchDetail;
    items_added: number;
    candidates_marked_batched: number;
    by_family: ImportReviewPromotionCreateBatchFamilyResult[];
    building_candidates_marked_batched: number;
};

export type ImportReviewPromotionScopeParams = ImportReviewEnvelopeQuery & {
    include_merged?: boolean;
};

export type ImportReviewPromotionBatchEligibilityParams = ImportReviewPromotionScopeParams & {
    entity_families?: string[];
    include_warnings?: boolean;
    mode?: "approved_only";
};

export type ImportReviewPromotionBatchesListParams = ImportReviewPromotionScopeParams & {
    limit?: number;
    offset?: number;
};

export type PostImportReviewPromotionBatchBody = ImportReviewEnvelopeQuery & {
    batch_name?: string;
    note?: string;
    entity_families?: string[];
    mode?: "approved_only";
    include_warnings?: boolean;
    warning_confirmation_note?: string;
    dry_run?: boolean;
    allow_high_risk_families?: boolean;
    include_merged?: boolean;
};

export type ImportReviewPromotionBatchesListResponse = {
    items: ImportReviewPublishBatchSummary[];
    total: number;
    limit: number;
    offset: number;
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
    building_type_code?: string | null;
    building_type_name?: string | null;
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

export type ImportReviewPromotionReadyCandidatesCounts = {
    ready: number;
    already_batched: number;
    promoted: number;
    blocked_active_batch: number;
};

export type ImportReviewPromotionReadyCandidatesResponse = {
    items: ImportReviewPromotionReadyCandidateItem[];
    total: number;
    limit: number;
    offset: number;
    counts: ImportReviewPromotionReadyCandidatesCounts;
};

export type ImportReviewPromotionReadyCandidatesParams = ImportReviewPromotionScopeParams & {
    limit?: number;
    offset?: number;
    sort?: "updated_at_desc" | "updated_at_asc" | "confidence_score_desc" | "name_asc";
    include_geometry?: boolean;
};

function importReviewPromotionQueryParams(
    params: ImportReviewPromotionScopeParams
): Record<string, QueryValue> {
    const base = normalizedImportReviewUrlParams(params as Record<string, QueryValue>) ?? {};
    if (params.include_merged) {
        base.include_merged = "true";
    }
    return base;
}

export function getImportReviewPromotionReady(
    params: ImportReviewPromotionScopeParams,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewPromotionReadyCounts>(
        "/api/import-review/promotion/ready",
        { method: "GET", ...fetchInit },
        importReviewPromotionQueryParams(params)
    );
}

export function getImportReviewPromotionReadyCandidates(
    params: ImportReviewPromotionReadyCandidatesParams,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const { limit, offset, sort, include_geometry, ...scope } = params;
    const q: Record<string, QueryValue> = {
        ...importReviewPromotionQueryParams(scope),
        entity_family: "buildings",
    };
    if (limit !== undefined) {
        q.limit = limit;
    }
    if (offset !== undefined) {
        q.offset = offset;
    }
    if (sort) {
        q.sort = sort;
    }
    if (include_geometry) {
        q.include_geometry = "true";
    }
    return apiFetch<ImportReviewPromotionReadyCandidatesResponse>(
        "/api/import-review/promotion/ready-candidates",
        { method: "GET", ...fetchInit },
        q
    );
}

export function getImportReviewPromotionBatches(
    params: ImportReviewPromotionBatchesListParams,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const { limit, offset, ...scope } = params;
    const q: Record<string, QueryValue> = {
        ...importReviewPromotionQueryParams(scope),
    };
    if (limit !== undefined) {
        q.limit = limit;
    }
    if (offset !== undefined) {
        q.offset = offset;
    }
    return apiFetch<ImportReviewPromotionBatchesListResponse>(
        "/api/import-review/promotion/batches",
        { method: "GET", ...fetchInit },
        q
    );
}

export function getImportReviewPromotionBatchEligibility(
    params: ImportReviewPromotionBatchEligibilityParams,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const { entity_families, include_warnings, mode, ...scope } = params;
    const url = new URL("/api/import-review/promotion/batch-eligibility", `${getApiBaseUrl()}/`);
    const base = importReviewPromotionQueryParams(scope);
    for (const [key, value] of Object.entries(base)) {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    }
    if (include_warnings) {
        url.searchParams.set("include_warnings", "true");
    }
    if (mode) {
        url.searchParams.set("mode", mode);
    }
    for (const family of entity_families ?? []) {
        url.searchParams.append("entity_families", family);
    }
    return apiFetch<ImportReviewPromotionBatchEligibilityResponse>(url.pathname + url.search, {
        method: "GET",
        ...fetchInit,
    });
}

export function getImportReviewPromotionBatchById(
    id: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewPublishBatchDetail>(`/api/import-review/promotion/batches/${id}`, {
        method: "GET",
        ...fetchInit,
    });
}

export function postImportReviewPromotionBatch(body: PostImportReviewPromotionBatchBody) {
    return apiFetch<ImportReviewCreatePublishBatchResult | ImportReviewCreatePublishBatchDryRunResult>(
        "/api/import-review/promotion/batches",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(wireImportReviewJsonBody(body as unknown as Record<string, unknown>)),
        }
    );
}

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
    entity_family?: { buildings: number };
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
    total_item_count: number;
    item_processed_count: number;
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

export type PostImportReviewPromotionBatchPromoteBody = {
    confirmation_text: "PROMOTE";
    chunk_size?: number;
    confirm_warnings?: boolean;
    warning_confirmation_note?: string;
};

export type ImportReviewStartPublishBatchPromotionResponse = {
    batch_id: string;
    status: string;
    message: string;
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

const VALIDATABLE_BATCH_STATUSES = new Set(["draft", "blocked", "failed", "ready"]);

export function canValidateImportReviewPublishBatch(status: string): boolean {
    return VALIDATABLE_BATCH_STATUSES.has(status);
}

export function postImportReviewPromotionBatchValidate(
    id: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewStartPublishBatchValidationResponse>(
        `/api/import-review/promotion/batches/${id}/validate`,
        { method: "POST", ...fetchInit }
    );
}

export function getImportReviewPromotionBatchProgress(
    id: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewPublishBatchProgressResponse>(
        `/api/import-review/promotion/batches/${id}/progress`,
        { method: "GET", ...fetchInit }
    );
}

export function getImportReviewPromotionBatchLogs(
    id: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewPublishBatchLogsResponse>(
        `/api/import-review/promotion/batches/${id}/logs`,
        { method: "GET", ...fetchInit }
    );
}

export function postImportReviewPromotionBatchPromote(
    id: string,
    body: PostImportReviewPromotionBatchPromoteBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewStartPublishBatchPromotionResponse>(
        `/api/import-review/promotion/batches/${id}/promote`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function getImportReviewPromotionBatchVerify(
    id: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewPublishBatchVerifyResponse>(
        `/api/import-review/promotion/batches/${id}/verify`,
        { method: "GET", ...fetchInit }
    );
}

export type RoadDryRunItemStatus = "blocked" | "warning" | "eligible" | "eligible_if_confirmed";

export type RoadDryRunGeometrySummary = {
    srid: number | null;
    geom_type: string | null;
    length_m: number | null;
    is_valid: boolean | null;
};

export type RoadDryRunRoutingValidationSummary = {
    validation_mode: string;
    can_approve: boolean;
    stats: {
        nearby_core_roads: number;
        nearby_review_roads: number;
        connected_endpoints: number;
        isolated_endpoints: number;
        possible_duplicates: number;
        possible_unsplit_intersections: number;
        length_m: number;
    };
    error_count: number;
    warning_count: number;
};

export type RoadDryRunItemResult = {
    publish_item_id: string;
    review_candidate_id: string;
    external_id: string | null;
    publish_action: string;
    dry_run_status: RoadDryRunItemStatus;
    blocking_reasons: string[];
    warning_codes: string[];
    matched_core_id: string | null;
    routing_validation_summary: RoadDryRunRoutingValidationSummary | null;
    geometry_summary: RoadDryRunGeometrySummary | null;
};

export type ImportReviewPromotionRoadDryRunResult = {
    batch_id: string;
    review_batch_id: string | null;
    would_insert_count: number;
    would_update_count: number;
    blocked_count: number;
    warning_count: number;
    duplicate_risk_count: number;
    routing_warning_count: number;
    serious_warning_count: number;
    eligible_if_confirmed_count: number;
    disabled_because_env_flag_false: boolean;
    items: RoadDryRunItemResult[];
    finished_at: string;
    message: string;
};

export type PostImportReviewPromotionRoadDryRunBody = {
    confirm_routing_warnings?: boolean;
    use_review_overrides?: boolean;
    connectivity_threshold_m?: number;
    duplicate_threshold_m?: number;
};

export function postImportReviewPromotionBatchRoadDryRun(
    id: string,
    body: PostImportReviewPromotionRoadDryRunBody = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewPromotionRoadDryRunResult>(
        `/api/import-review/promotion/batches/${id}/road-dry-run`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function getImportReviewPromotionBatchRoadDryRun(
    id: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewPromotionRoadDryRunResult>(
        `/api/import-review/promotion/batches/${id}/road-dry-run`,
        { method: "GET", ...fetchInit }
    );
}

export type PostImportReviewCleanupPromotedBody = {
    review_batch_id: string;
    entity_families?: string[];
    publish_batch_id?: string;
    older_than_days?: number;
};

export type ImportReviewCleanupPromotedExampleRow = {
    candidate_id: string;
    entity_family: string;
    promoted_core_id: string | null;
    promoted_at: string | null;
    publish_batch_id: string | null;
};

export type ImportReviewCleanupPromotedBlockedExampleRow = ImportReviewCleanupPromotedExampleRow & {
    reason: string;
};

export type ImportReviewCleanupPromotedDryRunResult = {
    review_batch_id: string;
    publish_batch_id: string | null;
    selected_entity_families: string[];
    eligible_counts_by_entity: Record<string, number>;
    not_eligible_counts_by_reason: Record<string, number>;
    estimated_rows_to_delete: number;
    estimated_geometry_rows_to_delete: number;
    example_eligible_rows: ImportReviewCleanupPromotedExampleRow[];
    example_blocked_rows: ImportReviewCleanupPromotedBlockedExampleRow[];
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

export type PostImportReviewCleanupPromotedExecuteBody = PostImportReviewCleanupPromotedBody & {
    confirmation_text: "DELETE PROMOTED REVIEW DATA";
};

export function postImportReviewCleanupPromotedDryRun(body: PostImportReviewCleanupPromotedBody) {
    return apiFetch<ImportReviewCleanupPromotedDryRunResult>(
        "/api/import-review/cleanup/promoted/dry-run",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }
    );
}

export function postImportReviewCleanupPromotedExecute(body: PostImportReviewCleanupPromotedExecuteBody) {
    return apiFetch<ImportReviewCleanupPromotedExecuteResult>(
        "/api/import-review/cleanup/promoted/execute",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }
    );
}

export function getRoadClasses(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RoadClassOption[]>("/road-classes", { method: "GET", ...fetchInit });
}

export function getStreets(params?: StreetsParams, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<Street[]>("/streets", { method: "GET", ...fetchInit }, params);
}

export function getStreet(id: string, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<StreetDetail>(`/streets/${id}`, { method: "GET", ...fetchInit });
}

export function getNearestStreetPoint(
    params: {
        lat: number;
        lng: number;
        radiusMeters: number;
        excludePublicId?: string;
    },
    fetchInit?: Pick<RequestInit, "signal">,
) {
    return apiFetch<NearestStreetPointHit | null>(
        "/streets/nearest-point",
        { method: "GET", ...fetchInit },
        {
            lat: params.lat,
            lng: params.lng,
            radiusMeters: params.radiusMeters,
            ...(params.excludePublicId ? { excludePublicId: params.excludePublicId } : {}),
        },
    );
}

export function validateStreetGeometry(payload: {
    geometry: StreetLineStringGeoJson;
    /** `public_id` (UUID) or core `id` (digits / number). */
    streetId?: string | number;
    /** @deprecated Use `streetId`. */
    street_id?: string;
    toleranceMeters?: number;
}) {
    return apiFetch<ValidateStreetGeometryResponse>("/streets/validate-geometry", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function createStreet(payload: CreateStreetPayload) {
    return apiFetch<StreetDetail>("/streets", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function updateStreet(id: string, payload: UpdateStreetPayload) {
    return apiFetch<StreetDetail>(`/streets/${id}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function deleteStreet(id: string, payload?: DeleteStreetPayload) {
    return apiFetch<StreetDetail>(`/streets/${id}`, {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload ?? {}),
    });
}

export type SplitStreetPayload = {
    point: { lat: number; lng: number };
    editReason?: string;
};

export type SplitStreetResponse = {
    originalStreetId: string;
    newStreets: StreetDetail[];
    /** @deprecated Same as newStreets; kept for backward compatibility. */
    streets?: StreetDetail[];
};

export function splitStreet(id: string, payload: SplitStreetPayload) {
    return apiFetch<SplitStreetResponse>(`/streets/${id}/split`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function getBuildings(params?: BuildingsParams, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<Building[]>("/buildings", { method: "GET", ...fetchInit }, params);
}

export function getBuildingTypes(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RefBuildingType[]>("/building-types", { method: "GET", ...fetchInit });
}

export function getRefLanduseClasses(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RefLanduseClass[]>("/admin/ref/landuse-classes", { method: "GET", ...fetchInit });
}

export function getRefBoundaryStatuses(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RefBoundaryStatus[]>("/admin/ref/boundary-statuses", { method: "GET", ...fetchInit });
}

export function getRefAddressUsageTypes(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RefAddressUsageType[]>("/admin/ref/address-usage-types", { method: "GET", ...fetchInit });
}

export function getBuilding(id: string, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<Building>(`/buildings/${id}`, { method: "GET", ...fetchInit });
}

export function createBuilding(payload: CreateBuildingPayload) {
    return apiFetch<Building>("/buildings", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function updateBuilding(id: string, payload: UpdateBuildingPayload) {
    return apiFetch<Building>(`/buildings/${id}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function deleteBuilding(id: string) {
    return apiFetch<DeleteBuildingResponse>(`/buildings/${id}`, {
        method: "DELETE",
    });
}

export function getLinkedBuildingsForPlace(placePublicId: string) {
    return apiFetch<LinkedPlaceBuildingListResponse>(`/places/${placePublicId}/buildings`, {
        method: "GET",
    });
}

export function linkBuildingToPlace(placePublicId: string, payload: LinkPlaceBuildingPayload) {
    return apiFetch<LinkPlaceBuildingResponse>(`/places/${placePublicId}/buildings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            building_id: payload.building_id,
            relation_type: payload.relation_type ?? "inside",
            is_primary: payload.is_primary ?? false,
        }),
    });
}

export function unlinkBuildingFromPlace(placePublicId: string, buildingPublicId: string) {
    return apiFetch<{ ok: boolean; place_id: string; building_id: string }>(
        `/places/${placePublicId}/buildings/${buildingPublicId}`,
        { method: "DELETE" }
    );
}

// --- Import review history (read-only) ---

export type ImportReviewHistoryReviewBatchCounts = {
    batch_total_candidates: number;
    active_candidates: number;
    pending_review_candidates: number;
    approved_candidates: number;
    rejected_candidates: number;
    promoted_candidates: number;
    promotion_failed_candidates: number;
};

export type ImportReviewHistoryPublishAttemptSummary = {
    id: string;
    batch_name: string;
    stored_status: string;
    derived_status: string;
    created_at: string;
    promoted_at: string | null;
    total_item_count: number;
    success_count: number;
    failed_count: number;
    core_verified_count: number;
    import_review_marked_promoted_count: number;
};

export type ImportReviewHistoryReviewBatchListItem = {
    id: string;
    public_id: string;
    batch_name: string;
    source_snapshot_version: string;
    source_snapshot_id_local: string | null;
    status: string;
    derived_status: string;
    derived_status_reason: string | null;
    stored_status_recommendation: string | null;
    status_note: string | null;
    created_at: string;
    uploaded_at: string;
    validated_at: string | null;
    promoted_at: string | null;
    total_candidate_count: number;
    entity_families: string[];
    counts: ImportReviewHistoryReviewBatchCounts;
    counts_by_entity_family: ImportReviewFamilySummaryMetrics[];
    publish_batches: {
        publish_batch_count: number;
        validated_at: string | null;
        promoted_at: string | null;
        validation_success_count: number;
        validation_fail_count: number;
        promotion_success_count: number;
        promotion_fail_count: number;
    };
    latest_publish_batch: ImportReviewHistoryPublishAttemptSummary | null;
};

export type ImportReviewHistoryReviewBatchDetail = ImportReviewHistoryReviewBatchListItem & {
    region_code: string | null;
    upload_mode: string;
    uploaded_candidate_count: number;
    preserved_reviewed_count: number;
    skipped_count: number;
    summary: unknown;
    publish_batch_summaries: ImportReviewHistoryPublishBatchListItem[];
    publish_batch_attempts: ImportReviewHistoryPublishAttemptSummary[];
};

export type ImportReviewHistoryPublishBatchListItem = {
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

export type ImportReviewHistoryListResponse<T> = {
    items: T[];
    total: number;
    limit: number;
    offset: number;
};

export type ImportReviewHistoryReviewBatchesListParams = {
    status?: string;
    source_snapshot_version?: string;
    entity_family?: string;
    uploaded_after?: string;
    uploaded_before?: string;
    limit?: number;
    offset?: number;
};

export type ImportReviewHistoryPublishBatchesListParams = {
    status?: string;
    source_review_batch_id?: string;
    source_snapshot_version?: string;
    entity_family?: string;
    created_after?: string;
    created_before?: string;
    limit?: number;
    offset?: number;
};

export type ImportReviewHistoryPublishBatchItemsParams = {
    publish_status?: string;
    entity_family?: string;
    limit?: number;
    offset?: number;
};

export function getImportReviewHistoryReviewBatches(
    params: ImportReviewHistoryReviewBatchesListParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const q: Record<string, QueryValue> = {};
    for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== "") {
            q[key] = val;
        }
    }
    return apiFetch<ImportReviewHistoryListResponse<ImportReviewHistoryReviewBatchListItem>>(
        "/api/import-review/history/review-batches",
        { method: "GET", ...fetchInit },
        q
    );
}

export function getImportReviewHistoryReviewBatchById(
    id: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewHistoryReviewBatchDetail>(
        `/api/import-review/history/review-batches/${id}`,
        { method: "GET", ...fetchInit }
    );
}

export function getImportReviewHistoryPublishBatches(
    params: ImportReviewHistoryPublishBatchesListParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const q: Record<string, QueryValue> = {};
    for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== "") {
            q[key] = val;
        }
    }
    return apiFetch<ImportReviewHistoryListResponse<ImportReviewHistoryPublishBatchListItem>>(
        "/api/import-review/history/publish-batches",
        { method: "GET", ...fetchInit },
        q
    );
}

export function getImportReviewHistoryPublishBatchById(
    id: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<ImportReviewHistoryPublishBatchDetail>(
        `/api/import-review/history/publish-batches/${id}`,
        { method: "GET", ...fetchInit }
    );
}

export function getImportReviewHistoryPublishBatchItems(
    id: string,
    params: ImportReviewHistoryPublishBatchItemsParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const q: Record<string, QueryValue> = {};
    for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== "") {
            q[key] = val;
        }
    }
    return apiFetch<ImportReviewHistoryListResponse<ImportReviewHistoryPublishBatchItem>>(
        `/api/import-review/history/publish-batches/${id}/items`,
        { method: "GET", ...fetchInit },
        q
    );
}

export function getImportReviewHistoryPublishBatchLogs(
    id: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<{
        batch_id: string;
        process_state_logs: ImportReviewPublishStageLogItem[];
        validation_logs_summary: string | null;
        promotion_logs_summary: string | null;
    }>(`/api/import-review/history/publish-batches/${id}/logs`, { method: "GET", ...fetchInit });
}

export function getLinkedPlacesForBuilding(buildingPublicId: string) {
    return apiFetch<LinkedPlacesForBuildingResponse>(`/buildings/${buildingPublicId}/places`, {
        method: "GET",
    });
}

export function patchPlaceBuildingLink(
    placePublicId: string,
    buildingPublicId: string,
    payload: PatchPlaceBuildingPayload
) {
    return apiFetch<PatchPlaceBuildingResponse>(
        `/places/${placePublicId}/buildings/${buildingPublicId}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }
    );
}

// --- Core review (paginated list + detail; camelCase DTOs) ---

export type CoreReviewEntitySlug =
    | "buildings"
    | "places"
    | "streets"
    | "bus-stops"
    | "bus-routes"
    | "bus-route-variants"
    | "landuse"
    | "water-lines"
    | "water-polygons"
    | "addresses"
    | "admin-areas";

export type CoreReviewPagination = {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
};

export type CoreReviewListResponse<T> = {
    data: T[];
    pagination: CoreReviewPagination;
    filters?: Record<string, unknown>;
    meta?: Record<string, unknown>;
};

export type CoreReviewDetailResponse<T> = {
    data: T;
};

export type CoreReviewListStatus = "active" | "deleted" | "all";

/** Query params for GET /core-review/:entity (camelCase; matches API Zod schema). */
export type CoreReviewListParams = {
    page?: number;
    pageSize?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    isVerified?: boolean;
    adminAreaId?: string;
    categoryId?: string;
    buildingTypeId?: string;
    roadClassId?: string;
    isPublic?: boolean;
    /** @deprecated Prefer `status`. When true, maps to `status=all` in list state. */
    includeDeleted?: boolean;
    status?: CoreReviewListStatus;
    routeId?: string;
    landuseClassId?: string;
    detailLevel?: "zone" | "parcel";
    cropCode?: string;
    boundaryStatus?: string;
    addressUsage?: string;
    isOfficialBoundary?: boolean;
};

export function getCoreReviewList<T = Record<string, unknown>>(
    entity: CoreReviewEntitySlug,
    params?: CoreReviewListParams,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<CoreReviewListResponse<T>>(
        `/core-review/${entity}`,
        { method: "GET", ...fetchInit },
        params as Record<string, QueryValue> | undefined
    );
}

export function getCoreReviewDetail<T = Record<string, unknown>>(
    entity: CoreReviewEntitySlug,
    id: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<CoreReviewDetailResponse<T>>(
        `/core-review/${entity}/${encodeURIComponent(id)}`,
        { method: "GET", ...fetchInit }
    );
}

/** Alias for {@link getCoreReviewList}. */
export const getCoreReviewEntities = getCoreReviewList;

/** Alias for {@link getCoreReviewDetail}. */
export const getCoreReviewEntityById = getCoreReviewDetail;

export function createCoreReviewEntity<T = Record<string, unknown>>(
    entity: CoreReviewEntitySlug,
    body: unknown,
) {
    return apiFetch<CoreReviewDetailResponse<T>>(`/core-review/${entity}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }).then((response) => response.data);
}

export function updateCoreReviewEntity<T = Record<string, unknown>>(
    entity: CoreReviewEntitySlug,
    id: string,
    body: unknown,
) {
    return apiFetch<CoreReviewDetailResponse<T>>(
        `/core-review/${entity}/${encodeURIComponent(id)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        },
    ).then((response) => response.data);
}

export function softDeleteCoreReviewEntity<T = Record<string, unknown>>(
    entity: CoreReviewEntitySlug,
    id: string,
) {
    return apiFetch<CoreReviewDetailResponse<T>>(
        `/core-review/${entity}/${encodeURIComponent(id)}/soft-delete`,
        { method: "PATCH" },
    ).then((response) => response.data);
}

export function restoreCoreReviewEntity<T = Record<string, unknown>>(
    entity: CoreReviewEntitySlug,
    id: string,
) {
    return apiFetch<CoreReviewDetailResponse<T>>(
        `/core-review/${entity}/${encodeURIComponent(id)}/restore`,
        { method: "PATCH" },
    ).then((response) => response.data);
}
