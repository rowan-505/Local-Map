export type ImportReviewRoadValidationSeverity = "error" | "warning" | "info";

export type ImportReviewRoadValidationIssue = {
    code: string;
    message: string;
    severity: ImportReviewRoadValidationSeverity;
};

export type ImportReviewRoadRoutingValidationMode = "existing_region" | "new_region";

export type ImportReviewRoadRoutingValidationStats = {
    nearby_core_roads: number;
    nearby_review_roads: number;
    connected_endpoints: number;
    isolated_endpoints: number;
    possible_duplicates: number;
    possible_unsplit_intersections: number;
    length_m: number;
};

export type ImportReviewRoadRoutingValidationResult = {
    candidate_id: string;
    validation_mode: ImportReviewRoadRoutingValidationMode;
    can_save: boolean;
    can_approve: boolean;
    errors: ImportReviewRoadValidationIssue[];
    warnings: ImportReviewRoadValidationIssue[];
    info: ImportReviewRoadValidationIssue[];
    stats: ImportReviewRoadRoutingValidationStats;
};

/** Codes that block approval unless confirm_warnings=true. */
export const SERIOUS_ROUTING_WARNING_CODES = new Set([
    "ROAD_ISLAND",
    "IMPORTANT_ROAD_ISOLATED",
    "POSSIBLE_DUPLICATE_CORE_ROAD",
    "POSSIBLE_DUPLICATE_REVIEW_ROAD",
    "DUPLICATE_EXTERNAL_ID_IN_REVIEW_BATCH",
    "POSSIBLE_UNSPLIT_INTERSECTION",
    "CANDIDATE_NETWORK_ISLAND",
    "ROAD_SELF_INTERSECTION",
]);
