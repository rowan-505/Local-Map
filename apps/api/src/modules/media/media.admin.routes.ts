import type { FastifyPluginAsync } from "fastify";

import { createMediaService, handleMediaError } from "./media.http.js";
import { getAdminMediaAccessSchema, postAdminPublishStopPhotoSchema } from "./media.openapi.js";
import {
    MEDIA_ACCESS_RATE_LIMIT,
    MEDIA_PUBLISH_RATE_LIMIT,
    mediaPublicIdParamSchema,
    publishStopPhotoBodySchema,
} from "./media.schema.js";

const mediaAdminRoutes: FastifyPluginAsync = async (app) => {
    const adminGuard = {
        preHandler: [app.authenticate, app.requireRole("admin", "super_admin")],
    };

    app.get(
        "/:publicId/access",
        {
            schema: getAdminMediaAccessSchema,
            ...adminGuard,
            config: { rateLimit: MEDIA_ACCESS_RATE_LIMIT },
        },
        async (request, reply) => {
            const params = mediaPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid media id",
                    issues: params.error.flatten(),
                });
            }
            try {
                return reply.send(await createMediaService(app.prisma).adminAccess(params.data.publicId));
            } catch (error) {
                return handleMediaError(error, reply);
            }
        }
    );

    app.post(
        "/:publicId/publish-stop",
        {
            schema: postAdminPublishStopPhotoSchema,
            ...adminGuard,
            config: { rateLimit: MEDIA_PUBLISH_RATE_LIMIT },
        },
        async (request, reply) => {
            const params = mediaPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid media id",
                    issues: params.error.flatten(),
                });
            }
            const body = publishStopPhotoBodySchema.safeParse(request.body ?? {});
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid publish body",
                    issues: body.error.flatten(),
                });
            }
            try {
                const jwtSub = request.user.sub;
                return reply.send(
                    await createMediaService(app.prisma).adminPublishStopPhoto(
                        jwtSub,
                        params.data.publicId,
                        body.data,
                        {
                            ipAddress: request.ip ?? null,
                            userAgent: request.headers["user-agent"] ?? null,
                        }
                    )
                );
            } catch (error) {
                return handleMediaError(error, reply);
            }
        }
    );
};

export default mediaAdminRoutes;
