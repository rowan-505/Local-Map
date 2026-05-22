import type { FastifySchema } from "fastify";

import { Tags, badRequestSchema, bearerAuth, messageSchema } from "../../lib/openapi/common.js";

const adminAreaRowSchema = {
    type: "object",
    required: ["id", "parent_id", "admin_level_id", "canonical_name", "slug", "is_active"],
    properties: {
        id: { type: "string" },
        parent_id: { type: "string", nullable: true },
        admin_level_id: { type: "string" },
        canonical_name: { type: "string" },
        slug: { type: "string" },
        is_active: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

const adminAreaOptionRowSchema = {
    type: "object",
    required: [
        "id",
        "canonical_name",
        "name_mm",
        "name_en",
        "admin_level_id",
        "admin_level_code",
        "parent_id",
    ],
    properties: {
        id: { type: "string" },
        canonical_name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        admin_level_id: { type: "string" },
        admin_level_code: { type: "string" },
        admin_level_name: { type: "string", nullable: true },
        parent_id: { type: "string", nullable: true },
        parent_label: { type: "string", nullable: true },
        boundary_status: { type: "string", nullable: true },
        address_usage: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

export const getAdminAreasSchema = {
    tags: [Tags.AdminAreas],
    summary: "List admin areas",
    description: "Active administrative areas for dashboard pickers and filtering.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "array", items: adminAreaRowSchema },
        400: badRequestSchema,
        401: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminAreaOptionsSchema = {
    tags: [Tags.AdminAreas],
    summary: "Admin area picker options",
    description:
        "Active rows from core.core_admin_areas with Myanmar/English labels from core.core_admin_area_names (language my/mm and en).",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 2000, default: 500 },
            q: { type: "string", minLength: 1, maxLength: 200 },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "array", items: adminAreaOptionRowSchema },
        400: badRequestSchema,
        401: messageSchema,
    },
} satisfies FastifySchema;
