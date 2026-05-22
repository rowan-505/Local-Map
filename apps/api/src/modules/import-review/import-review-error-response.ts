import type { FastifyReply } from "fastify";

import { buildApiErrorResponse } from "../../lib/api-error-response.js";
import type { ImportReviewBatchChoice } from "./import-review-batch-resolver.js";

export function sendImportReviewApiError(
    reply: FastifyReply,
    statusCode: number,
    errorCode: string,
    message: string,
    details?: unknown
): void {
    void reply.code(statusCode).send(buildApiErrorResponse(errorCode, message, details));
}

export function sendImportReviewValidationError(
    reply: FastifyReply,
    message: string,
    issues?: unknown
): void {
    sendImportReviewApiError(
        reply,
        400,
        "VALIDATION_ERROR",
        message,
        issues === undefined ? null : { issues }
    );
}

export function sendImportReviewNotFoundError(reply: FastifyReply, message: string): void {
    sendImportReviewApiError(reply, 404, "NOT_FOUND", message);
}

export type ImportReviewMultipleBatchesErrorBody = {
    ok: false;
    error: "MULTIPLE_REVIEW_BATCHES";
    message: string;
    source_snapshot_version: string;
    batches: ImportReviewBatchChoice[];
};

export function sendImportReviewMultipleBatchesError(
    reply: FastifyReply,
    sourceSnapshotVersion: string,
    batches: ImportReviewBatchChoice[]
): void {
    const body: ImportReviewMultipleBatchesErrorBody = {
        ok: false,
        error: "MULTIPLE_REVIEW_BATCHES",
        message: "Multiple review batches matched source_snapshot_version",
        source_snapshot_version: sourceSnapshotVersion,
        batches,
    };
    void reply.code(409).send(body);
}

export function logImportReviewServerError(reply: FastifyReply, error: unknown, context: string): void {
    if (error instanceof Error) {
        reply.log.error({ err: error, context }, "Import review error");
        return;
    }
    reply.log.error({ error, context }, "Import review error");
}
