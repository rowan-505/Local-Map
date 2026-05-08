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
