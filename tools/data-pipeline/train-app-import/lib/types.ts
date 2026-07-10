/**
 * Shared JSON types for the simple Myanmar train app import pipeline.
 *
 * Flow: raw (per language) → merged → normalized → station-matches → import-ready
 */

/** UI language extracted from the train app. English first, then Myanmar. */
export type TrainLanguage = "en" | "my";

/** How visible clock text should be stored on route_stops.source_time_type. */
export type SourceTimeType = "arrival" | "departure" | "arrival_departure" | "unknown";

export const TRAIN_RAW_SCHEMA_VERSION = 1;
export const TRAIN_MERGED_SCHEMA_VERSION = 1;
export const TRAIN_NORMALIZED_SCHEMA_VERSION = 1;
export const TRAIN_MATCH_SCHEMA_VERSION = 1;
export const TRAIN_IMPORT_READY_SCHEMA_VERSION = 1;

export const TRAIN_SOURCE_NAME = "external_myanmar_train_app";
export const TRAIN_SOURCE_KIND = "visible_app_extraction";

// ---------------------------------------------------------------------------
// Raw extraction (screen read — no normalization)
// ---------------------------------------------------------------------------

/** One route card from the train app "All" tab list screen. */
export type TrainRouteListCard = {
    list_index: number;
    train_number: string | null;
    direction_text: string | null;
    route_title: string | null;
    origin_destination_text: string | null;
    start_time_text: string | null;
    badges: string[];
    raw_card_text: string[];
    card_bounds?: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        centerX: number;
        centerY: number;
    } | null;
};

/** Route list index file written by extract-yrsmm-web.ts (or legacy extract-route-index.ts). */
export type TrainRouteListFile = {
    schema_version: typeof TRAIN_RAW_SCHEMA_VERSION;
    language: TrainLanguage;
    extracted_at: string;
    source: {
        app: string | null;
        tab: "All";
        method: "adb_uiautomator_xml" | "adb_uiautomator_xml_replay" | "yrsmm_web_inertia";
        device_id?: string | null;
        package?: string | null;
        focused_app?: string | null;
    };
    routes: TrainRouteListCard[];
    extraction: {
        run_root: string;
        xml_dump_count: number;
        xml_paths: string[];
        screenshot_paths: string[];
        stale_scroll_limit: number;
        completed_with_stale_scroll: boolean;
        replayed_from_page_sources?: boolean;
    };
    warnings: string[];
};

/** Origin or destination endpoint read from the detail header. */
export type RawTrainEndpoint = {
    name: string | null;
    time_text: string | null;
};

/** One station row read from the expanded schedule list. */
export type RawTrainStationRow = {
    sequence: number;
    name: string;
    time_text: string | null;
    /** Legacy merge fields populated from name/time_text when available. */
    station_name_raw?: string;
    arrival_time_raw?: string | null;
    departure_time_raw?: string | null;
    dwell_time_raw?: string | null;
    raw_row_text?: string | null;
};

/** Full detail page for one train_number + direction in one language. */
export type RawTrainRouteDetail = {
    schema_version: typeof TRAIN_RAW_SCHEMA_VERSION;
    language: TrainLanguage;
    extracted_at: string;
    variant_code: string;
    train_number: string;
    direction_text: string | null;
    route_title: string | null;
    route_subtitle: string | null;
    operation_text: string | null;
    origin: RawTrainEndpoint;
    destination: RawTrainEndpoint;
    type: string | null;
    direction: string | null;
    way: string | null;
    train_model: string | null;
    total_stations_text: string | null;
    traveling_time_text: string | null;
    stations: RawTrainStationRow[];
    schedule_complete_marker_seen: boolean;
    warnings?: string[];
    extraction?: {
        page_source_dir?: string;
        screenshot_paths?: string[];
        xml_dump_count?: number;
        scroll_pass_count?: number;
        ended_at_collapse_schedule?: boolean;
        method?: "adb_uiautomator_xml" | "adb_uiautomator_xml_replay" | "adb_uiautomator_xml_current_route" | "yrsmm_web_inertia";
        replayed_from_page_sources?: boolean;
        opened_from_route_list?: boolean;
    };
    /** Legacy merge aliases (kept for older readers). */
    route_title_raw?: string | null;
    train_type_raw?: string | null;
    train_model_raw?: string | null;
    way_raw?: string | null;
    operation_day_raw?: string | null;
    origin_raw?: string | null;
    destination_raw?: string | null;
    total_stations_raw?: string | null;
    travel_duration_raw?: string | null;
};

// ---------------------------------------------------------------------------
// Merged (EN + MY aligned by train_number + direction_code + station sequence)
// ---------------------------------------------------------------------------

export type DirectionCode = "UP" | "DOWN" | "CLOCKWISE" | "ANTICLOCKWISE" | "UNKNOWN";

export type MergeStatus = "merged" | "needs_manual_fix" | "blocked_missing_language";

export type MergedTrainStation = {
    sequence: number;
    name_en?: string | null;
    name_my?: string | null;
    source_time_text?: string | null;
};

/** Myanmar + English combined for one train_number + direction_code. */
export type MergedTrainRoute = {
    schema_version: typeof TRAIN_MERGED_SCHEMA_VERSION;
    merged_at: string;
    route_code: string;
    variant_code: string;
    train_number: string;
    direction_code: DirectionCode;
    direction_name_en?: string | null;
    direction_name_my?: string | null;
    origin_name_en?: string | null;
    origin_name_my?: string | null;
    destination_name_en?: string | null;
    destination_name_my?: string | null;
    type_en?: string | null;
    type_my?: string | null;
    way_en?: string | null;
    way_my?: string | null;
    train_model?: string | null;
    operation_text_en?: string | null;
    operation_text_my?: string | null;
    source_start_time_text?: string | null;
    source_end_time_text?: string | null;
    total_stations: number;
    traveling_time_text?: string | null;
    stations: MergedTrainStation[];
    warnings: string[];
    merge_status: MergeStatus;
};

// ---------------------------------------------------------------------------
// Normalized (DB-compatible fields only)
// ---------------------------------------------------------------------------

export type NormalizedTrainStation = {
    sequence: number;
    station_name_en?: string | null;
    station_name_my?: string | null;
    travel_time_from_previous_seconds?: number | null;
    arrival_offset_seconds?: number | null;
    departure_offset_seconds?: number | null;
    source_time_text?: string | null;
    source_time_type?: SourceTimeType | null;
};

export type NormalizationStatus = "ready_for_station_match" | "needs_manual_fix";

/** Normalized train type codes. */
export type TrainTypeCode =
    | "mail"
    | "express"
    | "local"
    | "urban"
    | "demu"
    | "unknown";

/** GTFS-style direction id: UP = 0, DOWN = 1, UNKNOWN = null. */
export type DirectionId = 0 | 1 | null;

/** Route-level normalized fields (one route across both directions). */
export type NormalizedTrainRouteInfo = {
    route_code: string;
    mode: "train";
    route_kind: "rail";
    public_name: string;
    public_name_my: string;
    train_number: string;
    origin_name_en?: string | null;
    origin_name_my?: string | null;
    destination_name_en?: string | null;
    destination_name_my?: string | null;
    train_type: TrainTypeCode;
    train_type_raw?: string | null;
    train_model?: string | null;
    operation_days: string[];
    operation_text_en?: string | null;
    operation_text_my?: string | null;
};

/** Variant-level normalized fields (one direction). */
export type NormalizedTrainVariantInfo = {
    variant_code: string;
    direction_code: DirectionCode;
    direction_id: DirectionId;
    direction_name_en?: string | null;
    direction_name_my?: string | null;
    total_stations: number;
    traveling_time_text?: string | null;
    travel_duration_seconds?: number | null;
};

export type NormalizedTrainStatus = {
    normalization_status: NormalizationStatus;
    warnings: string[];
};

export type NormalizedTrainSource = {
    source_name: typeof TRAIN_SOURCE_NAME;
    source_kind: typeof TRAIN_SOURCE_KIND;
    merged_at?: string | null;
};

/** Clean route file ready for station matching. */
export type NormalizedTrainRoute = {
    schema_version: typeof TRAIN_NORMALIZED_SCHEMA_VERSION;
    normalized_at: string;
    route: NormalizedTrainRouteInfo;
    variant: NormalizedTrainVariantInfo;
    stations: NormalizedTrainStation[];
    status: NormalizedTrainStatus;
    source: NormalizedTrainSource;
};

// ---------------------------------------------------------------------------
// Station match (read-only DB lookup output)
// ---------------------------------------------------------------------------

export type StationMatchConfidence = "exact" | "fuzzy" | "ambiguous" | "none";

export type StationMatchRow = {
    sequence: number;
    station_name_en?: string | null;
    station_name_my?: string | null;
    matched_stop_id?: number | null;
    matched_stop_public_id?: string | null;
    match_method?: string | null;
    match_confidence: StationMatchConfidence;
};

export type StationMatchStatus = "fully_matched" | "partial" | "unmatched";

/** Result of matching normalized stations to transport.stops where mode = train. */
export type StationMatchResult = {
    schema_version: typeof TRAIN_MATCH_SCHEMA_VERSION;
    matched_at: string;
    train_number: string;
    direction: string;
    route_code: string;
    variant_code: string;
    match_status: StationMatchStatus;
    stations: StationMatchRow[];
    matched_count: number;
    unmatched_count: number;
    warnings?: string[];
};

// ---------------------------------------------------------------------------
// Import-ready (fully matched — input for import-train-route.ts)
// ---------------------------------------------------------------------------

export type ImportReadyTrainStation = NormalizedTrainStation & {
    stop_id: number;
    stop_public_id: string;
    match_method?: string | null;
    match_score?: number | null;
};

export type ImportReadyStatus = "ready" | "blocked";

export type TrainRouteMatchQuality = "ready_for_import" | "needs_station_match_review";

/** One route ready for a single-route DB import transaction. */
export type ImportReadyTrainRoute = {
    schema_version: typeof TRAIN_IMPORT_READY_SCHEMA_VERSION;
    prepared_at: string;
    train_number: string;
    direction: string;
    route_code: string;
    variant_code: string;
    route_quality_status: TrainRouteMatchQuality;
    train_type?: string | null;
    train_model?: string | null;
    operation_day?: string | null;
    origin_name_en?: string | null;
    origin_name_my?: string | null;
    destination_name_en?: string | null;
    destination_name_my?: string | null;
    public_name?: string | null;
    public_name_my?: string | null;
    total_stations: number;
    travel_duration_seconds?: number | null;
    stations: ImportReadyTrainStation[];
    import_status: ImportReadyStatus;
    source_name: typeof TRAIN_SOURCE_NAME;
    source_kind: typeof TRAIN_SOURCE_KIND;
    warnings?: string[];
};

/** Aggregate auto-match output written by match-train-stations.ts. */
export type TrainAutoMatchesFile = {
    schema_version: typeof TRAIN_MATCH_SCHEMA_VERSION;
    matched_at: string;
    stop_pool_count: number;
    routes: Array<{
        variant_code: string;
        route_code: string;
        train_number: string;
        direction_code: string;
        route_quality_status: TrainRouteMatchQuality;
        matched_count: number;
        unmatched_count: number;
        ambiguous_count: number;
        stations: Array<{
            sequence: number;
            station_name_en: string | null;
            station_name_my: string | null;
            matched_stop_id: number | null;
            matched_stop_public_id: string | null;
            match_method: string;
            match_score: number;
            match_confidence: StationMatchConfidence;
            candidate_stop_ids: number[];
        }>;
        warnings: string[];
    }>;
    summary: {
        route_count: number;
        ready_for_import: number;
        needs_station_match_review: number;
        total_stations: number;
        matched_stations: number;
        unmatched_stations: number;
        ambiguous_stations: number;
    };
};

/** Unmatched or ambiguous stations across all routes. */
export type TrainUnmatchedStationsFile = {
    schema_version: typeof TRAIN_MATCH_SCHEMA_VERSION;
    generated_at: string;
    entries: Array<{
        variant_code: string;
        route_code: string;
        sequence: number;
        station_name_en: string | null;
        station_name_my: string | null;
        reason: "unmatched" | "ambiguous";
        candidate_stop_ids: number[];
    }>;
};
