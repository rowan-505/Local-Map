import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { DEV_AUTH_BYPASS_USER, isAuthBypassActive, type JwtUser } from "../../plugins/auth.js";
import { MediaRepository } from "../media/media.repo.js";
import { ReportsRepository, type AuditContext } from "./reports.repo.js";
import { ReportsError, ReportsService, type ReportViewer } from "./reports.service.js";
import {
    adminNoteBodySchema,
    adminReportIdParamSchema,
    adminReportsQuerySchema,
    adminRequestInfoBodySchema,
    adminStatusBodySchema,
    followupBodySchema,
    myReportsQuerySchema,
    reportCreateBodySchema,
    reportPublicIdParamSchema,
    rewardPointsBodySchema,
} from "./reports.schema.js";
import {
    getAdminReportSchema,
    getAdminReportsSchema,
    getMyReportsSchema,
    getReportAnalyticsAnonymousSchema,
    getReportAnalyticsByRegionSchema,
    getReportAnalyticsByStatusSchema,
    getReportAnalyticsByTypeSchema,
    getReportAnalyticsSummarySchema,
    getReportSchema,
    patchAdminReportNoteSchema,
    patchAdminReportStatusSchema,
    postAdminRequestInfoSchema,
    postAdminRewardPointsSchema,
    postFollowupSchema,
    postReportSchema,
} from "./reports.openapi.js";

function handleReportsError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof ReportsError) {
        return reply.code(error.statusCode).send({ message: error.message });
    }
    throw error;
}

function auditContext(request: FastifyRequest, actorUserId: bigint | null = null): AuditContext {
    return {
        actorUserId,
        ipAddress: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
    };
}

function anonymousIdHeader(request: FastifyRequest): string | null {
    const raw = request.headers["x-anonymous-id"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value?.trim() || null;
}

/** Resolves the caller's JWT identity without rejecting unauthenticated requests. */
async function optionalJwtUser(request: FastifyRequest): Promise<JwtUser | null> {
    if (isAuthBypassActive()) {
        return { ...DEV_AUTH_BYPASS_USER };
    }
    if (!request.headers.authorization) {
        return null;
    }
    try {
        await request.jwtVerify();
        return request.user;
    } catch {
        return null;
    }
}

const reportsRoutes: FastifyPluginAsync = async (app) => {
    const reportsService = new ReportsService(new ReportsRepository(app.prisma), new MediaRepository(app.prisma));
    const requireAdmin = app.requireRole("admin", "super_admin");
    const adminGuard = { preHandler: [app.authenticate, requireAdmin] };

    /** Resolves the admin's internal user id (nullable under dev bypass) for audit linkage. */
    async function adminAudit(request: FastifyRequest): Promise<AuditContext> {
        const repo = new ReportsRepository(app.prisma);
        const actorUserId = await repo.findActiveUserIdByPublicId(request.user.sub);
        return auditContext(request, actorUserId);
    }

    // --- Public / user ---

    app.post("/reports", { schema: postReportSchema }, async (request, reply) => {
        const parsed = reportCreateBodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ message: "Invalid report payload", issues: parsed.error.flatten() });
        }
        const jwtUser = await optionalJwtUser(request);
        const viewer: ReportViewer = {
            jwtSub: jwtUser?.sub ?? null,
            roles: jwtUser?.roles ?? [],
            anonymousId: anonymousIdHeader(request),
        };
        try {
            const result = await reportsService.create(viewer, parsed.data, auditContext(request));
            return reply.code(result.created ? 201 : 200).send({
                ...result.report,
                duplicate_warning: !result.created,
                message: result.message,
            });
        } catch (error) {
            return handleReportsError(error, reply);
        }
    });

    app.get(
        "/me/reports",
        { preHandler: app.authenticate, schema: getMyReportsSchema },
        async (request, reply) => {
            const query = myReportsQuerySchema.safeParse(request.query);
            if (!query.success) {
                return reply.code(400).send({ message: "Invalid query", issues: query.error.flatten() });
            }
            try {
                return reply.send(await reportsService.listMine(request.user.sub, query.data.limit));
            } catch (error) {
                return handleReportsError(error, reply);
            }
        }
    );

    app.get("/reports/:publicId", { schema: getReportSchema }, async (request, reply) => {
        const params = reportPublicIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid report id", issues: params.error.flatten() });
        }
        const jwtUser = await optionalJwtUser(request);
        const viewer: ReportViewer = {
            jwtSub: jwtUser?.sub ?? null,
            roles: jwtUser?.roles ?? [],
            anonymousId: anonymousIdHeader(request),
        };
        try {
            return reply.send(await reportsService.getForViewer(params.data.publicId, viewer));
        } catch (error) {
            return handleReportsError(error, reply);
        }
    });

    app.post(
        "/reports/:publicId/followups",
        { preHandler: app.authenticate, schema: postFollowupSchema },
        async (request, reply) => {
            const params = reportPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({ message: "Invalid report id", issues: params.error.flatten() });
            }
            const body = followupBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply.code(400).send({ message: "Invalid follow-up payload", issues: body.error.flatten() });
            }
            const viewer: ReportViewer = {
                jwtSub: request.user.sub,
                roles: request.user.roles ?? [],
                anonymousId: null,
            };
            try {
                return reply.send(
                    await reportsService.addUserFollowup(params.data.publicId, viewer, body.data.message)
                );
            } catch (error) {
                return handleReportsError(error, reply);
            }
        }
    );

    // --- Admin analytics (static paths registered before /admin/reports/:id) ---

    app.get(
        "/admin/reports/analytics/summary",
        { ...adminGuard, schema: getReportAnalyticsSummarySchema },
        async (_request, reply) => reply.send(await reportsService.analyticsSummary())
    );

    app.get(
        "/admin/reports/analytics/by-type",
        { ...adminGuard, schema: getReportAnalyticsByTypeSchema },
        async (_request, reply) => reply.send(await reportsService.analyticsByType())
    );

    app.get(
        "/admin/reports/analytics/by-status",
        { ...adminGuard, schema: getReportAnalyticsByStatusSchema },
        async (_request, reply) => reply.send(await reportsService.analyticsByStatus())
    );

    app.get(
        "/admin/reports/analytics/by-region",
        { ...adminGuard, schema: getReportAnalyticsByRegionSchema },
        async (_request, reply) => reply.send(await reportsService.analyticsByRegion())
    );

    app.get(
        "/admin/reports/analytics/anonymous-vs-logged-in",
        { ...adminGuard, schema: getReportAnalyticsAnonymousSchema },
        async (_request, reply) => reply.send(await reportsService.analyticsAnonymousVsLoggedIn())
    );

    // --- Admin ---

    app.get("/admin/reports", { ...adminGuard, schema: getAdminReportsSchema }, async (request, reply) => {
        const query = adminReportsQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({ message: "Invalid report query", issues: query.error.flatten() });
        }
        try {
            return reply.send(await reportsService.adminList(query.data));
        } catch (error) {
            return handleReportsError(error, reply);
        }
    });

    app.get("/admin/reports/:id", { ...adminGuard, schema: getAdminReportSchema }, async (request, reply) => {
        const params = adminReportIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid report id", issues: params.error.flatten() });
        }
        try {
            return reply.send(await reportsService.adminGet(params.data.id));
        } catch (error) {
            return handleReportsError(error, reply);
        }
    });

    app.patch(
        "/admin/reports/:id/status",
        { ...adminGuard, schema: patchAdminReportStatusSchema },
        async (request, reply) => {
            const params = adminReportIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({ message: "Invalid report id", issues: params.error.flatten() });
            }
            const body = adminStatusBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply.code(400).send({ message: "Invalid status payload", issues: body.error.flatten() });
            }
            try {
                const audit = await adminAudit(request);
                return reply.send(
                    await reportsService.adminChangeStatus(params.data.id, body.data.statusCode, body.data.note, audit)
                );
            } catch (error) {
                return handleReportsError(error, reply);
            }
        }
    );

    app.post(
        "/admin/reports/:id/request-info",
        { ...adminGuard, schema: postAdminRequestInfoSchema },
        async (request, reply) => {
            const params = adminReportIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({ message: "Invalid report id", issues: params.error.flatten() });
            }
            const body = adminRequestInfoBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply.code(400).send({ message: "Invalid request-info payload", issues: body.error.flatten() });
            }
            try {
                const audit = await adminAudit(request);
                return reply.send(await reportsService.adminRequestInfo(params.data.id, body.data.message, audit));
            } catch (error) {
                return handleReportsError(error, reply);
            }
        }
    );

    app.patch(
        "/admin/reports/:id/admin-note",
        { ...adminGuard, schema: patchAdminReportNoteSchema },
        async (request, reply) => {
            const params = adminReportIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({ message: "Invalid report id", issues: params.error.flatten() });
            }
            const body = adminNoteBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply.code(400).send({ message: "Invalid admin note payload", issues: body.error.flatten() });
            }
            try {
                const audit = await adminAudit(request);
                return reply.send(await reportsService.adminUpdateNote(params.data.id, body.data.adminNote, audit));
            } catch (error) {
                return handleReportsError(error, reply);
            }
        }
    );

    app.post(
        "/admin/reports/:id/reward-points",
        { ...adminGuard, schema: postAdminRewardPointsSchema },
        async (request, reply) => {
            const params = adminReportIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({ message: "Invalid report id", issues: params.error.flatten() });
            }
            const body = rewardPointsBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply.code(400).send({ message: "Invalid reward payload", issues: body.error.flatten() });
            }
            try {
                const audit = await adminAudit(request);
                return reply.send(
                    await reportsService.adminRewardPoints(
                        params.data.id,
                        {
                            pointsDelta: body.data.pointsDelta,
                            reasonCode: body.data.reasonCode,
                            note: body.data.note,
                        },
                        audit
                    )
                );
            } catch (error) {
                return handleReportsError(error, reply);
            }
        }
    );
};

export default reportsRoutes;
