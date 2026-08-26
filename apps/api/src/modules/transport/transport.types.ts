/** Generic paginated envelope used by all transport list endpoints. */
export type TransportPaginated<T> = {
    items: T[];
    total: number;
    limit: number;
    offset: number;
    page?: number;
    hasNextPage?: boolean;
};

/** Grouping key (mode / review_status) -> count. Only keys present in data appear. */
export type TransportCountsByKey = Record<string, number>;

export type TransportRouteListItem = {
    public_id: string;
    route_code: string;
    public_name: string;
    name_mm: string | null;
    name_en: string | null;
    display_name: string;
    mode: string;
    route_kind: string;
    origin_name: string | null;
    destination_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    variant_count: number;
    stop_count: number;
    path_count: number;
    has_source_link: boolean;
    geometry_status: "no_path" | "estimate" | "manual" | "verified";
    public_visibility: "hidden" | "visible";
    issue_count: number;
    updated_at: string;
};

export type TransportStopListItem = {
    public_id: string;
    stop_code: string | null;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    display_name: string;
    mode: string;
    stop_type: string;
    route_count: number;
    has_terminal: boolean;
    terminal_role: string | null;
    terminal_code: string | null;
    admin_area_id: number | null;
    admin_area_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    has_source_link: boolean;
    geometry_status: "missing" | "estimate" | "manual" | "verified";
    duplicate_status: "none" | "nearby" | "duplicate_name";
    updated_at: string;
};

/** real = human name, generated = synthetic OSM name, missing = empty/whitespace. */
export type TransportRawNameStatus = "real" | "generated" | "missing";

/**
 * Lightweight stop search hit for the route-insertion picker. Intentionally omits
 * heavy/raw fields (source_refs, normalized_data) and the full list of routes that
 * use the stop. `distance_m` is present only when a near point was supplied.
 */
export type TransportStopSearchItem = {
    public_id: string;
    display_name: string;
    name_mm: string | null;
    name_en: string | null;
    mode: string;
    stop_type: string;
    review_status: string;
    confidence_score: number | null;
    lon: number | null;
    lat: number | null;
    distance_m: number | null;
    route_count: number;
};

/** Response envelope for GET /transport/stops/search (hard-limited, no offset). */
export type TransportStopSearchResponse = {
    items: TransportStopSearchItem[];
    limit: number;
};

/** Nearby transport stop candidate for Review Map reuse. */
export type TransportNearbyStopCandidate = {
    id: string;
    publicId: string;
    name: string;
    nameMy: string | null;
    nameEn: string | null;
    mode: string;
    stopType: string;
    reviewStatus: string;
    confidenceScore: number | null;
    lat: number;
    lng: number;
    distanceMeters: number;
};

export type TransportNearbyStopCandidatesResponse = {
    items: TransportNearbyStopCandidate[];
    radiusMeters: number;
    limit: number;
};

/** Compact nearby-stop hit for location-edit duplicate checks (within a radius). */
export type TransportNearbyStop = {
    stop_public_id: string;
    name: string;
    distance_m: number;
    mode: string;
    stop_type: string;
};

/**
 * Result of a stop location edit: the refreshed stop detail plus the stops within
 * the duplicate-check radius of the SAVED location (self excluded).
 */
export type TransportStopLocationUpdateResult = {
    stop: TransportStopDetail;
    nearby_stops: TransportNearbyStop[];
};

export type TransportTerminalListItem = {
    public_id: string;
    terminal_code: string | null;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    raw_name_status: TransportRawNameStatus;
    mode: string;
    terminal_role: string;
    linked_stop: { public_id: string; name: string } | null;
    admin_area_id: number | null;
    admin_area_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    updated_at: string;
};

/** GeoJSON geometry object (Point / LineString / etc.). */
export type GeoJsonGeometry = {
    type: string;
    coordinates: unknown;
};

/** Full stop detail for the dashboard detail/edit page (includes geometry + debug). */
export type TransportStopDetail = {
    public_id: string;
    stop_code: string | null;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    display_name: string;
    mode: string;
    stop_type: string;
    admin_area_id: number | null;
    admin_area_name: string | null;
    parent_stop_id: number | null;
    parent_stop: { public_id: string; name: string } | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    longitude: number | null;
    latitude: number | null;
    geometry: GeoJsonGeometry | null;
    route_count: number;
    /**
     * Summary of the terminal linked to this stop (1:1 via terminals.linked_stop_id),
     * or null when no terminal references it. Terminal-specific metadata is edited
     * via the terminals PATCH; the stop remains the source of truth for name/location.
     */
    linked_terminal: TransportStopLinkedTerminal | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    sources: TransportSourceSummary[];
    /** Raw importer/debug blobs (admin-only). */
    source_refs: unknown;
    normalized_data: unknown;
};

/**
 * Result of archiving (soft-deleting) a stop. The stop and any linked terminals
 * have `deleted_at` set and `is_active = false`; no rows are hard-deleted and no
 * route_stops memberships are touched (a stop in use cannot be archived).
 */
export type TransportStopArchiveResult = {
    archived: boolean;
    public_id: string;
    /** Distinct routes (via non-deleted variants) that referenced the stop (always 0 on success). */
    route_count: number;
    /** Public ids of linked terminals archived in the same transaction. */
    archived_terminals: string[];
};

export type TransportStopDeleteReferenceCounts = {
    route_stops: number;
    variant_endpoints: number;
    child_stops: number;
    linked_terminals: number;
    fares: number;
};

/** Read-only eligibility for permanent stop deletion. */
export type TransportStopDeleteEligibility = {
    can_delete: boolean;
    message: string;
    has_route_usage: boolean;
    route_count: number;
    review_status: string;
    references: TransportStopDeleteReferenceCounts;
    blockers: string[];
};

/** Result of permanently deleting a stop (hard delete). */
export type TransportStopPermanentDeleteResult = {
    deleted: boolean;
    public_id: string;
};

/** Terminal metadata surfaced inside the linked stop's detail (no name/geometry). */
export type TransportStopLinkedTerminal = {
    public_id: string;
    terminal_code: string | null;
    terminal_role: string;
    operator_id: number | null;
    operator: { id: number; name: string } | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
};

/** One import batch row for the read-only Imports page. */
export type TransportImportBatchListItem = {
    id: number;
    public_id: string;
    source_name: string;
    source_kind: string;
    import_scope: string;
    import_mode: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    inserted_count: number;
    updated_count: number;
    skipped_count: number;
    error_count: number;
    notes: string | null;
    created_at: string;
    updated_at: string;
};

/** One import error row for the read-only Imports page (no raw payload). */
export type TransportImportErrorListItem = {
    id: number;
    import_batch_id: number | null;
    entity_type: string;
    external_id: string | null;
    error_code: string;
    error_message: string;
    created_at: string;
};

/** One source-link (provenance) row for the read-only Imports page (no payload). */
export type TransportSourceLinkListItem = {
    id: number;
    entity_type: string;
    entity_id: number;
    source_name: string;
    source_kind: string;
    external_id: string | null;
    source_url: string | null;
    import_batch_id: number | null;
    confidence_score: number | null;
    is_primary: boolean;
    created_at: string;
};

/** Data-quality review queue counts for the dashboard (aggregate-only). */
export type TransportDataQualityQueues = {
    generatedNameStops: number;
    generatedNameTerminals: number;
    missingNameStops: number;
    missingNameTerminals: number;
    routesWithoutPath: number;
    routesWithStopsButNoPath: number;
    routesWithPathButNoStops: number;
    ferryLandingCandidates: number;
    lowConfidenceStops: number;
    lowConfidenceTerminals: number;
    lowConfidenceRoutes: number;
    importErrors: number;
    /** "Low confidence" means confidence_score < this value (0–100 scale). */
    lowConfidenceThreshold: number;
    schemaAvailable: boolean;
};

/** One mode's row in the transport quality summary (read-only counts). */
export type TransportQualitySummaryRow = {
    mode: string;
    routes: number;
    variants: number;
    variants_without_stops: number;
    variants_without_path: number;
    variants_unknown_direction: number;
    routes_without_variants: number;
};

/**
 * Read-only quality summary: per-mode counts that help admins triage what to
 * fix first (variants missing stops/path/direction, routes missing variants).
 * No issue management or auto-fix — purely aggregate counts.
 */
export type TransportQualitySummary = {
    items: TransportQualitySummaryRow[];
    schemaAvailable: boolean;
};

/** One infrastructure line for the dashboard list (no geometry). */
export type TransportInfrastructureLineListItem = {
    public_id: string;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    raw_name_status: TransportRawNameStatus;
    mode: string;
    line_type: string;
    admin_area_id: number | null;
    admin_area_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    updated_at: string;
};

/** Full infrastructure-line detail for the dashboard detail/edit page (includes geometry + debug). */
export type TransportInfrastructureLineDetail = {
    public_id: string;
    name: string | null;
    name_mm: string | null;
    name_en: string | null;
    raw_name_status: TransportRawNameStatus;
    mode: string;
    line_type: string;
    admin_area_id: number | null;
    admin_area_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    geometry: GeoJsonGeometry | null;
    /** Approximate length in metres (geodesic), for display only. */
    length_m: number | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    sources: TransportSourceSummary[];
    source_refs: unknown;
    normalized_data: unknown;
};

/** Full terminal detail for the dashboard detail/edit page (includes geometry + debug). */
export type TransportTerminalDetail = {
    public_id: string;
    terminal_code: string | null;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    raw_name_status: TransportRawNameStatus;
    mode: string;
    terminal_role: string;
    linked_stop_id: number | null;
    linked_stop: { public_id: string; name: string; mode: string; stop_type: string } | null;
    operator_id: number | null;
    operator: { id: number; name: string } | null;
    admin_area_id: number | null;
    admin_area_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    longitude: number | null;
    latitude: number | null;
    geometry: GeoJsonGeometry | null;
    /** Derived ferry attribute: "unknown" unless explicit data exists in normalized_data. */
    vehicle_access: string;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    sources: TransportSourceSummary[];
    source_refs: unknown;
    normalized_data: unknown;
};

/** One route variant that includes this stop (summary only — no full route detail). */
export type TransportStopRouteUsage = {
    route_stop_id: string;
    route_public_id: string;
    route_code: string;
    route_name: string;
    mode: string;
    variant_public_id: string;
    variant_code: string;
    direction_name: string | null;
    headsign: string | null;
    stop_sequence: number;
};

/** One active route membership for a stop (Review Map usage detail). */
export type TransportStopRouteUsageDetailItem = {
    routeStopId: string;
    routeId: string;
    routeCode: string;
    routeName: string;
    variantId: string;
    variantCode: string;
    directionName: string | null;
    directionId: number | null;
    stopSequence: number;
};

export type TransportStopRouteUsageSummary = {
    totalRoutes: number;
    totalVariants: number;
    routeStopMemberships: number;
    inboundCount: number;
    outboundCount: number;
    clockwiseCount: number;
    anticlockwiseCount: number;
};

export type TransportStopRouteUsageDirectionUsage = {
    inbound: number;
    outbound: number;
    clockwise: number;
    anticlockwise: number;
};

export type TransportStopRouteUsageDetailResponse = {
    stopPublicId: string;
    /** Same UUID as stopPublicId — canonical id for clients. */
    stopId: string;
    items: TransportStopRouteUsageDetailItem[];
    /** Alias of items — canonical route membership list. */
    routes: TransportStopRouteUsageDetailItem[];
    summary: TransportStopRouteUsageSummary;
    totalRoutes: number;
    totalVariants: number;
    directionUsage: TransportStopRouteUsageDirectionUsage;
};

export type TransportStopMergePreviewStop = {
    publicId: string;
    name: string;
    nameMy: string | null;
    nameEn: string | null;
    mode: string;
    stopType: string;
    adminAreaId: number | null;
    adminAreaName: string | null;
    reviewStatus: string;
    confidenceScore: number | null;
    isActive: boolean;
    lat: number | null;
    lng: number | null;
    updatedAt?: string | null;
};

export type TransportStopMergeReferenceCounts = {
    routeStops: number;
    variantOrigins: number;
    variantDestinations: number;
    terminals: number;
    faresOrigin: number;
    faresDestination: number;
    childStops: number;
    stopNames: number;
    sourceLinks: number;
};

export type TransportStopMergeVariantConflict = {
    routeCode: string;
    variantCode: string;
    directionName: string | null;
    currentRouteStopId: string;
    currentSequence: number;
    candidateRouteStopId: string;
    candidateSequence: number;
};

export type TransportStopMergeAffectedRoute = {
    routeId: string;
    routeCode: string;
    routeName: string;
};

export type TransportStopMergeAffectedVariant = {
    variantId: string;
    variantCode: string;
    routeId: string;
    routeCode: string;
    directionName: string | null;
};

export type TransportStopMergeDuplicateMembershipConflict = {
    routeId: string;
    routeCode: string;
    variantId: string;
    variantCode: string;
    directionName: string | null;
    currentRouteStopId: string;
    currentSequence: number;
    candidateRouteStopId: string;
    candidateSequence: number;
};

export type TransportStopMergeSequenceConflict = {
    routeId: string;
    routeCode: string;
    variantId: string;
    variantCode: string;
    directionName: string | null;
    stopSequence: number;
    currentRouteStopId: string;
    candidateRouteStopId: string;
};

export type TransportStopMergeTerminalSummary = {
    id: string;
    publicId: string;
    name: string;
};

export type TransportStopMergeTerminalConflict = {
    exists: boolean;
    canonicalTerminal: TransportStopMergeTerminalSummary | null;
    duplicateTerminal: TransportStopMergeTerminalSummary | null;
};

export type TransportStopMergeScalarComparison<T> = {
    current: T;
    candidate: T;
    same: boolean;
};

export type TransportStopMergeGeomComparison = {
    current: { lat: number; lng: number } | null;
    candidate: { lat: number; lng: number } | null;
    same: boolean;
    distanceMeters: number | null;
};

export type TransportStopMergeFieldComparison = {
    name: TransportStopMergeScalarComparison<string>;
    name_mm: TransportStopMergeScalarComparison<string | null>;
    name_en: TransportStopMergeScalarComparison<string | null>;
    stop_type: TransportStopMergeScalarComparison<string>;
    geom: TransportStopMergeGeomComparison;
    admin_area_id: TransportStopMergeScalarComparison<number | null>;
    confidence_score: TransportStopMergeScalarComparison<number | null>;
    review_status: TransportStopMergeScalarComparison<string>;
    is_active: TransportStopMergeScalarComparison<boolean>;
};

export type TransportStopMergePreviewResponse = {
    currentStop: TransportStopMergePreviewStop;
    candidateStop: TransportStopMergePreviewStop;
    currentUsage: TransportStopRouteUsageDetailResponse;
    candidateUsage: TransportStopRouteUsageDetailResponse;
    sameVariantConflicts: TransportStopMergeVariantConflict[];
    sameVariantWarning: string | null;
    affectedRoutes: TransportStopMergeAffectedRoute[];
    affectedVariants: TransportStopMergeAffectedVariant[];
    duplicateMembershipConflicts: TransportStopMergeDuplicateMembershipConflict[];
    sequenceConflicts: TransportStopMergeSequenceConflict[];
    mergeAllowed: boolean;
    mergeBlockers: string[];
    terminalConflict: TransportStopMergeTerminalConflict;
    referenceCounts: {
        current: TransportStopMergeReferenceCounts;
        candidate: TransportStopMergeReferenceCounts;
    };
    fieldComparison: TransportStopMergeFieldComparison;
};

export type TransportStopMergeGlobalReferenceChanges = {
    routeStops: number;
    variantOrigins: number;
    variantDestinations: number;
    terminals: number;
    faresOrigin: number;
    faresDestination: number;
    childStops: number;
    stopNames: number;
    sourceLinks: number;
};

export type TransportStopMergeGlobalCounts = {
    canonicalBefore: TransportStopMergeReferenceCounts;
    canonicalAfter: TransportStopMergeReferenceCounts;
    duplicateBefore: TransportStopMergeReferenceCounts;
    duplicateAfter: TransportStopMergeReferenceCounts;
};

export type TransportStopMergeGlobalResult = {
    canonicalStop: TransportStopMergePreviewStop;
    deletedStop: TransportStopMergePreviewStop;
    deletedStopId: string;
    referencesChanged: TransportStopMergeGlobalReferenceChanges;
    affectedRouteCodes: string[];
    affectedVariantCodes: string[];
    counts: TransportStopMergeGlobalCounts;
};

export type TransportRouteName = {
    name: string;
    language_code: string;
    script_code: string | null;
    name_type: string;
    is_primary: boolean;
    search_weight: number;
};

/** Compact source-link summary — never includes the full source_payload JSONB. */
export type TransportSourceSummary = {
    source_name: string;
    source_kind: string;
    external_id: string | null;
    source_url: string | null;
    is_primary: boolean;
};

export type {
    TransportRouteMetadata,
    TransportRouteMetadataCounts,
    TransportRouteMetadataDiagnostics,
    TransportRouteMetadataNames,
    TransportRouteMetadataSummary,
    TransportRouteMetadataTrain,
} from "./transport-route-metadata.js";

import type { TransportRouteMetadata } from "./transport-route-metadata.js";

export type TransportRouteDetail = {
    public_id: string;
    route_code: string;
    public_name: string;
    name_mm: string | null;
    name_en: string | null;
    display_name: string;
    mode: string;
    route_kind: string;
    origin_name: string | null;
    destination_name: string | null;
    origin_admin_area_id: number | null;
    destination_admin_area_id: number | null;
    description: string | null;
    operator: { id: number; name: string } | null;
    confidence_score: number | null;
    review_status: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    counts: { variants: number; stops: number; paths: number };
    names: TransportRouteName[];
    sources: TransportSourceSummary[];
    routeMetadata: TransportRouteMetadata;
};

/** Result of POST /transport/routes/:publicId/swap-direction. */
export type TransportSwapRouteDirectionResult = {
    variants: TransportVariantSummary[];
};

export type TransportVariantSummary = {
    public_id: string;
    variant_code: string;
    direction_name: string | null;
    direction_id: number | null;
    headsign: string | null;
    origin_name: string | null;
    destination_name: string | null;
    /** Display name of this physical variant's first ordered route stop. */
    first_stop_name: string | null;
    stop_count: number;
    path_count: number;
    path_status: "has_path" | "none";
    distance_m: number | null;
    estimated_duration_min: number | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
    /** From normalized_data.departure_time_text when set. */
    departure_time_text: string | null;
};

/**
 * Result of creating a route via POST /transport/routes: the full route detail
 * plus the auto-generated variants (so the client does not need a follow-up
 * variants fetch).
 */
export type TransportRouteCreateResult = TransportRouteDetail & {
    variants: TransportVariantSummary[];
};

export type TransportRouteDiagnosticsRoute = {
    normalized_data: Record<string, unknown> | null;
    source_refs: Record<string, unknown> | null;
};

export type TransportRouteDiagnosticsVariant = {
    public_id: string;
    variant_code: string;
    normalized_data: Record<string, unknown> | null;
};

export type TransportRouteDiagnosticsSourceLink = {
    id: number;
    entity_type: string;
    entity_id: number;
    source_name: string;
    source_kind: string;
    external_id: string | null;
    source_url: string | null;
    import_batch_id: number | null;
    confidence_score: number | null;
    is_primary: boolean;
    created_at: string;
};

export type TransportRouteDiagnostics = {
    route: TransportRouteDiagnosticsRoute;
    variants: TransportRouteDiagnosticsVariant[];
    source_links: TransportRouteDiagnosticsSourceLink[];
    validation_warnings: string[];
};

export type TransportRouteStopItem = {
    id: string;
    stop_sequence: number;
    pickup_type: number;
    drop_off_type: number;
    is_timing_point: boolean;
    distance_from_start_m: number | null;
    /** Raw visible clock-time text from train import (audit/display). */
    source_time_text?: string | null;
    /** arrival | departure | arrival_departure | unknown */
    source_time_type?: string | null;
    /** Seconds from previous station departure to this arrival; null for first stop. */
    travel_time_from_previous_seconds?: number | null;
    /** Dwell time at this stop before departure; used to derive departure offset. */
    waiting_time_seconds?: number | null;
    arrival_offset_seconds?: number | null;
    departure_offset_seconds?: number | null;
    /** Intentional circular closing occurrence (same stop_id as an earlier row). */
    is_loop_closure?: boolean;
    stop: {
        public_id: string;
        name: string;
        name_mm: string | null;
        name_en: string | null;
        mode: string;
        stop_type: string;
        geometry: GeoJsonGeometry | null;
    };
};

export type TransportRoutePath = {
    id?: string;
    path_kind: string;
    review_status?: string | null;
    distance_m: number | null;
    geometry: GeoJsonGeometry | null;
};

/**
 * Result of a variant route-path mutation (PUT/DELETE): the active path geometry
 * (null after delete) plus the refreshed variant summary so the caller can update
 * path_status / path_count / distance without a follow-up fetch.
 */
export type TransportVariantPathResult = {
    path: TransportRoutePath | null;
    variant: TransportVariantSummary;
};

/** POST /transport/route-variants/:publicId/generate-path-from-stops response. */
export type GeneratePathFromStopsResult = {
    route_path_id: string;
    path_kind: string;
    review_status: string;
    geometry: GeoJsonGeometry;
    distance_m: number | null;
    warnings: string[];
};

export type TransportVariantStopsResponse = {
    items: TransportRouteStopItem[];
    total: number;
    limit: number;
    offset: number;
    /** Present only when `includePath=true`; null when the variant has no active path. */
    path: TransportRoutePath | null;
};

/**
 * One ordered stop in a variant with lightweight, read-only quality signals:
 * gap from the previous stop, deviation from the active route path, and
 * duplicate hints. Diagnostics only — no automatic fixes.
 */
export type TransportVariantStopQualityItem = {
    route_stop_id: string;
    stop_public_id: string;
    stop_name: string | null;
    stop_sequence: number;
    lng: number | null;
    lat: number | null;
    /** Straight-line meters from the previous ordered stop; null for the first stop. */
    distance_from_previous_m: number | null;
    /** Meters from the stop to the active route path; null when no active path exists. */
    distance_from_path_m: number | null;
    /** Same stop_id appears more than once without loop-closure metadata (data quality flag). */
    is_exact_duplicate_in_variant: boolean;
    /** Intentional circular closing occurrence; not treated as duplicate data. */
    is_loop_closure: boolean;
    /** Count of other active stops (same mode) within ~30 m of this stop. */
    nearby_duplicate_count: number;
};

export type TransportVariantStopQualityResponse = {
    items: TransportVariantStopQualityItem[];
    total: number;
};

/**
 * Lightweight ordered-stop row returned by the route_stop mutation endpoints
 * (insert-existing / create-and-insert / remove). Intentionally flat and small:
 * just what the Route Detail ordered-stop panel + map markers need, so the
 * dashboard can update locally without a heavy refetch. Excludes source_refs,
 * normalized_data, and GeoJSON path geometry by design.
 */
export type TransportOrderedStopLite = {
    route_stop_id: string;
    stop_public_id: string;
    stop_sequence: number;
    display_name: string;
    name_mm: string | null;
    name_en: string | null;
    mode: string;
    stop_type: string;
    /** Display coordinates: coalesce(stops.geom, route_stops.review_geom) — stop geom wins. */
    longitude: number | null;
    latitude: number | null;
    /** Physical stop coordinates from transport.stops.geom. */
    actual_longitude: number | null;
    actual_latitude: number | null;
    geometry_source: "route_stop_review_geom" | "stop_geom";
    pickup_type: number;
    drop_off_type: number;
    is_timing_point: boolean;
    review_status: string;
    source_time_text: string | null;
    source_time_type: string | null;
    travel_time_from_previous_seconds: number | null;
    waiting_time_seconds: number | null;
    arrival_offset_seconds: number | null;
    departure_offset_seconds: number | null;
    is_loop_closure: boolean;
};

/** Created-stop summary returned by create-and-insert (omitted otherwise). */
export type TransportCreatedStopLite = {
    route_stop_id: string;
    public_id: string;
    display_name: string;
    name_mm: string | null;
    name_en: string | null;
    mode: string;
    stop_type: string;
    longitude: number | null;
    latitude: number | null;
};

/**
 * Compact response for route_stop insert/remove mutations. Returns the full
 * updated 1..N ordered membership for the variant plus the new count and a cheap
 * path-existence flag, so the dashboard can refresh the panel/map/count from this
 * single response. No route path geometry (it does not change on a membership
 * edit) and no heavy stop fields.
 */
export type TransportRouteStopMutationResult = {
    variant_public_id: string | null;
    ordered_stops: TransportOrderedStopLite[];
    route_stop_count: number;
    has_verified_path: boolean;
    has_review_placeholder_path: boolean;
    /** Present only for create-and-insert. */
    created_stop?: TransportCreatedStopLite;
    /** Present only for remove (always true there). */
    deleted?: boolean;
};

/** Top import-issue categories derived from transport.import_errors.error_code. */
export type TransportImportIssueBreakdown = {
    missingNameMm: number;
    missingNameEn: number;
    fallbackName: number;
    routeGeometry: number;
    routeStopMember: number;
    lowConfidence: number;
    other: number;
};

export type TransportOverview = {
    counts: {
        routes: number;
        routeVariants: number;
        routePaths: number;
        routeStops: number;
        stops: number;
        terminals: number;
        infrastructureLines: number;
        importBatches: number;
        importErrors: number;
    };
    byMode: {
        routes: TransportCountsByKey;
        stops: TransportCountsByKey;
        terminals: TransportCountsByKey;
        infrastructureLines: TransportCountsByKey;
    };
    reviewStatus: {
        routes: TransportCountsByKey;
        stops: TransportCountsByKey;
        terminals: TransportCountsByKey;
        infrastructureLines: TransportCountsByKey;
    };
    quality: {
        routesWithStops: number;
        routesWithoutStops: number;
        routeVariantsWithPath: number;
        routeVariantsWithoutPath: number;
        ferryTerminalsImportedUnreviewed: number;
        generatedNameTerminals: number;
        generatedNameStops: number;
    };
    /** Breakdown of import warnings/issues by top category (sums to counts.importErrors). */
    importIssues: TransportImportIssueBreakdown;
    /** False when the transport schema is not present in the connected database. */
    schemaAvailable: boolean;
};
