import type { FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";

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
    importReviewInternalErrorMessage,
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
    ImportReviewAdminAreaPromotionBatchLimitError,
    ImportReviewRoadDryRunRequiredError,
    ImportReviewRoadPromotionBatchLimitError,
    ImportReviewRoadPromotionDisabledError,
    ImportReviewRoutingBarrierDryRunRequiredError,
    ImportReviewRoutingBarrierPromotionBatchLimitError,
    ImportReviewRoutingBarrierPromotionDisabledError,
    ImportReviewPromotionUnknownFamilyError,
    ImportReviewTransportPromotionDeprecatedError,
} from "./import-review-promotion.errors.js";
import {
    ImportReviewPromotionRoadDryRunNoItemsError,
    ImportReviewPromotionRoadDryRunNotFoundError,
} from "./import-review-promotion-road-dry-run.errors.js";
import {
    ImportReviewPromotionRoutingBarrierDryRunNoItemsError,
    ImportReviewPromotionRoutingBarrierDryRunNotFoundError,
} from "./import-review-promotion-routing-barrier-dry-run.errors.js";
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
            {
                errors: error.errors,
                warnings: error.warnings,
                requires_acknowledgement: false,
            }
        );
        return true;
    }

    if (error instanceof ImportReviewRoadOverridesWarningsPendingError) {
        sendImportReviewApiError(
            reply,
            409,
            "ROAD_OVERRIDES_WARNINGS_PENDING",
            "Routing continuity warnings detected — retry with confirm_acknowledge_routing_warnings=true after acknowledging.",
            {
                errors: [],
                warnings: error.warnings,
                requires_acknowledgement: true,
            }
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

    if (error instanceof ImportReviewRoutingBarrierPromotionDisabledError) {
        sendImportReviewApiError(reply, 409, "ROUTING_BARRIER_PROMOTION_DISABLED", error.message, {
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

    if (error instanceof ImportReviewAdminAreaPromotionBatchLimitError) {
        sendImportReviewApiError(reply, 409, "ADMIN_AREA_PROMOTION_BATCH_LIMIT", error.message, {
            batch_id: error.batchId,
            admin_area_item_count: error.adminAreaItemCount,
            max_items: error.maxItems,
        });
        return true;
    }

    if (error instanceof ImportReviewRoutingBarrierPromotionBatchLimitError) {
        sendImportReviewApiError(reply, 409, "ROUTING_BARRIER_PROMOTION_BATCH_LIMIT", error.message, {
            batch_id: error.batchId,
            routing_barrier_item_count: error.routingBarrierItemCount,
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

    if (error instanceof ImportReviewPromotionUnknownFamilyError) {
        sendImportReviewApiError(reply, 400, "PROMOTION_UNKNOWN_ENTITY_FAMILY", error.message, {
            family: error.family,
        });
        return true;
    }

    if (error instanceof ImportReviewTransportPromotionDeprecatedError) {
        sendImportReviewApiError(reply, 409, "TRANSPORT_PROMOTION_DEPRECATED", error.message, {
            entity_families: [...error.entityFamilies],
        });
        return true;
    }

    if (error instanceof ImportReviewRoutingBarrierDryRunRequiredError) {
        sendImportReviewApiError(reply, 409, "ROUTING_BARRIER_DRY_RUN_REQUIRED", error.message, {
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
        error instanceof ImportReviewPromotionRoadDryRunNoItemsError ||
        error instanceof ImportReviewPromotionRoutingBarrierDryRunNotFoundError ||
        error instanceof ImportReviewPromotionRoutingBarrierDryRunNoItemsError
    ) {
        sendImportReviewApiError(reply, error.statusCode, "PROMOTION_DRY_RUN_ERROR", error.message, {
            batch_id: error.batchId,
        });
        return true;
    }

    if (error instanceof Prisma.PrismaClientValidationError) {
        sendImportReviewApiError(
            reply,
            400,
            "VALIDATION_ERROR",
            "Invalid PATCH payload for import-review candidate."
        );
        return true;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        sendImportReviewApiError(
            reply,
            400,
            "VALIDATION_ERROR",
            "Candidate update failed validation constraints.",
            { prisma_code: error.code }
        );
        return true;
    }

    if (error instanceof Error) {
        logImportReviewServerError(reply, error, "sendImportReviewError");
        const message = importReviewInternalErrorMessage(error);
        const details =
            process.env.NODE_ENV !== "production" && error.message.trim() !== message
                ? { technical_message: error.message }
                : process.env.NODE_ENV !== "production"
                  ? { name: error.name }
                  : null;
        sendImportReviewApiError(reply, 500, "INTERNAL_ERROR", message, details);
        return true;
    }

    logImportReviewServerError(reply, error, "sendImportReviewError");
    sendImportReviewApiError(reply, 500, "INTERNAL_ERROR", "An unexpected error occurred");
    return true;
}
