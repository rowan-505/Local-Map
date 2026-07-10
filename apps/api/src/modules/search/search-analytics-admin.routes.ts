import type { FastifyPluginAsync } from "fastify";

import { getSearchAnalyticsDashboardSchema } from "./search-analytics-admin.openapi.js";
import { SearchAnalyticsAdminRepository } from "./search-analytics-admin.repo.js";
import { SearchAnalyticsAdminService } from "./search-analytics-admin.service.js";
import { searchAnalyticsQuerySchema } from "./search-analytics-admin.schema.js";

const searchAnalyticsAdminRoutes: FastifyPluginAsync = async (app) => {
    const service = new SearchAnalyticsAdminService(new SearchAnalyticsAdminRepository(app.prisma));
    const requireAdmin = app.requireRole("admin", "super_admin");
    const adminGuard = { preHandler: [app.authenticate, requireAdmin] };

    app.get(
        "/admin/search/analytics",
        { ...adminGuard, schema: getSearchAnalyticsDashboardSchema },
        async (request, reply) => {
            const parsed = searchAnalyticsQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid search analytics query",
                    issues: parsed.error.flatten(),
                });
            }
            return reply.send(await service.getDashboard(parsed.data));
        },
    );
};

export default searchAnalyticsAdminRoutes;
