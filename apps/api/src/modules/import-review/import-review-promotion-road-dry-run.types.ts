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
