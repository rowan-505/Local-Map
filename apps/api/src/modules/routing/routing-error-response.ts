import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

import { buildApiErrorResponse } from "../../lib/api-error-response.js";
import { RoutingServiceDisabledError } from "../../config/env.js";
import {
    RoutingEngineNotImplementedError,
    RoutingEngineUpstreamError,
    RoutingRouteRequestError,
} from "./routing.errors.js";

export function sendRoutingError(reply: FastifyReply, error: unknown): FastifyReply | void {
    if (error instanceof ZodError) {
        return reply.code(400).send({
            message: "Invalid routing request",
            code: "ROUTING_VALIDATION_ERROR",
            issues: error.flatten(),
        });
    }

    if (error instanceof RoutingServiceDisabledError) {
        return reply
            .code(error.statusCode)
            .send(
                buildApiErrorResponse("ROUTING_DISABLED", error.message, {
                    hint: "Set ROUTING_ENABLED=true to enable directions.",
                })
            );
    }

    if (error instanceof RoutingRouteRequestError) {
        return reply.code(400).send({
            message: error.message,
            code: error.code,
            details: error.details ?? null,
        });
    }

    if (error instanceof RoutingEngineNotImplementedError) {
        return reply.code(error.statusCode).send({
            message: error.message,
            code: "ROUTING_ENGINE_NOT_IMPLEMENTED",
            engine: error.engine,
        });
    }

    if (error instanceof RoutingEngineUpstreamError) {
        return reply.code(error.statusCode).send({
            message: error.message,
            code: error.code,
            engine: error.engine,
            upstreamStatus: error.upstreamStatus ?? null,
        });
    }

    return undefined;
}
