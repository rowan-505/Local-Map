import type { FastifyReply } from "fastify";

import { buildApiErrorResponse } from "../../lib/api-error-response.js";

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

export function logImportReviewServerError(reply: FastifyReply, error: unknown, context: string): void {
    if (error instanceof Error) {
        reply.log.error({ err: error, context }, "Import review error");
        return;
    }
    reply.log.error({ error, context }, "Import review error");
}
