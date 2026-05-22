export type RoadDryRunItemStatus =
    | "safe_to_promote"
    | "promote_with_warning"
    | "needs_manual_review"
    | "blocked";

export type RoadDryRunGeometrySummary = {
    srid: number | null;
    geom_type: string | null;
    length_m: number | null;
    is_valid: boolean | null;
    part_count: number | null;
};

export type RoadDryRunConnectivitySummary = {
    validation_mode: string;
    nearby_core_roads: number;
    nearby_review_roads: number;
    connected_endpoints: number;
    isolated_endpoints: number;
    possible_unsplit_intersections: number;
};

export type RoadDryRunDuplicateSummary = {
    possible_duplicates: number;
    duplicate_core_external_id: boolean;
    duplicate_batch_external_id: boolean;
    likely_name_class_duplicate: boolean;
};

export type RoadDryRunRoutingSummary = {
    road_class_code: string | null;
    is_oneway: boolean | null;
    surface: string | null;
    access: string | null;
    speed_kph: number | null;
    bridge: boolean | null;
    tunnel: boolean | null;
    layer: number | null;
};

export type RoadDryRunSampleItem = {
    publish_item_id: string;
    review_candidate_id: string;
    external_id: string | null;
    canonical_name: string | null;
    dry_run_status: RoadDryRunItemStatus;
    blocking_reasons: string[];
    warning_codes: string[];
    info_codes: string[];
};

export type RoadDryRunItemResult = {
    publish_item_id: string;
    review_candidate_id: string;
    external_id: string | null;
    canonical_name: string | null;
    publish_action: string;
    dry_run_status: RoadDryRunItemStatus;
    blocking_reasons: string[];
    warning_codes: string[];
    info_codes: string[];
    matched_core_id: string | null;
    geometry_summary: RoadDryRunGeometrySummary | null;
    connectivity_summary: RoadDryRunConnectivitySummary | null;
    duplicate_summary: RoadDryRunDuplicateSummary | null;
    routing_summary: RoadDryRunRoutingSummary | null;
    can_promote_later: boolean;
};

export type ImportReviewPromotionRoadDryRunResult = {
    batch_id: string;
    review_batch_id: string | null;
    total_count: number;
    safe_to_promote_count: number;
    promote_with_warning_count: number;
    needs_manual_review_count: number;
    blocked_count: number;
    warning_count: number;
    error_count: number;
    duplicate_risk_count: number;
    connectivity_warning_count: number;
    unsplit_intersection_count: number;
    would_insert_count: number;
    would_update_count: number;
    by_warning_code: Record<string, number>;
    by_error_code: Record<string, number>;
    by_road_class: Record<string, number>;
    sample_blocked_items: RoadDryRunSampleItem[];
    sample_warning_items: RoadDryRunSampleItem[];
    disabled_because_env_flag_false: boolean;
    items: RoadDryRunItemResult[];
    finished_at: string;
    message: string;
};
