import type { PublishStageStatus } from "./import-review-promotion-stage-status.js";
import {
    IMPORT_REVIEW_LEGACY_PUBLISH_ITEM_VALIDATION_STAGES,
    IMPORT_REVIEW_SIMPLE_PUBLISH_VALIDATION_STAGES,
    type ImportReviewLegacyPublishItemValidationStageKey,
} from "./import-review-promotion-validation-stages.js";

/** Stages seeded and run by the simple validation runner. */
export const IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES = IMPORT_REVIEW_SIMPLE_PUBLISH_VALIDATION_STAGES;

/** @deprecated Alias for legacy rules engine sub-stages (not seeded in simple mode). */
export const IMPORT_REVIEW_PUBLISH_ITEM_VALIDATION_STAGES =
    IMPORT_REVIEW_LEGACY_PUBLISH_ITEM_VALIDATION_STAGES;

export type ImportReviewPublishValidationStageKey =
    (typeof IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES)[number]["key"];

export type ImportReviewPublishItemValidationStageKey = ImportReviewLegacyPublishItemValidationStageKey;

export type ImportReviewValidationSeverity = "error" | "warning" | "info";

export type ImportReviewValidationIssue = {
    code: string;
    message: string;
    severity: ImportReviewValidationSeverity;
    stage_key?: ImportReviewPublishValidationStageKey;
    entity_family?: string;
};

export type ImportReviewPublishItemValidationStatus =
    | "ready"
    | "valid"
    | "warning"
    | "blocked"
    | "skipped";

export type ImportReviewPublishBatchEntityValidationCounts = {
    total: number;
    /** Contract status ready (legacy summaries used valid). */
    ready: number;
    /** @deprecated Prefer ready — kept for backward-compatible dashboards. */
    valid: number;
    warning: number;
    blocked: number;
    skipped: number;
};

export type ImportReviewPublishBatchValidationResult = {
    outcome: "passed" | "partial" | "blocked";
    can_promote: boolean;
    requires_warning_confirmation: boolean;
    ready_count: number;
    /** @deprecated Prefer ready_count */
    valid_count: number;
    warning_count: number;
    blocked_count: number;
    skipped_count: number;
    /** Promotable pending items (ready + warning). */
    promotable_count: number;
    total_count: number;
    /** @deprecated Prefer total_count */
    total_items: number;
    by_publish_action: { insert: number; update: number; merge: number };
    by_entity: Record<string, ImportReviewPublishBatchEntityValidationCounts>;
    /** Families present in this publish batch (from items at validation time). */
    selected_entity_families?: string[];
    /** @deprecated Use selected_entity_families / by_entity */
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
    validation_heartbeat_at: Date | null;
    validation_cancel_requested_at: Date | null;
    promoted_at: Date | null;
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
    entity_family?: string;
};
