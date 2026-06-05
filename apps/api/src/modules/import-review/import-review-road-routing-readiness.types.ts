export type ImportReviewRoadRoutingReadinessStatus = "passed" | "failed";

export type ImportReviewRoadRoutingReadinessSampleIssue = {
    publish_item_id: string;
    review_candidate_id: string | null;
    external_id: string | null;
    code: string;
    message: string;
};

/** Persisted at summary.routing_readiness_validation (alias: routing_validation). */
export type ImportReviewRoadRoutingReadinessSummary = {
    status: ImportReviewRoadRoutingReadinessStatus;
    type: "db_routing_readiness";
    checked_count: number;
    failed_count: number;
    warning_count: number;
    sample_errors: ImportReviewRoadRoutingReadinessSampleIssue[];
    sample_warnings: ImportReviewRoadRoutingReadinessSampleIssue[];
    ran_at: string;
};
