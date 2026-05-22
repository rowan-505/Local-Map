import type { FastifyReply } from "fastify";

import {
    ImportReviewBatchAmbiguousError,
    ImportReviewBatchNotFoundError,
    ImportReviewBuildingNotFoundError,
    ImportReviewCandidateNotFoundError,
    ImportReviewDecisionRuleError,
    ImportReviewInvalidScopeError,
    ImportReviewPlaceNotFoundError,
    ImportReviewRoadNotFoundError,
    ImportReviewRoadOverridesValidationFailedError,
    ImportReviewRoadOverridesWarningsPendingError,
} from "./import-review-errors.js";
import {
    logImportReviewServerError,
    sendImportReviewApiError,
    sendImportReviewMultipleBatchesError,
} from "./import-review-error-response.js";
import {
    ImportReviewPublishBatchCreationTimeoutError,
    ImportReviewPublishBatchNameConflictError,
    ImportReviewPublishBatchNotFoundError,
    ImportReviewPublishInvalidStageStatusError,
    ImportReviewPublishBatchInvalidStatusError,
    ImportReviewPublishBatchPromotionConfirmationError,
    ImportReviewPublishBatchPromotionConflictError,
    ImportReviewPublishBatchValidationConflictError,
    ImportReviewPromotionNoEligibleCandidatesError,
    ImportReviewRoadDryRunRequiredError,
    ImportReviewRoadPromotionBatchLimitError,
    ImportReviewRoadPromotionDisabledError,
} from "./import-review-promotion.errors.js";
import {
    ImportReviewPromotionRoadDryRunNoItemsError,
    ImportReviewPromotionRoadDryRunNotFoundError,
} from "./import-review-promotion-road-dry-run.errors.js";
import { ImportReviewMissingPoiCategoriesTableError } from "./import-review-promotion-place-category.js";
import {
    ImportReviewCleanupConfirmationError,
    ImportReviewCleanupDisabledError,
    ImportReviewCleanupNoEligibleRowsError,
    ImportReviewCleanupPublishBatchNotFoundError,
    ImportReviewCleanupReviewBatchNotFoundError,
} from "./import-review-cleanup-promoted.errors.js";
import {
    ImportReviewAddressAdminInferenceBatchNotFoundError,
    ImportReviewAddressAdminInferenceNotReadyError,
} from "./import-review-address-admin-inference.service.js";
import { ImportReviewAddressPromotionDisabledError } from "./import-review-address-promotion.errors.js";
import { ImportReviewHistoryReviewBatchNotFoundError } from "./import-review-history.errors.js";

/** @returns true if `reply` was sent. */
export function sendImportReviewError(reply: FastifyReply, error: unknown): boolean {
    if (error instanceof ImportReviewInvalidScopeError) {
        sendImportReviewApiError(reply, 422, "INVALID_SCOPE", error.message);
        return true;
    }

    if (error instanceof ImportReviewDecisionRuleError) {
        sendImportReviewApiError(reply, 400, "DECISION_RULE_VIOLATION", error.message);
        return true;
    }

    if (
        error instanceof ImportReviewBatchNotFoundError ||
        error instanceof ImportReviewBuildingNotFoundError ||
        error instanceof ImportReviewPlaceNotFoundError ||
        error instanceof ImportReviewRoadNotFoundError ||
        error instanceof ImportReviewCandidateNotFoundError
    ) {
        sendImportReviewApiError(reply, 404, "NOT_FOUND", error.message);
        return true;
    }

    if (error instanceof ImportReviewBatchAmbiguousError) {
        sendImportReviewMultipleBatchesError(reply, error.sourceSnapshotVersion, error.batches);
        return true;
    }

    if (error instanceof ImportReviewRoadOverridesValidationFailedError) {
        sendImportReviewApiError(
            reply,
            400,
            "ROAD_OVERRIDES_VALIDATION_FAILED",
            "Road overrides validation failed",
            { errors: error.errors, warnings: error.warnings }
        );
        return true;
    }

    if (error instanceof ImportReviewRoadOverridesWarningsPendingError) {
        sendImportReviewApiError(
            reply,
            409,
            "ROAD_OVERRIDES_WARNINGS_PENDING",
            "Routing continuity warnings detected — retry with confirm_acknowledge_routing_warnings=true after acknowledging.",
            { warnings: error.warnings, errors: [] }
        );
        return true;
    }

    if (error instanceof ImportReviewPublishBatchNotFoundError) {
        sendImportReviewApiError(reply, 404, "PUBLISH_BATCH_NOT_FOUND", error.message);
        return true;
    }

    if (error instanceof ImportReviewHistoryReviewBatchNotFoundError) {
        sendImportReviewApiError(reply, 404, "REVIEW_BATCH_NOT_FOUND", error.message);
        return true;
    }

    if (error instanceof ImportReviewPublishBatchCreationTimeoutError) {
        sendImportReviewApiError(reply, 504, "PUBLISH_BATCH_CREATION_TIMEOUT", error.message);
        return true;
    }

    if (error instanceof ImportReviewPublishInvalidStageStatusError) {
        sendImportReviewApiError(reply, 500, "PUBLISH_INVALID_STAGE_STATUS", error.message, {
            stage_status: error.stageStatus,
        });
        return true;
    }

    if (error instanceof ImportReviewMissingPoiCategoriesTableError) {
        sendImportReviewApiError(reply, 500, "MISSING_POI_CATEGORIES_TABLE", error.message);
        return true;
    }

    if (error instanceof ImportReviewPublishBatchNameConflictError) {
        sendImportReviewApiError(reply, 409, "PUBLISH_BATCH_NAME_CONFLICT", error.message);
        return true;
    }

    if (error instanceof ImportReviewPromotionNoEligibleCandidatesError) {
        sendImportReviewApiError(reply, 400, "PROMOTION_NO_ELIGIBLE_CANDIDATES", error.message, {
            ready_count: error.readyCount,
            ...(error.byFamily ? { by_family: error.byFamily } : {}),
        });
        return true;
    }

    if (error instanceof ImportReviewPublishBatchValidationConflictError) {
        sendImportReviewApiError(reply, 409, "PUBLISH_BATCH_VALIDATION_CONFLICT", error.message, {
            batch_id: error.batchId,
        });
        return true;
    }

    if (error instanceof ImportReviewPublishBatchPromotionConflictError) {
        sendImportReviewApiError(reply, 409, "PUBLISH_BATCH_PROMOTION_CONFLICT", error.message, {
            batch_id: error.batchId,
        });
        return true;
    }

    if (error instanceof ImportReviewRoadPromotionDisabledError) {
        sendImportReviewApiError(reply, 409, "ROAD_PROMOTION_DISABLED", error.message, {
            batch_id: error.batchId,
        });
        return true;
    }

    if (error instanceof ImportReviewRoadPromotionBatchLimitError) {
        sendImportReviewApiError(reply, 409, "ROAD_PROMOTION_BATCH_LIMIT", error.message, {
            batch_id: error.batchId,
            road_item_count: error.roadItemCount,
            max_items: error.maxItems,
        });
        return true;
    }

    if (error instanceof ImportReviewRoadDryRunRequiredError) {
        sendImportReviewApiError(reply, 409, "ROAD_DRY_RUN_REQUIRED", error.message, {
            batch_id: error.batchId,
        });
        return true;
    }

    if (error instanceof ImportReviewPublishBatchPromotionConfirmationError) {
        sendImportReviewApiError(reply, 400, "PUBLISH_BATCH_PROMOTION_CONFIRMATION", error.message, {
            batch_id: error.batchId,
        });
        return true;
    }

    if (error instanceof ImportReviewPublishBatchInvalidStatusError) {
        sendImportReviewApiError(reply, 400, "PUBLISH_BATCH_INVALID_STATUS", error.message, {
            batch_id: error.batchId,
            status: error.status,
        });
        return true;
    }

    if (error instanceof ImportReviewCleanupDisabledError) {
        sendImportReviewApiError(reply, 403, "CLEANUP_DISABLED", error.message);
        return true;
    }

    if (
        error instanceof ImportReviewCleanupConfirmationError ||
        error instanceof ImportReviewCleanupNoEligibleRowsError
    ) {
        sendImportReviewApiError(reply, 400, "CLEANUP_REQUEST_INVALID", error.message);
        return true;
    }

    if (
        error instanceof ImportReviewCleanupReviewBatchNotFoundError ||
        error instanceof ImportReviewCleanupPublishBatchNotFoundError ||
        error instanceof ImportReviewAddressAdminInferenceBatchNotFoundError
    ) {
        sendImportReviewApiError(reply, 404, "NOT_FOUND", error.message);
        return true;
    }

    if (error instanceof ImportReviewAddressAdminInferenceNotReadyError) {
        sendImportReviewApiError(reply, 503, "ADDRESS_ADMIN_INFERENCE_NOT_READY", error.message);
        return true;
    }

    if (error instanceof ImportReviewAddressPromotionDisabledError) {
        sendImportReviewApiError(reply, 403, "ADDRESS_PROMOTION_DISABLED", error.message);
        return true;
    }

    if (
        error instanceof ImportReviewPromotionRoadDryRunNotFoundError ||
        error instanceof ImportReviewPromotionRoadDryRunNoItemsError
    ) {
        sendImportReviewApiError(reply, error.statusCode, "ROAD_DRY_RUN_ERROR", error.message, {
            batch_id: error.batchId,
        });
        return true;
    }

    if (error instanceof Error) {
        logImportReviewServerError(reply, error, "sendImportReviewError");
        sendImportReviewApiError(reply, 500, "INTERNAL_ERROR", error.message);
        return true;
    }

    logImportReviewServerError(reply, error, "sendImportReviewError");
    sendImportReviewApiError(reply, 500, "INTERNAL_ERROR", "An unexpected error occurred");
    return true;
}
