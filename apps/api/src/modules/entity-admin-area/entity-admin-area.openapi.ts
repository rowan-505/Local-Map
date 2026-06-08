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
            kind: { type: "string", enum: ["place", "street", "building", "road"] },
            lat: { type: "number" },
            lng: { type: "number" },
            geometry: { type: "object", additionalProperties: true },
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
            kind: { type: "string", enum: ["place", "street", "building", "road"] },
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
