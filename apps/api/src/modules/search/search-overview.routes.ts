import type { FastifyPluginAsync } from "fastify";

import { getSearchOverviewSchema } from "./search-overview.openapi.js";
import { SearchOverviewRepository } from "./search-overview.repo.js";
import { SearchOverviewService } from "./search-overview.service.js";

const searchOverviewRoutes: FastifyPluginAsync = async (app) => {
    const service = new SearchOverviewService(
        new SearchOverviewRepository(app.prisma),
        app.prisma,
    );
    const readGuard = { preHandler: [app.authenticate, app.requireDashboardAccess] };

    app.get(
        "/admin/search/overview",
        { ...readGuard, schema: getSearchOverviewSchema },
        async (_request, reply) => {
            return reply.send(await service.getOverview());
        },
    );
};

export default searchOverviewRoutes;
