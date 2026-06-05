export type RoadBulkValidationIssueRow = {
    publish_item_id: bigint;
    code: string;
    message: string;
    severity: "error" | "warning";
    field: string | null;
};

export type RoadBulkValidationSummary = {
    ready_count: number;
    warning_count: number;
    blocked_count: number;
    top_blocked_reasons: { code: string; count: number }[];
    elapsed_ms: number;
    issue_query_ms: number;
};
