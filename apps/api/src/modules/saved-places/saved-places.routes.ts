import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { SavedPlacesRepository } from "./saved-places.repo.js";
import { SavedPlacesError, SavedPlacesService } from "./saved-places.service.js";
import {
    createSavedPlaceBodySchema,
    savedPlaceIdParamSchema,
} from "./saved-places.schema.js";
import {
    deleteSavedPlaceSchema,
    getSavedPlacesSchema,
    postSavedPlaceSchema,
} from "./saved-places.openapi.js";

function handleSavedPlacesError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof SavedPlacesError) {
        return reply.code(error.statusCode).send({ message: error.message });
    }

    throw error;
}

const savedPlacesRoutes: FastifyPluginAsync = async (app) => {
    const savedPlacesRepo = new SavedPlacesRepository(app.prisma);
    const savedPlacesService = new SavedPlacesService(savedPlacesRepo);

    app.get(
        "/me/saved-places",
        {
            preHandler: app.authenticate,
            schema: getSavedPlacesSchema,
        },
        async (request, reply) => {
            try {
                const places = await savedPlacesService.list(request.user.sub);
                return reply.send(places);
            } catch (error) {
                return handleSavedPlacesError(error, reply);
            }
        }
    );

    app.post(
        "/me/saved-places",
        {
            preHandler: app.authenticate,
            schema: postSavedPlaceSchema,
        },
        async (request, reply) => {
            const parsed = createSavedPlaceBodySchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid saved place payload",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const saved = await savedPlacesService.create(
                    request.user.sub,
                    parsed.data
                );
                return reply.code(201).send(saved);
            } catch (error) {
                return handleSavedPlacesError(error, reply);
            }
        }
    );

    app.delete(
        "/me/saved-places/:id",
        {
            preHandler: app.authenticate,
            schema: deleteSavedPlaceSchema,
        },
        async (request, reply) => {
            const parsed = savedPlaceIdParamSchema.safeParse(request.params);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid saved place id",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                await savedPlacesService.delete(request.user.sub, BigInt(parsed.data.id));
                return reply.send({ message: "Saved place removed" });
            } catch (error) {
                return handleSavedPlacesError(error, reply);
            }
        }
    );
};

export default savedPlacesRoutes;
