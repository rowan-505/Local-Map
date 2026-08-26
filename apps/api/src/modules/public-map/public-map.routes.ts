import type { FastifyPluginAsync } from "fastify";

import { ReverseSearchRepository } from "../addresses/reverse-search.repo.js";
import { ReverseSearchService } from "../addresses/reverse-search.service.js";
import { AdminAreasRepository } from "../admin-areas/admin-areas.repo.js";
import { TransportPublicService } from "../transport/transport-public.service.js";
import { PublicMapRepository } from "./public-map.repo.js";
import {
    PublicMapService,
    PublicPlaceNotFoundError,
    PublicSearchUnavailableError,
    PublicTransportStopNotFoundError,
    PublicTransportTerminalNotFoundError,
    planPublicSearch,
} from "./public-map.service.js";
import {
    PUBLIC_SEARCH_ENTITY_TYPES,
    publicAdminAreaIdParamsSchema,
    publicAdminAreaSearchQuerySchema,
    publicPlaceIdParamsSchema,
    publicMapPlacesQuerySchema,
    publicPlacesQuerySchema,
    publicSearchGeometryParamsSchema,
    publicSearchGeometryQuerySchema,
    publicSearchMapPreviewParamsSchema,
    publicSearchMapPreviewQuerySchema,
    publicSearchQuerySchema,
    searchResultClickAnalyticsBodySchema,
    publicTransportStopIdParamsSchema,
    publicTransportStopQuerySchema,
    publicTransportTerminalIdParamsSchema,
    publicTransportTerminalQuerySchema,
} from "./public-map.schema.js";
import {
    getPublicAdminAreaByIdSchema,
    getPublicAdminAreasSearchSchema,
    getPublicCategoriesSchema,
    getPublicGeoAdminAreasSchema,
    getPublicGeoBusRoutesSchema,
    getPublicGeoBusStopsSchema,
    getPublicMapPlacesSchema,
    getPublicGeoStreetsSchema,
    getPublicPlaceByIdSchema,
    getPublicPlacesSchema,
    getPublicSearchGeometrySchema,
    getPublicSearchMapPreviewSchema,
    getPublicSearchSchema,
    postSearchResultClickAnalyticsSchema,
    getPublicTransportStopByIdSchema,
    getPublicTransportTerminalByIdSchema,
} from "./public-map.openapi.js";
import {
    resolvePublicSearchFilters,
} from "./public-search-filters.js";
import {
    assertPublicSearchCursorMatchesRequest,
    decodePublicSearchCursor,
    InvalidPublicSearchCursorError,
    normalizePublicSearchCursorContext,
} from "./public-search-cursor.js";

function anonymousSessionKey(request: { headers: Record<string, unknown> }): string | null {
    const raw = request.headers["x-anonymous-id"];
    if (typeof raw !== "string") {
        return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

const publicMapRoutes: FastifyPluginAsync = async (app) => {
    const publicMapRepo = new PublicMapRepository(app.prisma);
    const reverseSearchService = new ReverseSearchService(new ReverseSearchRepository(app.prisma));
    const adminAreasRepo = new AdminAreasRepository(app.prisma);
    const transportPublicService = new TransportPublicService(app.prisma);
    const publicMapService = new PublicMapService(
        publicMapRepo,
        reverseSearchService,
        adminAreasRepo,
        transportPublicService,
    );

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

    app.get(
        "/public/transport/stops/:id",
        { schema: getPublicTransportStopByIdSchema },
        async (request, reply) => {
            const parsedParams = publicTransportStopIdParamsSchema.safeParse(request.params);

            if (!parsedParams.success) {
                return reply.code(400).send({
                    message: "Invalid public transport stop id",
                    issues: parsedParams.error.flatten(),
                });
            }

            const parsedQuery = publicTransportStopQuerySchema.safeParse(request.query);
            if (!parsedQuery.success) {
                return reply.code(400).send({
                    message: "Invalid public transport stop query",
                    issues: parsedQuery.error.flatten(),
                });
            }

            try {
                const stop = await publicMapService.getTransportStopById(parsedParams.data.id, {
                    lang: parsedQuery.data.lang,
                });
                return reply.send(stop);
            } catch (error) {
                if (error instanceof PublicTransportStopNotFoundError) {
                    return reply.code(404).send({
                        message: error.message,
                    });
                }

                throw error;
            }
        },
    );

    app.get(
        "/public/transport/terminals/:id",
        { schema: getPublicTransportTerminalByIdSchema },
        async (request, reply) => {
            const parsedParams = publicTransportTerminalIdParamsSchema.safeParse(request.params);

            if (!parsedParams.success) {
                return reply.code(400).send({
                    message: "Invalid public transport terminal id",
                    issues: parsedParams.error.flatten(),
                });
            }

            const parsedQuery = publicTransportTerminalQuerySchema.safeParse(request.query);
            if (!parsedQuery.success) {
                return reply.code(400).send({
                    message: "Invalid public transport terminal query",
                    issues: parsedQuery.error.flatten(),
                });
            }

            try {
                const terminal = await publicMapService.getTransportTerminalById(
                    parsedParams.data.id,
                    {
                        lang: parsedQuery.data.lang,
                    },
                );
                return reply.send(terminal);
            } catch (error) {
                if (error instanceof PublicTransportTerminalNotFoundError) {
                    return reply.code(404).send({
                        message: error.message,
                    });
                }

                throw error;
            }
        },
    );

    app.get("/public/map/places", { schema: getPublicMapPlacesSchema }, async (request, reply) => {
        const parsed = publicMapPlacesQuerySchema.safeParse(request.query);

        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid public map places query",
                issues: parsed.error.flatten(),
            });
        }

        const collection = await publicMapService.listViewportPlaces(parsed.data);
        if (process.env.NODE_ENV !== "production" && collection.metadata.density_debug) {
            request.log.debug(
                { publicMapPlacesDensity: collection.metadata.density_debug },
                "Public map places density",
            );
        }
        return reply.send(collection);
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

        const q = parsed.data.q;
        const allowed = new Set<string>(PUBLIC_SEARCH_ENTITY_TYPES);
        const legacyTypes = (parsed.data.types ?? []).filter((t) => allowed.has(t));
        const filters = resolvePublicSearchFilters({
            category: parsed.data.category,
            transportType: parsed.data.transportType,
            transportMode: parsed.data.mode,
            legacyTypes,
        });
        const plan = planPublicSearch(q);

        let after;
        let cursorContext;
        if (parsed.data.cursor) {
            if (!plan.allowed) {
                return reply.code(400).send({ message: "Invalid search cursor" });
            }
            try {
                const decoded = decodePublicSearchCursor(parsed.data.cursor);
                cursorContext = normalizePublicSearchCursorContext({
                    q,
                    mode: plan.mode,
                    types: legacyTypes.length > 0 ? legacyTypes : [...filters.entityTypes],
                    lat: parsed.data.lat,
                    lng: parsed.data.lng,
                    category: filters.category,
                    transportType: filters.transportType,
                    transportMode: filters.transportMode,
                    lang: parsed.data.lang ?? null,
                });
                assertPublicSearchCursorMatchesRequest(decoded.ctx, cursorContext);
                after = decoded.after;
            } catch (error) {
                if (error instanceof InvalidPublicSearchCursorError) {
                    return reply.code(400).send({ message: error.message });
                }
                return reply.code(400).send({ message: "Invalid search cursor" });
            }
        }

        try {
            const results = await publicMapService.search(
                {
                    q,
                    limit: parsed.data.limit,
                    lat: parsed.data.lat,
                    lng: parsed.data.lng,
                    lang: parsed.data.lang,
                    types: legacyTypes,
                    category: parsed.data.category,
                    transportType: parsed.data.transportType,
                    transportMode: parsed.data.mode,
                    filters,
                    after,
                    cursorContext,
                    sessionKey: anonymousSessionKey(request),
                },
                request.log,
            );
            return reply.send(results);
        } catch (error) {
            if (error instanceof PublicSearchUnavailableError) {
                return reply.code(error.statusCode).send({
                    code: "SEARCH_TIMEOUT",
                    message: error.message,
                    retryable: true,
                });
            }
            throw error;
        }
    });

    app.post(
        "/public/search/analytics/clicks",
        { schema: postSearchResultClickAnalyticsSchema },
        async (request, reply) => {
            const parsed = searchResultClickAnalyticsBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid search click analytics payload",
                    issues: parsed.error.flatten(),
                });
            }

            publicMapService.recordSearchResultClick(
                {
                    searchCorrelationId: parsed.data.event_id,
                    entityType: parsed.data.entity_type,
                    entityId: parsed.data.entity_id,
                    clickedRank: parsed.data.clicked_rank,
                    timeToClickMs: parsed.data.time_to_click_ms,
                },
                request.log,
            );

            return reply.code(204).send();
        },
    );

    app.get(
        "/public/search/:entityType/:entityId/geometry",
        { schema: getPublicSearchGeometrySchema },
        async (request, reply) => {
            const parsedParams = publicSearchGeometryParamsSchema.safeParse(request.params);
            if (!parsedParams.success) {
                return reply.code(400).send({
                    message: "Invalid search geometry request",
                    issues: parsedParams.error.flatten(),
                });
            }

            const parsedQuery = publicSearchGeometryQuerySchema.safeParse(request.query);
            if (!parsedQuery.success) {
                return reply.code(400).send({
                    message: "Invalid search geometry query",
                    issues: parsedQuery.error.flatten(),
                });
            }

            const result = await publicMapService.getEntityGeometry(
                {
                    entityType: parsedParams.data.entityType,
                    entityId: parsedParams.data.entityId,
                    zoom: parsedQuery.data.zoom,
                },
                request.log,
            );

            if (!result) {
                return reply.code(404).send({ message: "Geometry not found" });
            }
            return reply.send(result);
        },
    );

    app.get(
        "/public/search/:entityType/:entityId/map-preview",
        { schema: getPublicSearchMapPreviewSchema },
        async (request, reply) => {
            const parsedParams = publicSearchMapPreviewParamsSchema.safeParse(request.params);
            if (!parsedParams.success) {
                return reply.code(400).send({
                    message: "Invalid search map-preview request",
                    issues: parsedParams.error.flatten(),
                });
            }

            const parsedQuery = publicSearchMapPreviewQuerySchema.safeParse(request.query);
            if (!parsedQuery.success) {
                return reply.code(400).send({
                    message: "Invalid search map-preview query",
                    issues: parsedQuery.error.flatten(),
                });
            }

            const result = await publicMapService.getTransportRouteMapPreview({
                entityType: parsedParams.data.entityType,
                entityId: parsedParams.data.entityId,
                zoom: parsedQuery.data.zoom,
            });

            if (!result) {
                return reply.code(404).send({ message: "Map preview not found" });
            }
            return reply.send(result);
        },
    );

    app.get(
        "/public/admin-areas/search",
        { schema: getPublicAdminAreasSearchSchema },
        async (request, reply) => {
            const parsed = publicAdminAreaSearchQuerySchema.safeParse(request.query);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid admin area search query",
                    issues: parsed.error.flatten(),
                });
            }

            const results = await publicMapService.searchAdminAreas({
                q: parsed.data.q,
                limit: parsed.data.limit,
            });
            return reply.send(results);
        },
    );

    app.get(
        "/public/admin-areas/:id",
        { schema: getPublicAdminAreaByIdSchema },
        async (request, reply) => {
            const parsed = publicAdminAreaIdParamsSchema.safeParse(request.params);

            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid admin area id",
                    issues: parsed.error.flatten(),
                });
            }

            const area = await publicMapService.getAdminAreaById(BigInt(parsed.data.id));
            if (!area) {
                return reply.code(404).send({ message: "Admin area not found" });
            }
            return reply.send(area);
        },
    );

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
