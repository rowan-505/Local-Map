import type { FastifyPluginAsync } from "fastify";

import { categoriesQuerySchema } from "./categories.schema.js";
import { CategoriesRepository } from "./categories.repo.js";
import { CategoriesService } from "./categories.service.js";

const categoriesRoutes: FastifyPluginAsync = async (app) => {
    const categoriesRepo = new CategoriesRepository(app.prisma);
    const categoriesService = new CategoriesService(categoriesRepo);

    app.get(
        "/categories",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const parsed = categoriesQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid categories query",
                    issues: parsed.error.flatten(),
                });
            }

            const categories = await categoriesService.listCategories();
            return reply.send(categories);
        }
    );
};

export default categoriesRoutes;
