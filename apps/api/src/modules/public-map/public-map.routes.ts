import type { FastifyPluginAsync } from "fastify";

import { PublicMapRepository } from "./public-map.repo.js";
import { PublicMapService, PublicPlaceNotFoundError } from "./public-map.service.js";
import {
    publicPlaceIdParamsSchema,
    publicPlacesQuerySchema,
    publicSearchQuerySchema,
} from "./public-map.schema.js";
import {
    getPublicCategoriesSchema,
    getPublicGeoAdminAreasSchema,
    getPublicGeoBusRoutesSchema,
    getPublicGeoBusStopsSchema,
    getPublicGeoStreetsSchema,
    getPublicPlaceByIdSchema,
    getPublicPlacesSchema,
    getPublicSearchSchema,
} from "./public-map.openapi.js";

const publicMapRoutes: FastifyPluginAsync = async (app) => {
    const publicMapRepo = new PublicMapRepository(app.prisma);
    const publicMapService = new PublicMapService(publicMapRepo);

    app.get("/public/places", { schema: getPublicPlacesSchema }, async (request, reply) => {
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

    app.get("/public/places/:id", { schema: getPublicPlaceByIdSchema }, async (request, reply) => {
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

    app.get("/public/categories", { schema: getPublicCategoriesSchema }, async (_request, reply) => {
        const categories = await publicMapService.listCategories();
        return reply.send(categories);
    });

    app.get("/public/search", { schema: getPublicSearchSchema }, async (request, reply) => {
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

    app.get("/public/map/geo/streets", { schema: getPublicGeoStreetsSchema }, async (_request, reply) => {
        const collection = await publicMapService.geoJsonStreets();
        return reply.send(collection);
    });

    app.get("/public/map/geo/admin-areas", { schema: getPublicGeoAdminAreasSchema }, async (_request, reply) => {
        const collection = await publicMapService.geoJsonAdminAreas();
        return reply.send(collection);
    });

    app.get("/public/map/geo/bus-stops", { schema: getPublicGeoBusStopsSchema }, async (_request, reply) => {
        const collection = await publicMapService.geoJsonBusStops();
        return reply.send(collection);
    });

    app.get("/public/map/geo/bus-routes", { schema: getPublicGeoBusRoutesSchema }, async (_request, reply) => {
        const collection = await publicMapService.geoJsonBusRoutes();
        return reply.send(collection);
    });
};

export default publicMapRoutes;
