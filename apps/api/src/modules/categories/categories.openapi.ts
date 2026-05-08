import type { FastifySchema } from "fastify";

import { Tags, badRequestSchema } from "../../lib/openapi/common.js";

const categoryRowSchema = {
    type: "object",
    required: ["id", "code", "name", "name_mm", "sort_order"],
    properties: {
        id: { type: "string" },
        code: { type: "string" },
        name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        sort_order: { type: "number" },
    },
    additionalProperties: false,
} as const;

export const getCategoriesSchema = {
    tags: [Tags.Categories],
    summary: "List categories",
    description:
        "Public reference list of place categories. Query parameters are parsed but may not filter results until wired in the service.",
    querystring: {
        type: "object",
        properties: {
            parentId: { type: "string", description: "Optional category parent id (bigint as string)" },
            includePrivate: { type: "boolean" },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "array", items: categoryRowSchema },
        400: badRequestSchema,
    },
} satisfies FastifySchema;
