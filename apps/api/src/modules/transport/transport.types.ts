/** Generic paginated envelope used by all transport list endpoints. */
export type TransportPaginated<T> = {
    items: T[];
    total: number;
    limit: number;
    offset: number;
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
};

export type TransportVariantSummary = {
    public_id: string;
    variant_code: string;
    direction_name: string | null;
    direction_id: number | null;
    headsign: string | null;
    origin_name: string | null;
    destination_name: string | null;
    stop_count: number;
    path_count: number;
    path_status: "has_path" | "none";
    distance_m: number | null;
    estimated_duration_min: number | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
};

export type TransportRouteStopItem = {
    id: string;
    stop_sequence: number;
    pickup_type: number;
    drop_off_type: number;
    is_timing_point: boolean;
    distance_from_start_m: number | null;
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
    path_kind: string;
    distance_m: number | null;
    geometry: GeoJsonGeometry | null;
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
    longitude: number | null;
    latitude: number | null;
    pickup_type: number;
    drop_off_type: number;
    is_timing_point: boolean;
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
