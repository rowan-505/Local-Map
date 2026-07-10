import type { FastifyPluginAsync } from "fastify";

import { getSearchOverviewSchema } from "./search-overview.openapi.js";
import { SearchOverviewRepository } from "./search-overview.repo.js";
import { SearchOverviewService } from "./search-overview.service.js";

const searchOverviewRoutes: FastifyPluginAsync = async (app) => {
    const service = new SearchOverviewService(
        new SearchOverviewRepository(app.prisma),
        app.prisma,
    );
    const requireAdmin = app.requireRole("admin", "super_admin");
    const adminGuard = { preHandler: [app.authenticate, requireAdmin] };

    app.get(
        "/admin/search/overview",
        { ...adminGuard, schema: getSearchOverviewSchema },
        async (_request, reply) => {
            return reply.send(await service.getOverview());
        },
    );
};

export default searchOverviewRoutes;
