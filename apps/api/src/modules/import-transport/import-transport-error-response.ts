import type { FastifyReply } from "fastify";

import { buildApiErrorResponse } from "../../lib/api-error-response.js";
import {
    ImportTransportBatchNotFoundError,
    ImportTransportCandidateNotFoundError,
    ImportTransportInvalidScopeError,
    ImportTransportPromotionBlockedError,
    ImportTransportPromotionWarningConfirmationRequiredError,
    ImportTransportUnknownFamilyError,
    ImportTransportValidationWarningNoteRequiredError,
} from "./import-transport.errors.js";
import {
    ImportTransportPromotionBatchNotFoundError,
    ImportTransportPromotionBatchValidationConflictError,
    ImportTransportPromotionBatchValidationInvalidStatusError,
    ImportTransportPromotionBatchNotValidatedError,
    ImportTransportPromotionBatchPromotionConflictError,
    ImportTransportPromotionBatchPromotionInvalidStatusError,
    ImportTransportPromotionInvalidModeError,
    ImportTransportPromotionNoEligibleCandidatesError,
} from "./import-transport-promotion.errors.js";
import {
    ImportTransportHistoryImportBatchNotFoundError,
    ImportTransportHistoryPromotionBatchNotFoundError,
} from "./import-transport-history.errors.js";
import {
    ImportTransportGtfsExportNotFoundError,
    ImportTransportGtfsSchemaMissingError,
} from "./import-transport-gtfs.errors.js";

export function sendImportTransportValidationError(
    reply: FastifyReply,
    message: string,
    issues?: unknown
): void {
    void reply
        .code(400)
        .send(
            buildApiErrorResponse(
                "VALIDATION_ERROR",
                message,
                issues === undefined ? null : { issues }
            )
        );
}

export function sendImportTransportUnknownFamilyError(
    reply: FastifyReply,
    family: string
): void {
    void reply
        .code(404)
        .send(
            buildApiErrorResponse(
                "UNKNOWN_IMPORT_TRANSPORT_FAMILY",
                `Unknown import-transport entity family: ${family}`,
                { family }
            )
        );
}

export function sendImportTransportError(reply: FastifyReply, error: unknown): boolean {
    if (error instanceof ImportTransportUnknownFamilyError) {
        sendImportTransportUnknownFamilyError(reply, error.family);
        return true;
    }
    if (error instanceof ImportTransportInvalidScopeError) {
        void reply
            .code(error.statusCode)
            .send(buildApiErrorResponse(error.errorCode, error.message, null));
        return true;
    }
    if (error instanceof ImportTransportBatchNotFoundError) {
        void reply
            .code(error.statusCode)
            .send(buildApiErrorResponse(error.errorCode, error.message, null));
        return true;
    }
    if (error instanceof ImportTransportCandidateNotFoundError) {
        void reply
            .code(error.statusCode)
            .send(buildApiErrorResponse(error.errorCode, error.message, null));
        return true;
    }
    if (error instanceof ImportTransportPromotionBlockedError) {
        void reply
            .code(error.statusCode)
            .send(
                buildApiErrorResponse(error.errorCode, error.message, {
                    validation_status: error.validationStatus,
                })
            );
        return true;
    }
    if (error instanceof ImportTransportPromotionWarningConfirmationRequiredError) {
        void reply
            .code(error.statusCode)
            .send(buildApiErrorResponse(error.errorCode, error.message, null));
        return true;
    }
    if (error instanceof ImportTransportValidationWarningNoteRequiredError) {
        void reply
            .code(error.statusCode)
            .send(buildApiErrorResponse(error.errorCode, error.message, null));
        return true;
    }
    if (error instanceof ImportTransportPromotionBatchNotFoundError) {
        void reply
            .code(error.statusCode)
            .send(buildApiErrorResponse(error.errorCode, error.message, null));
        return true;
    }
    if (error instanceof ImportTransportPromotionInvalidModeError) {
        void reply
            .code(error.statusCode)
            .send(buildApiErrorResponse(error.errorCode, error.message, null));
        return true;
    }
    if (error instanceof ImportTransportPromotionNoEligibleCandidatesError) {
        void reply
            .code(error.statusCode)
            .send(buildApiErrorResponse(error.errorCode, error.message, null));
        return true;
    }
    if (error instanceof ImportTransportPromotionBatchValidationConflictError) {
        void reply
            .code(error.statusCode)
            .send(
                buildApiErrorResponse(error.errorCode, error.message, {
                    batch_id: error.batchId,
                })
            );
        return true;
    }
    if (error instanceof ImportTransportPromotionBatchValidationInvalidStatusError) {
        void reply
            .code(error.statusCode)
            .send(
                buildApiErrorResponse(error.errorCode, error.message, {
                    batch_id: error.batchId,
                    status: error.status,
                })
            );
        return true;
    }
    if (error instanceof ImportTransportPromotionBatchNotValidatedError) {
        void reply
            .code(error.statusCode)
            .send(
                buildApiErrorResponse(error.errorCode, error.message, {
                    batch_id: error.batchId,
                })
            );
        return true;
    }
    if (error instanceof ImportTransportPromotionBatchPromotionInvalidStatusError) {
        void reply
            .code(error.statusCode)
            .send(
                buildApiErrorResponse(error.errorCode, error.message, {
                    batch_id: error.batchId,
                    status: error.status,
                })
            );
        return true;
    }
    if (error instanceof ImportTransportPromotionBatchPromotionConflictError) {
        void reply
            .code(error.statusCode)
            .send(
                buildApiErrorResponse(error.errorCode, error.message, {
                    batch_id: error.batchId,
                })
            );
        return true;
    }
    if (error instanceof ImportTransportHistoryImportBatchNotFoundError) {
        void reply
            .code(error.statusCode)
            .send(buildApiErrorResponse(error.errorCode, error.message, { batch_id: error.batchId }));
        return true;
    }
    if (error instanceof ImportTransportHistoryPromotionBatchNotFoundError) {
        void reply
            .code(error.statusCode)
            .send(buildApiErrorResponse(error.errorCode, error.message, { batch_id: error.batchId }));
        return true;
    }
    if (error instanceof ImportTransportGtfsSchemaMissingError) {
        void reply
            .code(error.statusCode)
            .send(buildApiErrorResponse(error.errorCode, error.message, null));
        return true;
    }
    if (error instanceof ImportTransportGtfsExportNotFoundError) {
        void reply
            .code(error.statusCode)
            .send(buildApiErrorResponse(error.errorCode, error.message, { export_id: error.exportId }));
        return true;
    }
    return false;
}
