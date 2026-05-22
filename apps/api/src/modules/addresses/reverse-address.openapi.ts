import type { FastifySchema } from "fastify";

import { Tags } from "../../lib/openapi/common.js";

const reverseComponentSchema = {
    type: "object",
    required: ["component_type", "value", "language_code", "source"],
    properties: {
        component_type: { type: "string" },
        value: { type: "string" },
        language_code: { type: "string" },
        source: { type: "string" },
        source_id: { type: ["string", "null"] },
        confidence_score: { type: ["number", "null"] },
        match_type: { type: ["string", "null"] },
        boundary_status: { type: ["string", "null"] },
        address_usage: { type: ["string", "null"] },
    },
} as const;

const reverseMatchedSchema = {
    type: "object",
    properties: {
        address_id: { type: ["string", "null"] },
        building_id: { type: ["string", "null"] },
        place_id: { type: ["string", "null"] },
        street_id: { type: ["string", "null"] },
        admin_area_id: { type: ["string", "null"] },
    },
} as const;

const reverseResponseSchema = {
    type: "object",
    required: [
        "result_type",
        "confidence_score",
        "full_address_en",
        "full_address_my",
        "display_address",
        "components",
        "matched",
        "alternatives",
        "warnings",
    ],
    properties: {
        result_type: { type: "string" },
        confidence_score: { type: "number" },
        full_address_en: { type: ["string", "null"] },
        full_address_my: { type: ["string", "null"] },
        display_address: { type: ["string", "null"] },
        components: { type: "array", items: reverseComponentSchema },
        matched: reverseMatchedSchema,
        alternatives: { type: "array", items: { type: "object" } },
        warnings: { type: "array", items: { type: "string" } },
    },
} as const;

const reverseQuerySchema = {
    type: "object",
    required: ["lat", "lng"],
    properties: {
        lat: { type: "number", minimum: -90, maximum: 90 },
        lng: { type: "number", minimum: -180, maximum: 180 },
        lang: { type: "string", enum: ["en", "my"], default: "en" },
    },
} as const;

export const getReverseAddressSchema = {
    tags: [Tags.Search],
    summary: "Reverse geocode map click to best possible address",
    description:
        "Resolves a lat/lng to the best available address or partial address using core addresses, buildings, places, streets, and admin areas. Locality-hint villages are never promoted to official address lines.",
    querystring: reverseQuerySchema,
    response: {
        200: reverseResponseSchema,
        400: {
            type: "object",
            properties: {
                message: { type: "string" },
                issues: { type: "object" },
            },
        },
    },
} satisfies FastifySchema;

export const getReverseAddressDebugSchema = {
    tags: [Tags.Dashboard],
    summary: "Reverse geocode debug (admin)",
    description:
        "Same resolver as GET /addresses/reverse with candidate layers and decision reason. Requires dashboard authentication.",
    querystring: reverseQuerySchema,
    response: {
        200: {
            type: "object",
            required: ["debug"],
            properties: {
                ...reverseResponseSchema.properties,
                debug: {
                    type: "object",
                    required: ["lat", "lng", "lang", "decision_reason", "layers"],
                    properties: {
                        lat: { type: "number" },
                        lng: { type: "number" },
                        lang: { type: "string" },
                        decision_reason: { type: "string" },
                        layers: { type: "object" },
                    },
                },
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
