import type { FastifySchema } from "fastify";

import { Tags, bearerAuth, messageSchema } from "../../lib/openapi/common.js";

const dashboardStatsResponseSchema = {
    type: "object",
    required: ["overview", "main", "metadata", "transit", "health"],
    properties: {
        overview: {
            type: "object",
            required: ["total_main_rows", "total_metadata_rows", "total_transit_rows"],
            properties: {
                total_main_rows: { type: "integer", minimum: 0 },
                total_metadata_rows: { type: "integer", minimum: 0 },
                total_transit_rows: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        main: {
            type: "object",
            required: [
                "places",
                "map_buildings",
                "streets",
                "admin_areas",
                "addresses",
            ],
            properties: {
                places: { type: "integer", minimum: 0 },
                map_buildings: { type: "integer", minimum: 0 },
                streets: { type: "integer", minimum: 0 },
                admin_areas: { type: "integer", minimum: 0 },
                addresses: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        metadata: {
            type: "object",
            required: [
                "place_names",
                "street_names",
                "admin_area_names",
                "place_contacts",
                "place_sources",
                "place_media",
                "place_versions",
            ],
            properties: {
                place_names: { type: "integer", minimum: 0 },
                street_names: { type: "integer", minimum: 0 },
                admin_area_names: { type: "integer", minimum: 0 },
                place_contacts: { type: "integer", minimum: 0 },
                place_sources: { type: "integer", minimum: 0 },
                place_media: { type: "integer", minimum: 0 },
                place_versions: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        transit: {
            type: "object",
            required: ["bus_routes", "bus_route_variants", "bus_stops", "bus_route_stops"],
            properties: {
                bus_routes: { type: "integer", minimum: 0 },
                bus_route_variants: { type: "integer", minimum: 0 },
                bus_stops: { type: "integer", minimum: 0 },
                bus_route_stops: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        health: {
            type: "object",
            required: [
                "places_active",
                "places_deleted",
                "places_verified",
                "places_unverified",
                "buildings_active",
                "buildings_deleted",
                "streets_active",
                "streets_inactive",
            ],
            properties: {
                places_active: { type: "integer", minimum: 0 },
                places_deleted: { type: "integer", minimum: 0 },
                places_verified: { type: "integer", minimum: 0 },
                places_unverified: { type: "integer", minimum: 0 },
                buildings_active: { type: "integer", minimum: 0 },
                buildings_deleted: { type: "integer", minimum: 0 },
                streets_active: { type: "integer", minimum: 0 },
                streets_inactive: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
    },
    additionalProperties: false,
} as const;

export const getDashboardStatsSchema = {
    tags: [Tags.Dashboard, Tags.Stats],
    summary: "Dashboard statistics",
    description: "Aggregated row counts for admin overview.",
    security: [...bearerAuth],
    response: {
        200: dashboardStatsResponseSchema,
        401: messageSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;
