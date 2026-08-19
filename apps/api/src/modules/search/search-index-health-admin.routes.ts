import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { getSearchIndexHealthReport } from "./search-index-health.js";
import { queryBooleanSchema } from "./query-boolean.schema.js";
import {
    getSearchIndexHealthSchema,
    postSearchIndexHealthCheckSchema,
    postSearchIndexReindexEntitySchema,
    postSearchIndexReindexFamilySchema,
    postSearchIndexRepairSchema,
} from "./search-index-health-admin.openapi.js";
import {
    SearchIndexMaintenanceError,
    SearchIndexMaintenanceService,
    type SearchIndexMaintenanceActor,
} from "./search-index-maintenance.service.js";
import {
    reindexSearchEntityBodySchema,
    reindexSearchFamilyBodySchema,
} from "./search-index-maintenance.schema.js";

function handleError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof SearchIndexMaintenanceError) {
        return reply.code(error.statusCode).send({ message: error.message });
    }
    throw error;
}

function toActor(request: FastifyRequest): SearchIndexMaintenanceActor {
    return {
        publicId: request.user.sub,
        ipAddress: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
    };
}

function maintenanceLog(request: FastifyRequest) {
    return {
        info: (obj: Record<string, unknown>, msg: string) => request.log.info(obj, msg),
        warn: (obj: Record<string, unknown>, msg: string) => request.log.warn(obj, msg),
        error: (obj: Record<string, unknown>, msg: string) => request.log.error(obj, msg),
    };
}

const searchIndexHealthAdminRoutes: FastifyPluginAsync = async (app) => {
    const service = new SearchIndexMaintenanceService(app.prisma);
    const requireSuperAdmin = app.requireRole("super_admin");
    const readGuard = { preHandler: [app.authenticate, app.requireDashboardAccess] };
    const writeGuard = { preHandler: [app.authenticate, app.requireDashboardWrite] };
    const superAdminGuard = { preHandler: [app.authenticate, requireSuperAdmin] };

    app.get(
        "/admin/search/index-health",
        { ...readGuard, schema: getSearchIndexHealthSchema },
        async (request, reply) => {
            const parsed = z.object({ refresh: queryBooleanSchema.optional() }).safeParse(request.query);
            const refresh = parsed.success ? parsed.data.refresh === true : false;
            return reply.send(await getSearchIndexHealthReport(app.prisma, { refresh }));
        },
    );

    app.post(
        "/admin/search/index-health/check",
        { ...writeGuard, schema: postSearchIndexHealthCheckSchema },
        async (request, reply) => {
            try {
                return reply.send(await service.runHealthCheck(toActor(request)));
            } catch (error) {
                return handleError(error, reply);
            }
        },
    );

    app.post(
        "/admin/search/index-health/reindex-family",
        { ...superAdminGuard, schema: postSearchIndexReindexFamilySchema },
        async (request, reply) => {
            const parsed = reindexSearchFamilyBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid reindex family payload",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                const result = await service.reindexFamily(
                    toActor(request),
                    parsed.data,
                    maintenanceLog(request),
                );
                if (result.status === "conflict") {
                    return reply.code(409).send({ message: result.message ?? "Rebuild already in progress." });
                }
                return reply.send(result);
            } catch (error) {
                return handleError(error, reply);
            }
        },
    );

    app.post(
        "/admin/search/index-health/repair",
        { ...superAdminGuard, schema: postSearchIndexRepairSchema },
        async (request, reply) => {
            try {
                const result = await service.repairUnhealthyFamilies(
                    toActor(request),
                    maintenanceLog(request),
                );
                if (result.status === "conflict") {
                    return reply.code(409).send({ message: result.message ?? "Rebuild already in progress." });
                }
                return reply.send(result);
            } catch (error) {
                return handleError(error, reply);
            }
        },
    );

    app.post(
        "/admin/search/index-health/reindex-entity",
        { ...superAdminGuard, schema: postSearchIndexReindexEntitySchema },
        async (request, reply) => {
            const parsed = reindexSearchEntityBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid reindex entity payload",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await service.reindexEntity(
                        toActor(request),
                        parsed.data,
                        maintenanceLog(request),
                    ),
                );
            } catch (error) {
                return handleError(error, reply);
            }
        },
    );
};

export default searchIndexHealthAdminRoutes;
