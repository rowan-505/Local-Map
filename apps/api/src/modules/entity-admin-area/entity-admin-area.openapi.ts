import type { FastifySchema } from "fastify";

import { Tags, badRequestSchema, bearerAuth } from "../../lib/openapi/common.js";

const inferResultSchema = {
    type: "object",
    required: [
        "admin_area_id",
        "canonical_name",
        "admin_level_code",
        "name_mm",
        "name_en",
        "geometry_contains",
    ],
    properties: {
        admin_area_id: { type: "string", nullable: true },
        canonical_name: { type: "string", nullable: true },
        admin_level_code: { type: "string", nullable: true },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        geometry_contains: { type: "boolean" },
        status: {
            type: "string",
            enum: ["valid_existing", "recommendation_found", "no_match", "invalid_geometry"],
        },
        message: { type: "string", nullable: true },
        currentAdminArea: {
            type: "object",
            nullable: true,
            properties: {
                id: { type: "string", nullable: true },
                name: { type: "string", nullable: true },
                level_code: { type: "string", nullable: true },
                is_active: { type: "boolean", nullable: true },
            },
            additionalProperties: false,
        },
        recommendedTownship: {
            type: "object",
            nullable: true,
            properties: {
                id: { type: "string" },
                name_mm: { type: "string", nullable: true },
                name_en: { type: "string", nullable: true },
                canonical_name: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
        recommendationMode: {
            type: "string",
            nullable: true,
            enum: ["single_overlap", "multi_overlap", "point_fallback", "nearest"],
        },
        intersectingTownships: {
            type: "array",
            items: {
                type: "object",
                required: ["id", "canonical_name", "name_mm", "name_en", "admin_level_code", "overlap_m", "overlap_pct"],
                properties: {
                    id: { type: "string" },
                    canonical_name: { type: "string" },
                    name_mm: { type: "string", nullable: true },
                    name_en: { type: "string", nullable: true },
                    admin_level_code: { type: "string" },
                    overlap_m: { type: "number" },
                    overlap_pct: { type: "number", nullable: true },
                },
                additionalProperties: false,
            },
        },
        commonParentAdminArea: {
            type: "object",
            nullable: true,
            properties: {
                id: { type: "string" },
                canonical_name: { type: "string" },
                admin_level_code: { type: "string" },
                name_mm: { type: "string", nullable: true },
                name_en: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
        debugReason: {
            type: "string",
            nullable: true,
            enum: ["invalid_geometry", "no_township_polygons", "outside_all_townships", "query_error"],
        },
        fallbackReason: {
            type: "string",
            nullable: true,
            enum: ["point_fallback", "nearest_township"],
        },
        nearestTownshipDistanceM: { type: "number", nullable: true },
    },
    additionalProperties: false,
} as const;

const validateManualResultSchema = {
    type: "object",
    required: [
        "valid",
        "geometry_contains",
        "inferred_admin_area_id",
        "admin_level_code",
        "message",
        "can_save_without_override",
    ],
    properties: {
        valid: { type: "boolean" },
        geometry_contains: { type: "boolean" },
        inferred_admin_area_id: { type: "string", nullable: true },
        admin_level_code: { type: "string", nullable: true },
        message: { type: "string", nullable: true },
        can_save_without_override: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

export const postEntityAdminAreaInferSchema = {
    tags: [Tags.AdminAreas],
    summary: "Infer township admin_area_id from entity geometry",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["kind"],
        properties: {
            kind: { type: "string", enum: ["place", "street", "building", "land_area", "bus_stop", "road"] },
            lat: { type: "number" },
            lng: { type: "number" },
            geometry: { type: "object", additionalProperties: true },
            current_admin_area_id: { type: "string" },
            entity_public_id: { type: "string" },
        },
        additionalProperties: false,
    },
    response: {
        200: inferResultSchema,
        400: badRequestSchema,
    },
} as const satisfies FastifySchema;

export const postEntityAdminAreaValidateManualSchema = {
    tags: [Tags.AdminAreas],
    summary: "Validate manual township admin_area_id against geometry",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["kind", "admin_area_id"],
        properties: {
            kind: { type: "string", enum: ["place", "street", "building", "land_area", "bus_stop", "road"] },
            admin_area_id: { type: "string" },
            lat: { type: "number" },
            lng: { type: "number" },
            geometry: { type: "object", additionalProperties: true },
        },
        additionalProperties: false,
    },
    response: {
        200: validateManualResultSchema,
        400: badRequestSchema,
    },
} as const satisfies FastifySchema;
