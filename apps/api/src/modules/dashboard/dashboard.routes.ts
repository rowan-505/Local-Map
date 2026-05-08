import type { FastifyPluginAsync } from "fastify";

import { DashboardStatsRepository } from "./dashboard.repo.js";
import { DashboardStatsService } from "./dashboard.service.js";
import { getDashboardStatsSchema } from "./dashboard.openapi.js";

const dashboardRoutes: FastifyPluginAsync = async (app) => {
    const dashboardStatsRepo = new DashboardStatsRepository(app.prisma);
    const dashboardStatsService = new DashboardStatsService(dashboardStatsRepo);

    app.get(
        "/dashboard/stats",
        {
            preHandler: app.authenticate,
            schema: getDashboardStatsSchema,
        },
        async (request, reply) => {
            console.log("GET /dashboard/stats called");
            try {
                const stats = await dashboardStatsService.getDashboardStats();
                return reply.send(stats);
            } catch (err) {
                console.error("DASHBOARD_STATS_ERROR:", err);
                request.log.error({ err }, "GET /dashboard/stats failed");
                throw err;
            }
        }
    );
};

export default dashboardRoutes;
