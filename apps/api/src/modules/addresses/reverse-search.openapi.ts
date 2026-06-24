import type { FastifySchema } from "fastify";

import { badRequestSchema, messageSchema, Tags } from "../../lib/openapi/common.js";
import { REVERSE_SEARCH_CONFIDENCES } from "./reverse-search.service.js";

export const getReverseSearchSchema = {
    tags: [Tags.Search],
    summary: "Reverse geocode a point to a minimal address line",
    description:
        "Resolves a lat/lng to a single human-readable address line (nearest public place or street plus township/district/state hierarchy), a dynamically computed Plus Code, and a confidence level. Public, read-only. Plus Code is generated on demand and never stored.",
    querystring: {
        type: "object",
        required: ["lat", "lng"],
        properties: {
            lat: { type: "number", minimum: -90, maximum: 90 },
            lng: { type: "number", minimum: -180, maximum: 180 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["address_line", "plus_code", "lat", "lng", "confidence"],
            properties: {
                address_line: { type: "string" },
                plus_code: { type: ["string", "null"] },
                lat: { type: "number" },
                lng: { type: "number" },
                confidence: { type: "string", enum: [...REVERSE_SEARCH_CONFIDENCES] },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        500: messageSchema,
    },
} satisfies FastifySchema;
