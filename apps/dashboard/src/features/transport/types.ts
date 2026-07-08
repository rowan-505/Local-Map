/** Grouping key (mode / review_status) -> count. */
export type TransportCountsByKey = Record<string, number>;

export type TransportPaginated<T> = {
    items: T[];
    total: number;
    limit: number;
    offset: number;
    page?: number;
    hasNextPage?: boolean;
};

export type RouteGeometryStatus = "no_path" | "estimate" | "manual" | "verified";
export type PublicVisibility = "hidden" | "visible";
export type StopGeometryStatus = "missing" | "estimate" | "manual" | "verified";
export type DuplicateStatus = "none" | "nearby" | "duplicate_name";

export type TransportReviewAction =
    | "mark_reviewed"
    | "mark_needs_review"
    | "mark_verified"
    | "reject";

export type RouteReviewReadiness = {
    can_verify: boolean;
    can_mark_reviewed: boolean;
    blockers: string[];
    mark_reviewed_blockers: string[];
    warnings: string[];
};

export type TransportReviewStatusResult = {
    public_id: string;
    review_status: string;
};

export type TransportRoutePathReviewResult = {
    id: string;
    review_status: string;
};

export type ReplaceRouteStopResult = {
    route_stop_id: string;
    stop_id: string;
};

export type MergeTransportStopResult = {
    source_public_id: string;
    target_public_id: string;
    route_stops_updated: number;
};

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
    geometry_status: RouteGeometryStatus;
    public_visibility: PublicVisibility;
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
    geometry_status: StopGeometryStatus;
    duplicate_status: DuplicateStatus;
    updated_at: string;
};

export type TransportRawNameStatus = "real" | "generated" | "missing";

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
    vehicle_access: string;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    sources: TransportSourceSummaryLite[];
    source_refs: unknown;
    normalized_data: unknown;
};

export type UpdateTransportTerminalBody = {
    terminal_code?: string | null;
    name?: string;
    name_mm?: string | null;
    name_en?: string | null;
    mode?: string;
    terminal_role?: string;
    linked_stop_id?: number | null;
    operator_id?: number | null;
    admin_area_id?: number | null;
    review_status?: string;
    confidence_score?: number;
    is_active?: boolean;
    point?: { longitude: number; latitude: number };
};

/** One mode's row in the read-only transport quality summary. */
export type TransportQualitySummaryRow = {
    mode: string;
    routes: number;
    variants: number;
    variants_without_stops: number;
    variants_without_path: number;
    variants_unknown_direction: number;
    routes_without_variants: number;
};

export type TransportQualitySummary = {
    items: TransportQualitySummaryRow[];
    schemaAvailable: boolean;
};

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
    lowConfidenceThreshold: number;
    schemaAvailable: boolean;
};

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

export type TransportImportErrorListItem = {
    id: number;
    import_batch_id: number | null;
    entity_type: string;
    external_id: string | null;
    error_code: string;
    error_message: string;
    created_at: string;
};

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

export type GeoJsonGeometry = {
    type: string;
    coordinates: unknown;
};

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
    length_m: number | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    sources: TransportSourceSummaryLite[];
    source_refs: unknown;
    normalized_data: unknown;
};

export type UpdateTransportInfrastructureLineBody = {
    name?: string | null;
    name_mm?: string | null;
    name_en?: string | null;
    mode?: string;
    line_type?: string;
    admin_area_id?: number | null;
    review_status?: string;
    confidence_score?: number;
    is_active?: boolean;
};

export type TransportSourceSummaryLite = {
    source_name: string;
    source_kind: string;
    external_id: string | null;
    source_url: string | null;
    is_primary: boolean;
};

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
    linked_terminal: TransportStopLinkedTerminal | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    sources: TransportSourceSummaryLite[];
    source_refs: unknown;
    normalized_data: unknown;
};

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

export type UpdateTransportStopBody = {
    stop_code?: string | null;
    name_mm?: string | null;
    name_en?: string | null;
    mode?: string;
    stop_type?: string;
    admin_area_id?: number | null;
    parent_stop_id?: number | null;
    review_status?: string;
    confidence_score?: number;
    is_active?: boolean;
    point?: { longitude: number; latitude: number };
};

/** Body for PATCH /transport/stops/:stopPublicId/location (location-only edit). */
export type UpdateTransportStopLocationBody = {
    lng: number;
    lat: number;
    review_status?: string;
    confidence_score?: number;
};

/** Compact nearby-stop hit for duplicate checks around a stop location. */
export type TransportNearbyStop = {
    stop_public_id: string;
    name: string;
    distance_m: number;
    mode: string;
    stop_type: string;
};

export type TransportStopLocationUpdateResult = {
    stop: TransportStopDetail;
    nearby_stops: TransportNearbyStop[];
};

export type TransportRouteName = {
    name: string;
    language_code: string;
    script_code: string | null;
    name_type: string;
    is_primary: boolean;
    search_weight: number;
};

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
    geometry_source?: "route_stop_review_geom" | "stop_geom";
    stop: {
        public_id: string;
        name: string;
        name_mm: string | null;
        name_en: string | null;
        mode: string;
        stop_type: string;
        geometry: GeoJsonGeometry | null;
        review_status?: string;
    };
};

export type TransportRoutePath = {
    id?: string;
    path_kind: string;
    review_status?: string | null;
    distance_m: number | null;
    geometry: GeoJsonGeometry | null;
    /** Present on some API responses when path metadata is included. */
    normalized_data?: Record<string, unknown> | null;
};

/** Body for PUT /transport/variants/:variantPublicId/path (manual path upsert). */
export type PutTransportVariantPathBody = {
    coordinates: [number, number][];
    path_kind?: "manual" | "manual_drawn";
    manually_adjusted?: boolean;
};

/** Result of a variant route-path mutation: active path (null after delete) + variant. */
export type TransportVariantPathResult = {
    path: TransportRoutePath | null;
    variant: TransportVariantSummary;
};

/**
 * POST /transport/route-variants/:variantPublicId/generate-path-from-stops
 * Road-following path generated from ordered stop coordinates (backend/Valhalla).
 */
export type GeneratePathFromStopsResult = {
    route_path_id: string;
    path_kind: string;
    review_status: string;
    geometry: GeoJsonGeometry;
    distance_m: number | null;
    warnings: string[];
};

export type TransportVariantsResponse = {
    items: TransportVariantSummary[];
    total: number;
};

/**
 * POST /transport/routes body. Creates a route plus its default variants. The
 * server derives route_kind from the mode and stamps review_status /
 * confidence_score / source_refs, so they are not sent here.
 */
export type CreateTransportRouteBody = {
    mode: "bus" | "train" | "ferry";
    route_code: string;
    public_name: string;
    origin_name?: string | null;
    destination_name?: string | null;
    operator_id?: number | null;
    create_return_variant?: boolean;
    is_loop?: boolean;
};

/** Response of POST /transport/routes: the new route detail plus its variants. */
export type TransportRouteCreateResult = TransportRouteDetail & {
    variants: TransportVariantSummary[];
};

export type UpdateTransportRouteBody = {
    route_code?: string;
    name_mm?: string | null;
    name_en?: string | null;
    mode?: string;
    route_kind?: string;
    origin_name?: string | null;
    destination_name?: string | null;
    description?: string | null;
    review_status?: string;
    confidence_score?: number;
    is_active?: boolean;
};

export type UpdateRouteStopBody = {
    pickup_type?: number;
    drop_off_type?: number;
    is_timing_point?: boolean;
};

export type RouteStopMutationResult = {
    moved?: boolean;
    deleted?: boolean;
    variantPublicId: string | null;
};

/**
 * Archive (soft-delete) response for a stop. The stop and any linked terminals
 * have deleted_at set + is_active = false; route_stops and source records are
 * never touched. `route_count` is always 0 on success (archiving is rejected
 * with 409 while the stop is still used by routes).
 */
export type TransportStopArchiveResult = {
    archived: boolean;
    public_id: string;
    route_count: number;
    archived_terminals: string[];
};

/**
 * Flat lightweight ordered-stop row returned by the route_stop mutation
 * endpoints (insert-existing / create-and-insert / remove). Small by design so
 * the Route Detail page can update its panel + map markers locally without a
 * heavy includePath refetch. No path geometry, no source_refs/normalized_data.
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
    actual_longitude: number | null;
    actual_latitude: number | null;
    geometry_source: "route_stop_review_geom" | "stop_geom";
    pickup_type: number;
    drop_off_type: number;
    is_timing_point: boolean;
    review_status: string;
};

/** Created-stop summary returned by create-and-insert. */
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
 * Compact response for route_stop insert/remove mutations. Carries the full
 * updated 1..N ordered membership plus the new count and a cheap path-existence
 * flag, so the dashboard updates the ordered-stop panel, map overlay, and count
 * from this single response (no follow-up detail/variants/stops refetch).
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

export type UpdateTransportVariantBody = {
    variant_code?: string;
    direction_name?: string | null;
    direction_id?: number | null;
    headsign?: string | null;
    origin_name?: string | null;
    destination_name?: string | null;
    origin_stop_public_id?: string | null;
    destination_stop_public_id?: string | null;
    estimated_duration_min?: number | null;
    review_status?: string;
    confidence_score?: number;
    is_active?: boolean;
};

/**
 * POST /transport/routes/:routePublicId/variants body. `variant_code` is required
 * and unique per route. direction_id: 0 outbound, 1 inbound, 2 loop/branch, null
 * unknown. review_status / confidence_score default server-side when omitted.
 */
export type CreateTransportVariantBody = {
    variant_code: string;
    direction_id?: number | null;
    direction_name?: string | null;
    headsign?: string | null;
    origin_name?: string | null;
    destination_name?: string | null;
    origin_stop_public_id?: string | null;
    destination_stop_public_id?: string | null;
    review_status?: string;
    confidence_score?: number;
};

export type TransportVariantStopsResponse = {
    items: TransportRouteStopItem[];
    total: number;
    limit: number;
    offset: number;
    path: TransportRoutePath | null;
};

/** One ordered stop with read-only quality signals from the stop-quality endpoint. */
export type TransportVariantStopQualityItem = {
    route_stop_id: string;
    stop_public_id: string;
    stop_name: string | null;
    stop_sequence: number;
    lng: number | null;
    lat: number | null;
    distance_from_previous_m: number | null;
    distance_from_path_m: number | null;
    is_exact_duplicate_in_variant: boolean;
    nearby_duplicate_count: number;
};

export type TransportVariantStopQualityResponse = {
    items: TransportVariantStopQualityItem[];
    total: number;
};

/** One hit from GET /transport/stops/search (lightweight stop picker). */
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

export type TransportStopSearchResponse = {
    items: TransportStopSearchItem[];
    limit: number;
};

/**
 * Body for POST /transport/route-variants/:publicId/stops/insert-existing.
 * The backend owns stop_sequence — callers send only a relative position
 * (and an anchor route_stop id for before/after).
 */
export type InsertExistingRouteStopBody = {
    stopPublicId?: string;
    stopId?: number;
    position: "start" | "end" | "before" | "after";
    anchorRouteStopId?: string;
    pickup_type?: number;
    drop_off_type?: number;
    is_timing_point?: boolean;
};

/**
 * Body for POST /transport/route-variants/:publicId/stops/create-and-insert
 * (secondary quick-create path in the Insert Stop modal). At least one of
 * name_mm / name_en must be present. The backend owns stop_sequence.
 */
export type CreateAndInsertRouteStopBody = {
    name_mm?: string;
    name_en?: string;
    mode: string;
    stop_type: string;
    longitude: number;
    latitude: number;
    position: "start" | "end" | "before" | "after";
    anchorRouteStopId?: string;
    pickup_type?: number;
    drop_off_type?: number;
    is_timing_point?: boolean;
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
    importIssues: TransportImportIssueBreakdown;
    schemaAvailable: boolean;
};
