import type { FastifyPluginAsync } from "fastify";

import {
    entityAdminAreaInferBodySchema,
    entityAdminAreaValidateManualBodySchema,
} from "./entity-admin-area.schema.js";
import { EntityAdminAreaRepository } from "./entity-admin-area.repo.js";
import { EntityAdminAreaService } from "./entity-admin-area.service.js";
import {
    postEntityAdminAreaInferSchema,
    postEntityAdminAreaValidateManualSchema,
} from "./entity-admin-area.openapi.js";

const entityAdminAreaRoutes: FastifyPluginAsync = async (app) => {
    const repo = new EntityAdminAreaRepository(app.prisma);
    const service = new EntityAdminAreaService(repo);

    app.post(
        "/entity-admin-area/infer",
        {
            preHandler: app.authenticate,
            schema: postEntityAdminAreaInferSchema,
        },
        async (request, reply) => {
            const parsed = entityAdminAreaInferBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid infer payload",
                    issues: parsed.error.flatten(),
                });
            }

            const result = await service.infer(parsed.data);
            return reply.send(result);
        }
    );

    app.post(
        "/entity-admin-area/validate-manual",
        {
            preHandler: app.authenticate,
            schema: postEntityAdminAreaValidateManualSchema,
        },
        async (request, reply) => {
            const parsed = entityAdminAreaValidateManualBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid validate payload",
                    issues: parsed.error.flatten(),
                });
            }

            const result = await service.validateManual(parsed.data, request.user);
            return reply.send(result);
        }
    );
};

export default entityAdminAreaRoutes;
