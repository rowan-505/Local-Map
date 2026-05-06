import type { FastifyPluginAsync } from "fastify";

import { DashboardStatsRepository } from "./dashboard.repo.js";
import { DashboardStatsService } from "./dashboard.service.js";

const dashboardRoutes: FastifyPluginAsync = async (app) => {
    const dashboardStatsRepo = new DashboardStatsRepository(app.prisma);
    const dashboardStatsService = new DashboardStatsService(dashboardStatsRepo);

    app.get(
        "/dashboard/stats",
        {
            preHandler: app.authenticate,
        },
        async (_request, reply) => {
            const stats = await dashboardStatsService.getDashboardStats();
            return reply.send(stats);
        }
    );
};

export default dashboardRoutes;
