export const IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES = [
    { key: "load_batch", label: "Load batch", progressEnd: 5 },
    { key: "load_items", label: "Load items", progressEnd: 12 },
    { key: "candidate_integrity", label: "Candidate integrity", progressEnd: 30 },
    { key: "geometry_validation", label: "Geometry validation", progressEnd: 45 },
    { key: "required_field_validation", label: "Required fields", progressEnd: 60 },
    { key: "reference_validation", label: "References", progressEnd: 72 },
    { key: "duplicate_validation", label: "Duplicates", progressEnd: 85 },
    { key: "action_validation", label: "Action validation", progressEnd: 95 },
    { key: "validation_summary", label: "Summary", progressEnd: 100 },
] as const;

export type ImportReviewPublishValidationStageKey =
    (typeof IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES)[number]["key"];

export type ImportReviewValidationSeverity = "error" | "warning";

export type ImportReviewValidationIssue = {
    code: string;
    message: string;
    severity: ImportReviewValidationSeverity;
    stage_key?: ImportReviewPublishValidationStageKey;
};

export type ImportReviewPublishItemValidationStatus = "valid" | "warning" | "blocked";

export type ImportReviewPublishBatchValidationResult = {
    outcome: "passed" | "blocked";
    valid_count: number;
    warning_count: number;
    blocked_count: number;
    total_items: number;
    by_publish_action: { insert: number; update: number; merge: number };
    entity_family: { buildings: number };
};

export type ImportReviewPublishBatchProgressRow = {
    id: bigint;
    status: string;
    validation_total: number;
    validation_done: number;
    validation_percent: number;
    validated_at: Date | null;
    summary: unknown;
};

export type ImportReviewPublishStageLogRow = {
    id: bigint;
    publish_batch_id: bigint;
    stage_key: string;
    stage_label: string;
    stage_status: string;
    message: string | null;
    progress_percent: number;
    details: unknown;
    started_at: Date;
    finished_at: Date | null;
};

export type ImportReviewPublishValidationIssueRow = {
    publish_item_id: bigint;
    code: string;
    message: string;
    severity: ImportReviewValidationSeverity;
};
