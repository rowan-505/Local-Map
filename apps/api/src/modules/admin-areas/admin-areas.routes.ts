import type { FastifyPluginAsync } from "fastify";

import { adminAreaOptionsQuerySchema, adminAreasQuerySchema } from "./admin-areas.schema.js";
import { AdminAreasRepository } from "./admin-areas.repo.js";
import { AdminAreasService } from "./admin-areas.service.js";
import { getAdminAreaOptionsSchema, getAdminAreasSchema } from "./admin-areas.openapi.js";

const adminAreasRoutes: FastifyPluginAsync = async (app) => {
    const adminAreasRepo = new AdminAreasRepository(app.prisma);
    const adminAreasService = new AdminAreasService(adminAreasRepo);

    app.get(
        "/admin-areas",
        {
            preHandler: app.authenticate,
            schema: getAdminAreasSchema,
        },
        async (request, reply) => {
            const parsed = adminAreasQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid admin areas query",
                    issues: parsed.error.flatten(),
                });
            }

            const adminAreas = await adminAreasService.listAdminAreas(parsed.data.limit);
            return reply.send(adminAreas);
        }
    );

    app.get(
        "/admin-areas/options",
        {
            preHandler: app.authenticate,
            schema: getAdminAreaOptionsSchema,
        },
        async (request, reply) => {
            const parsed = adminAreaOptionsQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid admin area options query",
                    issues: parsed.error.flatten(),
                });
            }

            const options = await adminAreasService.listAdminAreaOptions({
                limit: parsed.data.limit,
                q: parsed.data.q,
            });
            return reply.send(options);
        }
    );
};

export default adminAreasRoutes;
