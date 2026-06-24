/** Grouping key (mode / review_status) -> count. */
export type TransportCountsByKey = Record<string, number>;

export type TransportPaginated<T> = {
    items: T[];
    total: number;
    limit: number;
    offset: number;
};

export type TransportRouteListItem = {
    public_id: string;
    route_code: string;
    public_name: string;
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
    mode: string;
    stop_type: string;
    route_count: number;
    admin_area_id: number | null;
    admin_area_name: string | null;
    review_status: string;
    confidence_score: number | null;
    is_active: boolean;
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
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    sources: TransportSourceSummaryLite[];
    source_refs: unknown;
    normalized_data: unknown;
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
    name?: string;
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

export type TransportVariantsResponse = {
    items: TransportVariantSummary[];
    total: number;
};

export type UpdateTransportRouteBody = {
    route_code?: string;
    public_name?: string;
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

export type UpdateTransportVariantBody = {
    variant_code?: string;
    direction_name?: string | null;
    direction_id?: number | null;
    headsign?: string | null;
    origin_name?: string | null;
    destination_name?: string | null;
    estimated_duration_min?: number | null;
    review_status?: string;
    confidence_score?: number;
    is_active?: boolean;
};

export type TransportVariantStopsResponse = {
    items: TransportRouteStopItem[];
    total: number;
    limit: number;
    offset: number;
    path: TransportRoutePath | null;
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
