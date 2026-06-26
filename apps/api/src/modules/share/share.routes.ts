import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { getPublicAppUrl } from "../../config/env.js";
import { ShareRepository } from "./share.repo.js";
import { ShareError, ShareService } from "./share.service.js";
import { createShareLinkBodySchema, shareCodeParamSchema } from "./share.schema.js";
import { getShareLinkSchema, postShareLinkSchema } from "./share.openapi.js";

function handleShareError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof ShareError) {
        return reply.code(error.statusCode).send({ message: error.message });
    }

    throw error;
}

const shareRoutes: FastifyPluginAsync = async (app) => {
    const service = new ShareService(new ShareRepository(app.prisma), getPublicAppUrl());

    app.post("/share/links", { schema: postShareLinkSchema }, async (request, reply) => {
        const parsed = createShareLinkBodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid share link payload",
                issues: parsed.error.flatten(),
            });
        }

        try {
            const result = await service.create(parsed.data);
            return reply.code(201).send(result);
        } catch (error) {
            return handleShareError(error, reply);
        }
    });

    app.get("/share/links/:code", { schema: getShareLinkSchema }, async (request, reply) => {
        const parsed = shareCodeParamSchema.safeParse(request.params);
        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid share code",
                issues: parsed.error.flatten(),
            });
        }

        try {
            const resolved = await service.resolve(parsed.data.code);
            return reply.send(resolved);
        } catch (error) {
            return handleShareError(error, reply);
        }
    });
};

export default shareRoutes;
