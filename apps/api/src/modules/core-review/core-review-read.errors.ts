import { Prisma } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";

import { buildApiErrorResponse, type ApiErrorResponseBody } from "../../lib/api-error-response.js";

export const CORE_REVIEW_DB_POOL_TIMEOUT_MESSAGE =
    "Database connection timed out while loading core review data. Wait a moment and refresh.";

export class CoreReviewDbPoolTimeoutError extends Error {
    readonly code = "DB_POOL_TIMEOUT" as const;

    constructor(public readonly cause: unknown) {
        super(CORE_REVIEW_DB_POOL_TIMEOUT_MESSAGE);
        this.name = "CoreReviewDbPoolTimeoutError";
    }
}

export function isPrismaPoolTimeoutError(error: unknown): boolean {
    if (error instanceof CoreReviewDbPoolTimeoutError) {
        return true;
    }

    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2024";
}

/** Re-throws pool timeouts as a typed service error; other errors pass through unchanged. */
export function propagateCoreReviewReadError(error: unknown): never {
    if (isPrismaPoolTimeoutError(error)) {
        if (error instanceof CoreReviewDbPoolTimeoutError) {
            throw error;
        }
        throw new CoreReviewDbPoolTimeoutError(error);
    }

    throw error;
}

export function logCoreReviewReadFailure(
    request: FastifyRequest,
    error: unknown,
    context: string,
    meta?: Record<string, unknown>
): void {
    if (isPrismaPoolTimeoutError(error)) {
        request.log.warn(
            {
                err: error,
                prisma_code: "P2024",
                ...meta,
            },
            context
        );
        return;
    }

    request.log.error(
        {
            err: error,
            ...meta,
        },
        context
    );
}

export type CoreReviewReadErrorReply =
    | { status: 503; body: ApiErrorResponseBody }
    | { status: 500; body: { message: string } };

export function buildCoreReviewReadErrorReply(error: unknown): CoreReviewReadErrorReply {
    if (isPrismaPoolTimeoutError(error)) {
        return {
            status: 503,
            body: buildApiErrorResponse("DB_POOL_TIMEOUT", CORE_REVIEW_DB_POOL_TIMEOUT_MESSAGE, {
                prisma_code: "P2024",
                hint: "Connection pool exhausted or the request waited too long for a database connection.",
            }),
        };
    }

    return {
        status: 500,
        body: { message: "Unable to load core review data." },
    };
}

export function replyCoreReviewReadError(
    request: FastifyRequest,
    reply: FastifyReply,
    error: unknown,
    context: string,
    meta?: Record<string, unknown>
) {
    logCoreReviewReadFailure(request, error, context, meta);
    const mapped = buildCoreReviewReadErrorReply(error);
    return reply.code(mapped.status).send(mapped.body);
}
