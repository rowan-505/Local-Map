import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { createMediaService, handleMediaError } from "../media/media.http.js";
import { postFieldReportMediaSchema } from "../media/media.openapi.js";
import { fieldReportMediaBodySchema } from "../media/media.schema.js";
import { ReportsRepository } from "../reports/reports.repo.js";
import {
    getFieldBootstrapSchema,
    getFieldReportSchema,
    patchFieldReportSchema,
    postFieldReportFollowupSchema,
    postFieldReportSchema,
} from "./field.openapi.js";
import { FieldReportsRepository } from "./field-reports.repo.js";
import {
    FIELD_REPORT_CREATE_RATE_LIMIT,
    fieldReportCreateBodySchema,
    fieldReportFollowupBodySchema,
    fieldReportPatchBodySchema,
    fieldReportPublicIdParamSchema,
} from "./field-reports.schema.js";
import { FieldReportsError, FieldReportsService } from "./field-reports.service.js";
import { FieldRepository } from "./field.repo.js";
import { fieldBootstrapQuerySchema } from "./field.schema.js";
import { FieldService } from "./field.service.js";

function handleFieldReportsError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof FieldReportsError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    throw error;
}

const fieldRoutes: FastifyPluginAsync = async (app) => {
    const service = new FieldService(new FieldRepository(app.prisma));
    const reportsRepo = new ReportsRepository(app.prisma);
    const fieldReports = new FieldReportsService(new FieldReportsRepository(app.prisma), reportsRepo);
    const fieldAuth = { preHandler: [app.authenticate, app.requireFieldSurveyor] };

    app.get("/bootstrap", { schema: getFieldBootstrapSchema, ...fieldAuth }, async (request, reply) => {
        const parsed = fieldBootstrapQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid field bootstrap query",
                issues: parsed.error.flatten(),
            });
        }

        const result = await service.bootstrap(parsed.data.revision);
        return reply.code(200).send(result);
    });

    app.post(
        "/reports",
        {
            schema: postFieldReportSchema,
            ...fieldAuth,
            config: { rateLimit: FIELD_REPORT_CREATE_RATE_LIMIT },
        },
        async (request, reply) => {
            const parsed = fieldReportCreateBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid field report payload",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                const result = await fieldReports.create(request.user.sub, parsed.data);
                return reply.code(result.created ? 201 : 200).send(result.report);
            } catch (error) {
                return handleFieldReportsError(error, reply);
            }
        }
    );

    app.get("/reports/:publicId", { schema: getFieldReportSchema, ...fieldAuth }, async (request, reply) => {
        const params = fieldReportPublicIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid report id", issues: params.error.flatten() });
        }
        try {
            return reply.send(await fieldReports.get(request.user.sub, params.data.publicId));
        } catch (error) {
            return handleFieldReportsError(error, reply);
        }
    });

    app.patch("/reports/:publicId", { schema: patchFieldReportSchema, ...fieldAuth }, async (request, reply) => {
        const params = fieldReportPublicIdParamSchema.safeParse(request.params);
        const body = fieldReportPatchBodySchema.safeParse(request.body);
        if (!params.success) {
            return reply.code(400).send({
                message: "Invalid field report patch",
                issues: params.error.flatten(),
            });
        }
        if (!body.success) {
            return reply.code(400).send({
                message: "Invalid field report patch",
                issues: body.error.flatten(),
            });
        }
        try {
            return reply.send(await fieldReports.patch(request.user.sub, params.data.publicId, body.data));
        } catch (error) {
            return handleFieldReportsError(error, reply);
        }
    });

    app.post(
        "/reports/:publicId/followups",
        { schema: postFieldReportFollowupSchema, ...fieldAuth },
        async (request, reply) => {
            const params = fieldReportPublicIdParamSchema.safeParse(request.params);
            const body = fieldReportFollowupBodySchema.safeParse(request.body);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid field follow-up",
                    issues: params.error.flatten(),
                });
            }
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid field follow-up",
                    issues: body.error.flatten(),
                });
            }
            try {
                const report = await fieldReports.addFollowup(
                    request.user.sub,
                    params.data.publicId,
                    body.data.message
                );
                return reply.code(201).send(report);
            } catch (error) {
                return handleFieldReportsError(error, reply);
            }
        }
    );

    app.post(
        "/reports/:publicId/media",
        { schema: postFieldReportMediaSchema, ...fieldAuth },
        async (request, reply) => {
            const params = fieldReportPublicIdParamSchema.safeParse(request.params);
            const body = fieldReportMediaBodySchema.safeParse(request.body);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid field report media payload",
                    issues: params.error.flatten(),
                });
            }
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid field report media payload",
                    issues: body.error.flatten(),
                });
            }
            try {
                const result = await createMediaService(app.prisma).attachToFieldReport(
                    request.user.sub,
                    params.data.publicId,
                    body.data
                );
                return reply.code(201).send(result);
            } catch (error) {
                return handleMediaError(error, reply);
            }
        }
    );
};

export default fieldRoutes;
