import type { FastifyPluginAsync } from "fastify";

import {
    linkPlaceBuildingBodySchema,
    patchPlaceBuildingBodySchema,
    placeBuildingParamsSchema,
} from "./place-buildings.schema.js";
import { placeIdParamsSchema } from "../places/places.schema.js";
import { PlaceBuildingsRepository } from "./place-buildings.repo.js";
import {
    PlaceBuildingDuplicateLinkError,
    PlaceBuildingInactiveBuildingError,
    PlaceBuildingLinkNotFoundError,
    PlaceBuildingPlaceNotFoundError,
    PlaceBuildingsService,
} from "./place-buildings.service.js";
import { buildingIdParamsSchema } from "../buildings/buildings.schema.js";

const EDIT_LINK_ROLES = new Set(["admin", "editor"]);

const placeBuildingRoutes: FastifyPluginAsync = async (app) => {
    const repo = new PlaceBuildingsRepository(app.prisma);
    const service = new PlaceBuildingsService(repo);

    app.get(
        "/places/:id/buildings",
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

            try {
                const items = await service.listBuildingsForPlace(parsed.data.id);
                return reply.send({ items });
            } catch (error) {
                if (error instanceof PlaceBuildingPlaceNotFoundError) {
                    return reply.code(404).send({ message: error.message });
                }

                throw error;
            }
        }
    );

    app.post(
        "/places/:id/buildings",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const paramsParsed = placeIdParamsSchema.safeParse(request.params);
            const bodyParsed = linkPlaceBuildingBodySchema.safeParse(request.body ?? {});

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid place id",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid payload",
                    issues: bodyParsed.error.flatten(),
                });
            }

            const canEdit = request.user.roles.some((role) => EDIT_LINK_ROLES.has(role));

            if (!canEdit) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const created = await service.linkBuildingToPlace(paramsParsed.data.id, bodyParsed.data);
                return reply.code(201).send(created);
            } catch (error) {
                if (error instanceof PlaceBuildingPlaceNotFoundError) {
                    return reply.code(404).send({ message: error.message });
                }

                if (error instanceof PlaceBuildingInactiveBuildingError) {
                    return reply.code(404).send({ message: error.message });
                }

                if (error instanceof PlaceBuildingDuplicateLinkError) {
                    return reply.code(409).send({ message: error.message });
                }

                throw error;
            }
        }
    );

    app.patch(
        "/places/:id/buildings/:buildingId",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const paramsParsed = placeBuildingParamsSchema.safeParse(request.params);
            const bodyParsed = patchPlaceBuildingBodySchema.safeParse(request.body ?? {});

            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid place or building id",
                    issues: paramsParsed.error.flatten(),
                });
            }

            if (!bodyParsed.success) {
                return reply.code(400).send({
                    message: "Invalid payload",
                    issues: bodyParsed.error.flatten(),
                });
            }

            const canEdit = request.user.roles.some((role) => EDIT_LINK_ROLES.has(role));

            if (!canEdit) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const updated = await service.patchPlaceBuildingLink(
                    paramsParsed.data.id,
                    paramsParsed.data.buildingId,
                    bodyParsed.data
                );
                return reply.send(updated);
            } catch (error) {
                if (error instanceof PlaceBuildingPlaceNotFoundError) {
                    return reply.code(404).send({ message: error.message });
                }

                if (error instanceof PlaceBuildingLinkNotFoundError) {
                    return reply.code(404).send({ message: error.message });
                }

                throw error;
            }
        }
    );

    app.delete(
        "/places/:id/buildings/:buildingId",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const parsed = placeBuildingParamsSchema.safeParse(request.params);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid place or building id",
                    issues: parsed.error.flatten(),
                });
            }

            const canEdit = request.user.roles.some((role) => EDIT_LINK_ROLES.has(role));

            if (!canEdit) {
                return reply.code(403).send({
                    message: "Admin or editor role required",
                });
            }

            try {
                const result = await service.unlink(parsed.data.id, parsed.data.buildingId);
                return reply.send(result);
            } catch (error) {
                if (error instanceof PlaceBuildingPlaceNotFoundError) {
                    return reply.code(404).send({ message: error.message });
                }

                if (error instanceof PlaceBuildingLinkNotFoundError) {
                    return reply.code(404).send({ message: error.message });
                }

                throw error;
            }
        }
    );

    app.get(
        "/buildings/:id/places",
        {
            preHandler: app.authenticate,
        },
        async (request, reply) => {
            const parsed = buildingIdParamsSchema.safeParse(request.params);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid building id",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const items = await service.listPlacesForBuilding(parsed.data.id);
                return reply.send({ items });
            } catch (error) {
                if (error instanceof PlaceBuildingInactiveBuildingError) {
                    return reply.code(404).send({ message: "Building not found or inactive" });
                }

                throw error;
            }
        }
    );
};

export default placeBuildingRoutes;
