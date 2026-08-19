import type { FastifyPluginAsync } from "fastify";

import { listSearchDocumentsQuerySchema } from "./search-documents.schema.js";
import { SearchDocumentsRepository } from "./search-documents.repo.js";
import { SearchDocumentsService } from "./search-documents.service.js";
import { getSearchDocumentsSchema } from "./search-documents.openapi.js";

const searchDocumentsRoutes: FastifyPluginAsync = async (app) => {
    const service = new SearchDocumentsService(new SearchDocumentsRepository(app.prisma));
    const readGuard = { preHandler: [app.authenticate, app.requireDashboardAccess] };

    app.get(
        "/admin/search/documents",
        { ...readGuard, schema: getSearchDocumentsSchema },
        async (request, reply) => {
            const parsed = listSearchDocumentsQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid search documents list query",
                    issues: parsed.error.flatten(),
                });
            }
            return reply.send(await service.list(parsed.data));
        },
    );
};

export default searchDocumentsRoutes;
