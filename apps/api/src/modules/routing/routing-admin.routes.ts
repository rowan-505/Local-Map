import type { FastifyPluginAsync } from "fastify";
import { ZodError } from "zod";

import {
    RoutingAdminBuildNotFoundError,
    RoutingAdminFeedbackNotFoundError,
    RoutingAdminSchemaUnavailableError,
} from "./routing-admin.errors.js";
import {
    getAdminRoutingBuildByIdSchema,
    getAdminRoutingBuildsSchema,
    getAdminRoutingFeedbackSchema,
    getAdminRoutingHealthSchema,
    getAdminRoutingValidationReportsSchema,
    patchAdminRoutingFeedbackStatusSchema,
} from "./routing-admin.openapi.js";
import {
    listRoutingBuildsQuerySchema,
    listRoutingFeedbackQuerySchema,
    listRoutingValidationReportsQuerySchema,
    patchRoutingFeedbackStatusBodySchema,
    routingBuildIdParamSchema,
    routingFeedbackIdParamSchema,
} from "./routing-admin.schema.js";
import { RoutingAdminService } from "./routing-admin.service.js";

const ADMIN_ROLES = new Set(["admin"]);

function requireAdminRole(roles: string[] | undefined): boolean {
    return (roles ?? []).some((role) => ADMIN_ROLES.has(role));
}

function sendAdminRoutingError(reply: import("fastify").FastifyReply, error: unknown) {
    if (error instanceof ZodError) {
        return reply.code(400).send({
            message: "Invalid request",
            code: "ROUTING_ADMIN_VALIDATION_ERROR",
            issues: error.flatten(),
        });
    }
    if (error instanceof RoutingAdminSchemaUnavailableError) {
        return reply.code(503).send({
            message: error.message,
            code: "ROUTING_SCHEMA_UNAVAILABLE",
        });
    }
    if (error instanceof RoutingAdminBuildNotFoundError) {
        return reply.code(404).send({ message: error.message, code: "ROUTING_BUILD_NOT_FOUND" });
    }
    if (error instanceof RoutingAdminFeedbackNotFoundError) {
        return reply.code(404).send({ message: error.message, code: "ROUTING_FEEDBACK_NOT_FOUND" });
    }
    return undefined;
}

const routingAdminRoutes: FastifyPluginAsync = async (app) => {
    const service = new RoutingAdminService(app.prisma);

    app.addHook("onRequest", async (request, reply) => {
        await app.authenticate(request, reply);
        if (reply.sent) {
            return;
        }
        if (!requireAdminRole(request.user?.roles)) {
            return reply.code(403).send({ message: "Routing admin endpoints require admin role." });
        }
    });

    app.get("/builds", { schema: getAdminRoutingBuildsSchema }, async (request, reply) => {
        try {
            const query = listRoutingBuildsQuerySchema.parse(request.query);
            const result = await service.listBuilds(query);
            return reply.send(result);
        } catch (error) {
            const handled = sendAdminRoutingError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.get("/builds/:id", { schema: getAdminRoutingBuildByIdSchema }, async (request, reply) => {
        try {
            const params = routingBuildIdParamSchema.parse(request.params);
            const result = await service.getBuild(params.id);
            return reply.send(result);
        } catch (error) {
            const handled = sendAdminRoutingError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.get("/health", { schema: getAdminRoutingHealthSchema }, async (_request, reply) => {
        try {
            const result = await service.getAdminHealth();
            return reply.send(result);
        } catch (error) {
            const handled = sendAdminRoutingError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.get("/feedback", { schema: getAdminRoutingFeedbackSchema }, async (request, reply) => {
        try {
            const query = listRoutingFeedbackQuerySchema.parse(request.query);
            const result = await service.listFeedback(query);
            return reply.send(result);
        } catch (error) {
            const handled = sendAdminRoutingError(reply, error);
            if (handled) return handled;
            throw error;
        }
    });

    app.patch(
        "/feedback/:id/status",
        { schema: patchAdminRoutingFeedbackStatusSchema },
        async (request, reply) => {
            try {
                const params = routingFeedbackIdParamSchema.parse(request.params);
                const body = patchRoutingFeedbackStatusBodySchema.parse(request.body);
                const result = await service.updateFeedbackStatus(params.id, body);
                return reply.send(result);
            } catch (error) {
                const handled = sendAdminRoutingError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );

    app.get(
        "/validation-reports",
        { schema: getAdminRoutingValidationReportsSchema },
        async (request, reply) => {
            try {
                const query = listRoutingValidationReportsQuerySchema.parse(request.query);
                const result = await service.listValidationReports(query);
                return reply.send(result);
            } catch (error) {
                const handled = sendAdminRoutingError(reply, error);
                if (handled) return handled;
                throw error;
            }
        }
    );
};

export default routingAdminRoutes;
