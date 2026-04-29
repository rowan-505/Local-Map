import type { FastifyPluginAsync } from "fastify";

import { adminAreasQuerySchema } from "./admin-areas.schema.js";
import { AdminAreasRepository } from "./admin-areas.repo.js";
import { AdminAreasService } from "./admin-areas.service.js";

const adminAreasRoutes: FastifyPluginAsync = async (app) => {
    const adminAreasRepo = new AdminAreasRepository(app.prisma);
    const adminAreasService = new AdminAreasService(adminAreasRepo);

    app.get(
        "/admin-areas",
        {
            preHandler: app.authenticate,
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
};

export default adminAreasRoutes;
