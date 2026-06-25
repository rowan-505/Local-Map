import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { AdminAnalyticsRepository } from "./admin-analytics.repo.js";
import { AdminAnalyticsService } from "./admin-analytics.service.js";
import { AdminUsersRepository } from "./admin-users.repo.js";
import { AdminUsersError, AdminUsersService, type AdminActor } from "./admin-users.service.js";
import {
    assignRoleBodySchema,
    auditQuerySchema,
    growthQuerySchema,
    listUsersQuerySchema,
    updateAdminNoteBodySchema,
    updateStatusBodySchema,
    userPublicIdParamSchema,
    userRoleParamSchema,
} from "./admin-users.schema.js";
import {
    deleteUserRoleSchema,
    getAdminUserSchema,
    getAdminUsersSchema,
    getAnalyticsByReasonSchema,
    getAnalyticsByRegionSchema,
    getAnalyticsByRoleSchema,
    getAnalyticsGrowthSchema,
    getAnalyticsPointsSchema,
    getAnalyticsSavedPlacesSchema,
    getAnalyticsSummarySchema,
    getUserAuditSchema,
    patchUserAdminNoteSchema,
    patchUserStatusSchema,
    postUserRoleSchema,
} from "./admin-users.openapi.js";

function handleError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof AdminUsersError) {
        return reply.code(error.statusCode).send({ message: error.message });
    }
    throw error;
}

function toActor(request: FastifyRequest): AdminActor {
    return {
        publicId: request.user.sub,
        roles: request.user.roles ?? [],
        ipAddress: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
    };
}

const adminUsersRoutes: FastifyPluginAsync = async (app) => {
    const usersService = new AdminUsersService(new AdminUsersRepository(app.prisma));
    const analyticsService = new AdminAnalyticsService(new AdminAnalyticsRepository(app.prisma));
    const requireAdmin = app.requireRole("admin", "super_admin");
    const adminGuard = { preHandler: [app.authenticate, requireAdmin] };

    // --- Analytics (static paths; registered before/around :id is fine — find-my-way prefers static) ---

    app.get(
        "/admin/users/analytics/summary",
        { ...adminGuard, schema: getAnalyticsSummarySchema },
        async (_request, reply) => reply.send(await analyticsService.summary())
    );

    app.get(
        "/admin/users/analytics/growth",
        { ...adminGuard, schema: getAnalyticsGrowthSchema },
        async (request, reply) => {
            const parsed = growthQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid growth query", issues: parsed.error.flatten() });
            }
            return reply.send(await analyticsService.growth(parsed.data.bucket, parsed.data.days));
        }
    );

    app.get(
        "/admin/users/analytics/by-role",
        { ...adminGuard, schema: getAnalyticsByRoleSchema },
        async (_request, reply) => reply.send(await analyticsService.byRole())
    );

    app.get(
        "/admin/users/analytics/by-region",
        { ...adminGuard, schema: getAnalyticsByRegionSchema },
        async (_request, reply) => reply.send(await analyticsService.byRegion())
    );

    app.get(
        "/admin/users/analytics/points",
        { ...adminGuard, schema: getAnalyticsPointsSchema },
        async (_request, reply) => reply.send(await analyticsService.points())
    );

    app.get(
        "/admin/users/analytics/saved-places",
        { ...adminGuard, schema: getAnalyticsSavedPlacesSchema },
        async (_request, reply) => reply.send(await analyticsService.savedPlaces())
    );

    app.get(
        "/admin/users/analytics/points-by-reason",
        { ...adminGuard, schema: getAnalyticsByReasonSchema },
        async (_request, reply) => reply.send(await analyticsService.pointsByReason())
    );

    // --- User management ---

    app.get("/admin/users", { ...adminGuard, schema: getAdminUsersSchema }, async (request, reply) => {
        const parsed = listUsersQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply
                .code(400)
                .send({ message: "Invalid user list query", issues: parsed.error.flatten() });
        }
        return reply.send(await usersService.listUsers(parsed.data));
    });

    app.get(
        "/admin/users/:id",
        { ...adminGuard, schema: getAdminUserSchema },
        async (request, reply) => {
            const params = userPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid user id", issues: params.error.flatten() });
            }
            try {
                return reply.send(await usersService.getUserDetail(params.data.id));
            } catch (error) {
                return handleError(error, reply);
            }
        }
    );

    app.get(
        "/admin/users/:id/audit",
        { ...adminGuard, schema: getUserAuditSchema },
        async (request, reply) => {
            const params = userPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid user id", issues: params.error.flatten() });
            }
            const query = auditQuerySchema.safeParse(request.query);
            if (!query.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid audit query", issues: query.error.flatten() });
            }
            try {
                return reply.send(await usersService.getUserAudit(params.data.id, query.data.limit));
            } catch (error) {
                return handleError(error, reply);
            }
        }
    );

    app.patch(
        "/admin/users/:id/status",
        { ...adminGuard, schema: patchUserStatusSchema },
        async (request, reply) => {
            const params = userPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid user id", issues: params.error.flatten() });
            }
            const body = updateStatusBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid status payload", issues: body.error.flatten() });
            }
            try {
                const detail = await usersService.updateStatus(
                    toActor(request),
                    params.data.id,
                    body.data.accountStatus
                );
                return reply.send(detail);
            } catch (error) {
                return handleError(error, reply);
            }
        }
    );

    app.patch(
        "/admin/users/:id/admin-note",
        { ...adminGuard, schema: patchUserAdminNoteSchema },
        async (request, reply) => {
            const params = userPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid user id", issues: params.error.flatten() });
            }
            const body = updateAdminNoteBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid admin note payload", issues: body.error.flatten() });
            }
            try {
                const detail = await usersService.updateAdminNote(
                    toActor(request),
                    params.data.id,
                    body.data.adminNote
                );
                return reply.send(detail);
            } catch (error) {
                return handleError(error, reply);
            }
        }
    );

    app.post(
        "/admin/users/:id/roles",
        { ...adminGuard, schema: postUserRoleSchema },
        async (request, reply) => {
            const params = userPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid user id", issues: params.error.flatten() });
            }
            const body = assignRoleBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid role payload", issues: body.error.flatten() });
            }
            try {
                const detail = await usersService.assignRole(
                    toActor(request),
                    params.data.id,
                    body.data.roleCode
                );
                return reply.send(detail);
            } catch (error) {
                return handleError(error, reply);
            }
        }
    );

    app.delete(
        "/admin/users/:id/roles/:roleCode",
        { ...adminGuard, schema: deleteUserRoleSchema },
        async (request, reply) => {
            const params = userRoleParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply
                    .code(400)
                    .send({ message: "Invalid role params", issues: params.error.flatten() });
            }
            try {
                const detail = await usersService.removeRole(
                    toActor(request),
                    params.data.id,
                    params.data.roleCode
                );
                return reply.send(detail);
            } catch (error) {
                return handleError(error, reply);
            }
        }
    );
};

export default adminUsersRoutes;
