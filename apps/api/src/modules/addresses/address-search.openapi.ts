import type { FastifySchema } from "fastify";

import { Tags } from "../../lib/openapi/common.js";

const searchResultSchema = {
    type: "object",
    required: ["address_id", "language_code", "search_text", "display_address", "rank_score", "match_priority"],
    properties: {
        address_id: { type: "string", description: "core.core_addresses.public_id (UUID)" },
        language_code: { type: "string", enum: ["en", "my", "und"] },
        search_text: { type: "string" },
        display_address: { type: "string" },
        house_number: { type: ["string", "null"] },
        street_text: { type: ["string", "null"] },
        admin_text: { type: ["string", "null"] },
        postcode: { type: ["string", "null"] },
        rank_score: { type: "number" },
        match_priority: { type: "number", description: "Lower is better (0 = exact house/postcode)" },
        point_geom: { description: "GeoJSON Point or null" },
    },
} as const;

export const getAddressSearchSchema = {
    tags: [Tags.Search],
    summary: "Search addresses by partial text",
    description:
        "Queries generated search.address_index rows (not core tables directly). Supports ILIKE partial match with simple priority for house number, postcode, and street.",
    querystring: {
        type: "object",
        required: ["q"],
        properties: {
            q: { type: "string", minLength: 1, maxLength: 200 },
            lang: { type: "string", enum: ["en", "my"], default: "en" },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
            admin_area_id: {
                type: "string",
                description: "Optional core.core_admin_areas.id filter",
            },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["q", "lang", "count", "results"],
            properties: {
                q: { type: "string" },
                lang: { type: "string" },
                count: { type: "integer" },
                results: { type: "array", items: searchResultSchema },
            },
        },
        400: {
            type: "object",
            properties: {
                message: { type: "string" },
                issues: { type: "object" },
            },
        },
    },
} satisfies FastifySchema;
