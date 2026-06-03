export class ImportReviewPublishBatchNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(public readonly batchId: string) {
        super(`Publish batch not found: ${batchId}`);
        this.name = "ImportReviewPublishBatchNotFoundError";
    }
}

export class ImportReviewPublishBatchRetryNotAvailableError extends Error {
    readonly statusCode = 400;
    readonly code = "PROMOTION_RETRY_NOT_AVAILABLE";

    constructor(
        public readonly batchId: string,
        messageDetail: string
    ) {
        super(messageDetail);
        this.name = "ImportReviewPublishBatchRetryNotAvailableError";
    }
}

export class ImportReviewPublishBatchNameConflictError extends Error {
    readonly statusCode = 409;

    constructor(public readonly batchName: string) {
        super(`Publish batch name already exists: ${batchName}`);
        this.name = "ImportReviewPublishBatchNameConflictError";
    }
}

export type ImportReviewPromotionSkippedReasonCount = {
    reason: string;
    count: number;
};

export type ImportReviewPromotionFamilySkipSummary = {
    entity_family: string;
    included: number;
    skipped_reasons: ImportReviewPromotionSkippedReasonCount[];
};

export type ImportReviewPromotionBatchLimitsViolation = {
    code: string;
    message: string;
    required_flag?: string;
};

export class ImportReviewPromotionBatchLimitsError extends Error {
    readonly statusCode = 400;
    readonly code = "PROMOTION_BATCH_LIMITS";

    constructor(
        public readonly details: {
            context: "create" | "validate";
            totalItems: number;
            maxItems: number;
            families: string[];
            highRiskFamilies: readonly string[];
            normalFamilies: readonly string[];
            violations: ImportReviewPromotionBatchLimitsViolation[];
        }
    ) {
        const summary = details.violations.map((v) => v.message).join(" ");
        super(summary);
        this.name = "ImportReviewPromotionBatchLimitsError";
    }
}

export class ImportReviewPromotionNoEligibleCandidatesError extends Error {
    readonly statusCode = 400;

    constructor(
        public readonly readyCount: number,
        public readonly messageDetail: string,
        public readonly byFamily?: ImportReviewPromotionFamilySkipSummary[]
    ) {
        super(messageDetail);
        this.name = "ImportReviewPromotionNoEligibleCandidatesError";
    }
}

export type ImportReviewPromotionSelectedCandidateReason =
    | "wrong_review_batch"
    | "wrong_family"
    | "not_found"
    | "already_promoted"
    | "not_approved"
    | "review_status_not_ready"
    | "validation_blocked"
    | "missing_required_field"
    | "already_in_active_publish_batch"
    | "manual_protected"
    | "duplicate_needs_review_note"
    | "promotion_status_not_ready"
    | "not_eligible";

export type ImportReviewPromotionSelectedCandidateErrorDetails = {
    review_status?: string | null;
    review_decision?: string | null;
    promoted_core_id?: string | null;
    promoted_at?: string | null;
    target_table?: string | null;
    validation_errors?: unknown;
    missing_fields?: string[];
    active_publish_batch_id?: string | null;
    actual_family?: string;
    expected_family?: string;
    expected_review_batch_id?: string;
    actual_review_batch_id?: string;
};

export class ImportReviewPromotionSelectedCandidateError extends Error {
    readonly statusCode = 400;
    readonly code = "PROMOTION_SELECTED_CANDIDATE";

    constructor(
        public readonly reason: ImportReviewPromotionSelectedCandidateReason,
        public readonly messageDetail: string,
        public readonly family: string,
        public readonly candidateId: bigint,
        public readonly details: ImportReviewPromotionSelectedCandidateErrorDetails = {}
    ) {
        super(messageDetail);
        this.name = "ImportReviewPromotionSelectedCandidateError";
    }
}

export class ImportReviewPublishBatchValidationConflictError extends Error {
    readonly statusCode = 409;

    constructor(
        public readonly batchId: string,
        public readonly messageDetail: string
    ) {
        super(messageDetail);
        this.name = "ImportReviewPublishBatchValidationConflictError";
    }
}

export class ImportReviewPublishBatchValidationNotRunningError extends Error {
    readonly statusCode = 409;

    constructor(
        public readonly batchId: string,
        public readonly status: string,
        public readonly messageDetail: string
    ) {
        super(messageDetail);
        this.name = "ImportReviewPublishBatchValidationNotRunningError";
    }
}

export class ImportReviewPublishBatchValidationResetError extends Error {
    readonly statusCode = 400;

    constructor(
        public readonly batchId: string,
        public readonly messageDetail: string
    ) {
        super(messageDetail);
        this.name = "ImportReviewPublishBatchValidationResetError";
    }
}

export class ImportReviewPublishBatchInvalidStatusError extends Error {
    readonly statusCode = 400;

    constructor(
        public readonly batchId: string,
        public readonly status: string,
        public readonly messageDetail: string
    ) {
        super(messageDetail);
        this.name = "ImportReviewPublishBatchInvalidStatusError";
    }
}

export class ImportReviewPublishBatchPromotionConflictError extends Error {
    readonly statusCode = 409;

    constructor(
        public readonly batchId: string,
        public readonly messageDetail: string
    ) {
        super(messageDetail);
        this.name = "ImportReviewPublishBatchPromotionConflictError";
    }
}

export class ImportReviewPublishBatchPromotionConfirmationError extends Error {
    readonly statusCode = 400;

    constructor(
        public readonly batchId: string,
        public readonly messageDetail: string
    ) {
        super(messageDetail);
        this.name = "ImportReviewPublishBatchPromotionConfirmationError";
    }
}

export class ImportReviewPublishBatchCreationTimeoutError extends Error {
    readonly statusCode = 504;

    constructor() {
        super(
            "Publish batch creation timed out. Try fewer entity families or smaller chunk size."
        );
        this.name = "ImportReviewPublishBatchCreationTimeoutError";
    }
}

export class ImportReviewPublishInvalidStageStatusError extends Error {
    readonly statusCode = 500;

    constructor(public readonly stageStatus: string) {
        super(
            `Invalid publish stage_status "${stageStatus}". Allowed values: pending, running, success, warning, failed, skipped.`
        );
        this.name = "ImportReviewPublishInvalidStageStatusError";
    }
}

export class ImportReviewRoadPromotionDisabledError extends Error {
    readonly statusCode = 409;

    constructor(public readonly batchId: string) {
        super(
            "Road promotion is disabled. Set ENABLE_IMPORT_REVIEW_ROAD_PROMOTION=true, run road dry-run, and complete routing validation first."
        );
        this.name = "ImportReviewRoadPromotionDisabledError";
    }
}

export class ImportReviewRoadPromotionBatchLimitError extends Error {
    readonly statusCode = 409;

    constructor(
        public readonly batchId: string,
        public readonly roadItemCount: number,
        public readonly maxItems: number
    ) {
        super(
            `Road promotion batch limit exceeded (${roadItemCount} road items; max ${maxItems} without ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION=true).`
        );
        this.name = "ImportReviewRoadPromotionBatchLimitError";
    }
}

export class ImportReviewAdminAreaPromotionBatchLimitError extends Error {
    readonly statusCode = 409;

    constructor(
        public readonly batchId: string,
        public readonly adminAreaItemCount: number,
        public readonly maxItems: number
    ) {
        super(
            `Admin area promotion batch limit exceeded (${adminAreaItemCount} admin area items; max ${maxItems} without ENABLE_IMPORT_REVIEW_ADMIN_AREA_BULK_PROMOTION=true).`
        );
        this.name = "ImportReviewAdminAreaPromotionBatchLimitError";
    }
}

export class ImportReviewRoutingBarrierPromotionDisabledError extends Error {
    readonly statusCode = 409;

    constructor(public readonly batchId: string) {
        super(
            "Routing barrier promotion is disabled. Set ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION=true and run routing-barrier dry-run first."
        );
        this.name = "ImportReviewRoutingBarrierPromotionDisabledError";
    }
}

export class ImportReviewRoutingBarrierPromotionBatchLimitError extends Error {
    readonly statusCode = 409;

    constructor(
        public readonly batchId: string,
        public readonly routingBarrierItemCount: number,
        public readonly maxItems: number
    ) {
        super(
            `Routing barrier promotion batch limit exceeded (${routingBarrierItemCount} routing barrier items; max ${maxItems} without ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_BULK_PROMOTION=true).`
        );
        this.name = "ImportReviewRoutingBarrierPromotionBatchLimitError";
    }
}

export class ImportReviewRoutingBarrierDryRunRequiredError extends Error {
    readonly statusCode = 409;

    constructor(public readonly batchId: string) {
        super("Routing barrier dry-run is required before promoting routing barrier publish items.");
        this.name = "ImportReviewRoutingBarrierDryRunRequiredError";
    }
}

export class ImportReviewRoadDryRunRequiredError extends Error {
    readonly statusCode = 409;

    constructor(public readonly batchId: string) {
        super("Road dry-run is required before promoting road publish items.");
        this.name = "ImportReviewRoadDryRunRequiredError";
    }
}

export class ImportReviewPromotionUnknownFamilyError extends Error {
    readonly statusCode = 400;

    constructor(public readonly family: string) {
        super(`Unknown import review promotion entity family: ${family}`);
        this.name = "ImportReviewPromotionUnknownFamilyError";
    }
}

export const TRANSPORT_PROMOTION_DEPRECATED_MESSAGE =
    "Transport promotion moved to Import Transport.";

export class ImportReviewTransportPromotionDeprecatedError extends Error {
    readonly statusCode = 409;

    constructor(public readonly entityFamilies: readonly string[]) {
        super(TRANSPORT_PROMOTION_DEPRECATED_MESSAGE);
        this.name = "ImportReviewTransportPromotionDeprecatedError";
    }
}
