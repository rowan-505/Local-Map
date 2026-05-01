import type { FastifyPluginAsync } from "fastify";

import {
    createPlaceBodySchema,
    placeIdParamsSchema,
    placesQuerySchema,
    updatePlaceBodySchema,
} from "./places.schema.js";
import { PlacesRepository } from "./places.repo.js";
import { PlaceNotFoundError, PlacesService, PlaceValidationError } from "./places.service.js";

const EDIT_PLACE_ROLES = new Set(["admin", "editor"]);

function sanitizePlaceCreateBody(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return body;
    }

    const {
        id: _ignoredId,
        public_id: _ignoredPublicId,
        created_at: _ignoredCreatedAt,
        updated_at: _ignoredUpdatedAt,
        deleted_at: _ignoredDeletedAt,
        ...rest
    } = body as Record<string, unknown>;

    return rest;
}

function sanitizePlacePatchBody(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return body;
    }

    const { updated_at: _ignoredUpdatedAt, ...rest } = body as Record<string, unknown>;
    return rest;
}

const placesRoutes: FastifyPluginAsync = async (app) => {
    const placesRepo = new PlacesRepository(app.prisma);
    const placesService = new PlacesService(placesRepo);

    app.get(
        "/places",
        async (request, reply) => {
            const parsed = placesQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid places query",
                    issues: parsed.error.flatten(),
                });
            }

            const places = await placesService.listPlaces(parsed.data);
            return reply.send(places);
        }
    );

    app.get(
        "/place-form-options",
        {
            preHandler: app.authenticate,
        },
        async (_request, reply) => {
            const options = await placesService.getPlaceFormOptions();
            return reply.send(options);
        }
    );

    app.get(
        "/places/:id",
        async (request, reply) => {
            const parsed = placeIdParamsSchema.safeParse(request.params);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid place id",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const place = await placesService.getPlaceByPublicId(parsed.data.id);
                return reply.send(place);
            } catch (error) {
                if (error instanceof PlaceNotFoundError) {
                    return reply.code(404).send({
                        message: error.message,
                    });
                }

                throw error;
            }
        }
    );

    app.post(
        "/places",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const sanitizedBody = sanitizePlaceCreateBody(request.body);
            const parsed = createPlaceBodySchema.safeParse(sanitizedBody);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid place payload",
                    issues: parsed.error.flatten(),
                });
            }

            const canCreatePlace = request.user.roles.some((role) => EDIT_PLACE_ROLES.has(role));

            if (!canCreatePlace) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const createdPlace = await placesService.createPlace(parsed.data);
                return reply.code(201).send(createdPlace);
            } catch (error) {
                if (error instanceof PlaceValidationError) {
                    return reply.code(400).send({
                        message: error.message,
                    });
                }

                throw error;
            }
        }
    );

    app.patch(
        "/places/:id",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const paramsParsed = placeIdParamsSchema.safeParse(request.params);
            const sanitizedBody = sanitizePlacePatchBody(request.body);
            const bodyParsed = updatePlaceBodySchema.safeParse(sanitizedBody);

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid place id",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid place payload",
                    issues: bodyParsed.error.flatten(),
                });
            }

            const canEditPlace = request.user.roles.some((role) => EDIT_PLACE_ROLES.has(role));

            if (!canEditPlace) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const updatedPlace = await placesService.updatePlace(
                    paramsParsed.data.id,
                    bodyParsed.data
                );

                return reply.send(updatedPlace);
            } catch (error) {
                if (error instanceof PlaceValidationError) {
                    return reply.code(400).send({
                        message: error.message,
                    });
                }

                if (error instanceof PlaceNotFoundError) {
                    return reply.code(404).send({
                        message: error.message,
                    });
                }

                throw error;
            }
        }
    );

    app.delete(
        "/places/:id",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const parsed = placeIdParamsSchema.safeParse(request.params);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid place id",
                    issues: parsed.error.flatten(),
                });
            }

            const canDeletePlace = request.user.roles.some((role) => EDIT_PLACE_ROLES.has(role));

            if (!canDeletePlace) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const deletedPlace = await placesService.deletePlace(parsed.data.id);
                return reply.send(deletedPlace);
            } catch (error) {
                if (error instanceof PlaceNotFoundError) {
                    return reply.code(404).send({
                        message: error.message,
                    });
                }

                throw error;
            }
        }
    );
};

export default placesRoutes;
