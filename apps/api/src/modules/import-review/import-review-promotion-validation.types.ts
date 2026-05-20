import type { PublishStageStatus } from "./import-review-promotion-stage-status.js";

export const IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES = [
    { key: "load_batch", label: "Load batch", progressEnd: 5 },
    { key: "load_items", label: "Load items", progressEnd: 10 },
    { key: "group_by_entity", label: "Group by entity", progressEnd: 15 },
    { key: "validate_candidate_state", label: "Candidate state", progressEnd: 30 },
    { key: "validate_geometry", label: "Geometry", progressEnd: 45 },
    { key: "validate_required_fields", label: "Required fields", progressEnd: 58 },
    { key: "validate_references", label: "References", progressEnd: 70 },
    { key: "validate_duplicates", label: "Duplicates", progressEnd: 82 },
    { key: "validate_entity_specific_rules", label: "Entity-specific rules", progressEnd: 94 },
    { key: "write_validation_summary", label: "Write summary", progressEnd: 100 },
] as const;

export const IMPORT_REVIEW_PUBLISH_ITEM_VALIDATION_STAGES = [
    "validate_candidate_state",
    "validate_geometry",
    "validate_required_fields",
    "validate_references",
    "validate_duplicates",
    "validate_entity_specific_rules",
] as const;

export type ImportReviewPublishValidationStageKey =
    (typeof IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES)[number]["key"];

export type ImportReviewPublishItemValidationStageKey =
    (typeof IMPORT_REVIEW_PUBLISH_ITEM_VALIDATION_STAGES)[number];

export type ImportReviewValidationSeverity = "error" | "warning";

export type ImportReviewValidationIssue = {
    code: string;
    message: string;
    severity: ImportReviewValidationSeverity;
    stage_key?: ImportReviewPublishValidationStageKey;
};

export type ImportReviewPublishItemValidationStatus = "valid" | "warning" | "blocked" | "skipped";

export type ImportReviewPublishBatchEntityValidationCounts = {
    total: number;
    valid: number;
    warning: number;
    blocked: number;
    skipped: number;
};

export type ImportReviewPublishBatchValidationResult = {
    outcome: "passed" | "blocked";
    can_promote: boolean;
    requires_warning_confirmation: boolean;
    valid_count: number;
    warning_count: number;
    blocked_count: number;
    skipped_count: number;
    total_items: number;
    by_publish_action: { insert: number; update: number; merge: number };
    by_entity: Record<string, ImportReviewPublishBatchEntityValidationCounts>;
    /** @deprecated Use by_entity */
    entity_family?: { buildings: number };
    promotable_entity_families: string[];
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
    stage_status: PublishStageStatus;
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
