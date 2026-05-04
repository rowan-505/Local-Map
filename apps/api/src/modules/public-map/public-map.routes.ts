import type { FastifyPluginAsync } from "fastify";

import { PublicMapRepository } from "./public-map.repo.js";
import { PublicMapService, PublicPlaceNotFoundError } from "./public-map.service.js";
import {
    publicPlaceIdParamsSchema,
    publicPlacesQuerySchema,
    publicSearchQuerySchema,
} from "./public-map.schema.js";

const publicMapRoutes: FastifyPluginAsync = async (app) => {
    const publicMapRepo = new PublicMapRepository(app.prisma);
    const publicMapService = new PublicMapService(publicMapRepo);

    app.get("/public/places", async (request, reply) => {
        const parsed = publicPlacesQuerySchema.safeParse(request.query);

        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid public places query",
                issues: parsed.error.flatten(),
            });
        }

        const places = await publicMapService.listPlaces(parsed.data);
        return reply.send(places);
    });

    app.get("/public/places/:id", async (request, reply) => {
        const parsedParams = publicPlaceIdParamsSchema.safeParse(request.params);

        if (!parsedParams.success) {
            return reply.code(400).send({
                message: "Invalid public place id",
                issues: parsedParams.error.flatten(),
            });
        }

        try {
            const place = await publicMapService.getPlaceByPublicId(parsedParams.data.id);
            return reply.send(place);
        } catch (error) {
            if (error instanceof PublicPlaceNotFoundError) {
                return reply.code(404).send({
                    message: error.message,
                });
            }

            throw error;
        }
    });

    app.get("/public/categories", async (_request, reply) => {
        const categories = await publicMapService.listCategories();
        return reply.send(categories);
    });

    app.get("/public/search", async (request, reply) => {
        const parsed = publicSearchQuerySchema.safeParse(request.query);

        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid public search query",
                issues: parsed.error.flatten(),
            });
        }

        const results = await publicMapService.search(parsed.data);
        return reply.send(results);
    });

    app.get("/public/map/geo/streets", async (_request, reply) => {
        const collection = await publicMapService.geoJsonStreets();
        return reply.send(collection);
    });

    app.get("/public/map/geo/admin-areas", async (_request, reply) => {
        const collection = await publicMapService.geoJsonAdminAreas();
        return reply.send(collection);
    });

    app.get("/public/map/geo/bus-stops", async (_request, reply) => {
        const collection = await publicMapService.geoJsonBusStops();
        return reply.send(collection);
    });

    app.get("/public/map/geo/bus-routes", async (_request, reply) => {
        const collection = await publicMapService.geoJsonBusRoutes();
        return reply.send(collection);
    });
};

export default publicMapRoutes;
