import type { FastifyPluginAsync } from "fastify";

import { PlaceFormOptionsRepository } from "./place-form-options.repo.js";
import { placeFormOptionsQuerySchema } from "./place-form-options.schema.js";
import { PlaceFormOptionsService } from "./place-form-options.service.js";

const placeFormOptionsRoutes: FastifyPluginAsync = async (app) => {
    const placeFormOptionsRepo = new PlaceFormOptionsRepository(app.prisma);
    const placeFormOptionsService = new PlaceFormOptionsService(placeFormOptionsRepo);

    app.get(
        "/place-form-options",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const parsed = placeFormOptionsQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid place form options query",
                    issues: parsed.error.flatten(),
                });
            }

            const options = await placeFormOptionsService.getPlaceFormOptions();
            return reply.send(options);
        }
    );
};

export default placeFormOptionsRoutes;
