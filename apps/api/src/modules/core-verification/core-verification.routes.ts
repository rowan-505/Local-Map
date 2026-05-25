import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { CoreVerificationRepository } from "./core-verification.repo.js";
import {
    coreVerificationEditPatchSchema,
    coreVerificationEntityIdParamSchema,
    coreVerificationFamilyParamSchema,
    coreVerificationListQuerySchema,
    coreVerificationStatusPatchSchema,
} from "./core-verification.schema.js";

function numericUserId(request: FastifyRequest): bigint | null {
    const id = request.user?.id ?? request.user?.sub;
    return id && /^[0-9]+$/.test(id) ? BigInt(id) : null;
}

function replyError(request: FastifyRequest, reply: FastifyReply, error: unknown, status = 500) {
    request.log.error({ err: error }, "core verification request failed");
    return reply.code(status).send({
        message: error instanceof Error ? error.message : "Core verification request failed.",
    });
}

const coreVerificationRoutes: FastifyPluginAsync = async (app) => {
    const repo = new CoreVerificationRepository(app.prisma);

    app.get(
        "/summary",
        { preHandler: app.authenticate },
        async (_request, reply) => reply.send(await repo.summary())
    );

    app.get(
        "/:family",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const params = coreVerificationFamilyParamSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ message: "Invalid family", issues: params.error.flatten() });
            const query = coreVerificationListQuerySchema.safeParse(request.query);
            if (!query.success) return reply.code(400).send({ message: "Invalid query", issues: query.error.flatten() });
            try {
                return reply.send(await repo.list(params.data.family, query.data));
            } catch (error) {
                return replyError(request, reply, error);
            }
        }
    );

    app.get(
        "/:family/:id",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const params = coreVerificationEntityIdParamSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ message: "Invalid parameters", issues: params.error.flatten() });
            try {
                const detail = await repo.detail(params.data.family, params.data.id);
                return detail ? reply.send(detail) : reply.code(404).send({ message: "Core row not found." });
            } catch (error) {
                return replyError(request, reply, error);
            }
        }
    );

    app.patch(
        "/:family/:id/status",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const params = coreVerificationEntityIdParamSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ message: "Invalid parameters", issues: params.error.flatten() });
            const body = coreVerificationStatusPatchSchema.safeParse(request.body);
            if (!body.success) return reply.code(400).send({ message: "Invalid status body", issues: body.error.flatten() });
            try {
                const detail = await repo.updateStatus(params.data.family, params.data.id, body.data, numericUserId(request));
                return detail ? reply.send(detail) : reply.code(404).send({ message: "Core row not found." });
            } catch (error) {
                return replyError(request, reply, error, 400);
            }
        }
    );

    app.patch(
        "/:family/:id/edit",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const params = coreVerificationEntityIdParamSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ message: "Invalid parameters", issues: params.error.flatten() });
            const body = coreVerificationEditPatchSchema.safeParse(request.body);
            if (!body.success) return reply.code(400).send({ message: "Invalid edit body", issues: body.error.flatten() });
            try {
                const detail = await repo.edit(params.data.family, params.data.id, body.data);
                return detail ? reply.send(detail) : reply.code(404).send({ message: "Core row not found." });
            } catch (error) {
                return replyError(request, reply, error, 400);
            }
        }
    );
};

export default coreVerificationRoutes;
