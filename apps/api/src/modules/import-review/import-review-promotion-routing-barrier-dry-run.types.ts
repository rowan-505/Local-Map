export type RoutingBarrierDryRunItemStatus =
    | "safe_to_promote"
    | "promote_with_warning"
    | "needs_manual_review"
    | "blocked";

export type RoutingBarrierDryRunGeometrySummary = {
    srid: number | null;
    geom_type: string | null;
    is_valid: boolean | null;
};

export type RoutingBarrierDryRunNetworkSummary = {
    nearby_core_roads: number;
    nearby_review_roads: number;
    nearest_core_street_id: string | null;
    nearest_core_road_distance_m: number | null;
};

export type RoutingBarrierDryRunSampleItem = {
    publish_item_id: string;
    review_candidate_id: string;
    external_id: string | null;
    barrier_type: string | null;
    dry_run_status: RoutingBarrierDryRunItemStatus;
    blocking_reasons: string[];
    warning_codes: string[];
    info_codes: string[];
};

export type RoutingBarrierDryRunItemResult = RoutingBarrierDryRunSampleItem & {
    publish_action: string;
    matched_core_id: string | null;
    core_street_id: string | null;
    geometry_summary: RoutingBarrierDryRunGeometrySummary | null;
    network_summary: RoutingBarrierDryRunNetworkSummary | null;
    can_promote_later: boolean;
};

export type ImportReviewPromotionRoutingBarrierDryRunResult = {
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
    network_warning_count: number;
    would_insert_count: number;
    would_update_count: number;
    by_warning_code: Record<string, number>;
    by_error_code: Record<string, number>;
    by_barrier_type: Record<string, number>;
    sample_blocked_items: RoutingBarrierDryRunSampleItem[];
    sample_warning_items: RoutingBarrierDryRunSampleItem[];
    disabled_because_env_flag_false: boolean;
    items: RoutingBarrierDryRunItemResult[];
    finished_at: string;
    message: string;
};
