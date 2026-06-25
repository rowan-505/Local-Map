import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { PointsRepository } from "./points.repo.js";
import { PointsError, PointsService } from "./points.service.js";
import {
    adminLedgerQuerySchema,
    adminPointBodySchema,
    pointHistoryQuerySchema,
    topPointUsersQuerySchema,
    userPublicIdParamSchema,
} from "./points.schema.js";
import {
    getAdminPointsLedgerSchema,
    getMyPointHistorySchema,
    getMyPointsSchema,
    getTopPointUsersSchema,
    getUserPointsSchema,
    postUserPointsSchema,
} from "./points.openapi.js";

function handlePointsError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof PointsError) {
        return reply.code(error.statusCode).send({ message: error.message });
    }

    throw error;
}

function auditContext(request: FastifyRequest) {
    return {
        ipAddress: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
    };
}

const pointsRoutes: FastifyPluginAsync = async (app) => {
    const pointsRepo = new PointsRepository(app.prisma);
    const pointsService = new PointsService(pointsRepo);
    const requireAdmin = app.requireRole("admin", "super_admin");

    app.get(
        "/me/points",
        {
            preHandler: app.authenticate,
            schema: getMyPointsSchema,
        },
        async (request, reply) => {
            try {
                const summary = await pointsService.getMySummary(request.user.sub);
                return reply.send(summary);
            } catch (error) {
                return handlePointsError(error, reply);
            }
        }
    );

    app.get(
        "/me/point-history",
        {
            preHandler: app.authenticate,
            schema: getMyPointHistorySchema,
        },
        async (request, reply) => {
            const parsed = pointHistoryQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid point history query",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const history = await pointsService.getMyHistory(request.user.sub, parsed.data.limit);
                return reply.send(history);
            } catch (error) {
                return handlePointsError(error, reply);
            }
        }
    );

    app.get(
        "/admin/points/ledger",
        {
            preHandler: [app.authenticate, requireAdmin],
            schema: getAdminPointsLedgerSchema,
        },
        async (request, reply) => {
            const query = adminLedgerQuerySchema.safeParse(request.query);
            if (!query.success) {
                return reply.code(400).send({
                    message: "Invalid ledger query",
                    issues: query.error.flatten(),
                });
            }

            try {
                const result = await pointsService.listRecentLedger(query.data);
                return reply.send(result);
            } catch (error) {
                return handlePointsError(error, reply);
            }
        }
    );

    app.get(
        "/admin/points/top-users",
        {
            preHandler: [app.authenticate, requireAdmin],
            schema: getTopPointUsersSchema,
        },
        async (request, reply) => {
            const query = topPointUsersQuerySchema.safeParse(request.query);
            if (!query.success) {
                return reply.code(400).send({
                    message: "Invalid top users query",
                    issues: query.error.flatten(),
                });
            }

            try {
                const result = await pointsService.getTopUsers(query.data.limit);
                return reply.send(result);
            } catch (error) {
                return handlePointsError(error, reply);
            }
        }
    );

    app.get(
        "/admin/users/:id/points",
        {
            preHandler: [app.authenticate, requireAdmin],
            schema: getUserPointsSchema,
        },
        async (request, reply) => {
            const params = userPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid user id",
                    issues: params.error.flatten(),
                });
            }

            const query = pointHistoryQuerySchema.safeParse(request.query);
            if (!query.success) {
                return reply.code(400).send({
                    message: "Invalid point history query",
                    issues: query.error.flatten(),
                });
            }

            try {
                const result = await pointsService.getUserPoints(params.data.id, query.data.limit);
                return reply.send(result);
            } catch (error) {
                return handlePointsError(error, reply);
            }
        }
    );

    app.post(
        "/admin/users/:id/points",
        {
            preHandler: [app.authenticate, requireAdmin],
            schema: postUserPointsSchema,
        },
        async (request, reply) => {
            const params = userPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid user id",
                    issues: params.error.flatten(),
                });
            }

            const body = adminPointBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid point adjustment payload",
                    issues: body.error.flatten(),
                });
            }

            try {
                const result = await pointsService.adjustUserPoints(
                    params.data.id,
                    {
                        pointsDelta: body.data.pointsDelta,
                        reasonCode: body.data.reasonCode,
                        note: body.data.note,
                        relatedEntityType: body.data.relatedEntityType,
                        relatedEntityId: body.data.relatedEntityId,
                    },
                    {
                        adminPublicId: request.user.sub,
                        ...auditContext(request),
                    }
                );
                return reply.code(201).send(result);
            } catch (error) {
                return handlePointsError(error, reply);
            }
        }
    );
};

export default pointsRoutes;
