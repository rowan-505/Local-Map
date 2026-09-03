import type { FastifyPluginAsync } from "fastify";

import { createMediaService, handleMediaError } from "./media.http.js";
import { postMediaCompleteSchema, postMediaUploadSchema } from "./media.openapi.js";
import { MEDIA_UPLOAD_RATE_LIMIT, mediaPublicIdParamSchema, mediaUploadBodySchema } from "./media.schema.js";

const mediaRoutes: FastifyPluginAsync = async (app) => {
    const mediaAuth = { preHandler: [app.authenticate] };

    app.post(
        "/uploads",
        {
            schema: postMediaUploadSchema,
            ...mediaAuth,
            config: { rateLimit: MEDIA_UPLOAD_RATE_LIMIT },
        },
        async (request, reply) => {
            const parsed = mediaUploadBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid media upload payload",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                const result = await createMediaService(app.prisma).createUpload(request.user.sub, parsed.data);
                return reply.code(201).send(result);
            } catch (error) {
                return handleMediaError(error, reply);
            }
        }
    );

    app.post("/:publicId/complete", { schema: postMediaCompleteSchema, ...mediaAuth }, async (request, reply) => {
        const params = mediaPublicIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid media id", issues: params.error.flatten() });
        }
        try {
            return reply.send(await createMediaService(app.prisma).complete(request.user.sub, params.data.publicId));
        } catch (error) {
            return handleMediaError(error, reply);
        }
    });
};

export default mediaRoutes;
