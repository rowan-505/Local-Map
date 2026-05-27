import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

import {
    logImportReviewServerError,
    sendImportReviewApiError,
    sendImportReviewValidationError,
} from "./import-review-error-response.js";
import { sendImportReviewError } from "./import-review-error-handler.js";

function isFastifyValidationError(error: unknown): error is FastifyError & { validation: unknown } {
    return (
        typeof error === "object" &&
        error !== null &&
        "validation" in error &&
        (error as FastifyError).validation !== undefined
    );
}

/** Ensures import-review subtree errors match OpenAPI `importReviewApiErrorResponseSchema` (includes `ok: false`). */
export function registerImportReviewPluginErrorHandler(app: {
    setErrorHandler: (
        handler: (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => void | Promise<void>
    ) => void;
}): void {
    app.setErrorHandler((error, request, reply) => {
        if (reply.sent) {
            return;
        }

        if (isFastifyValidationError(error)) {
            sendImportReviewValidationError(reply, "Invalid request", error.validation);
            return;
        }

        if (sendImportReviewError(reply, error)) {
            return;
        }

        logImportReviewServerError(reply, error, `${request.method} ${request.url}`);
        sendImportReviewApiError(reply, 500, "INTERNAL_ERROR", "An unexpected error occurred");
    });
}
