import type { FastifySchema } from "fastify";

import { bearerAuth, messageSchema, Tags } from "../../lib/openapi/common.js";

const serverErrorMessageSchema = messageSchema;

const refLanduseClassRowSchema = {
    type: "object",
    required: ["id", "code", "name_en", "name_mm", "parent_id", "sort_order", "min_zoom", "is_active"],
    properties: {
        id: { type: "string" },
        code: { type: "string" },
        name_en: { type: "string" },
        name_mm: { type: "string", nullable: true },
        parent_id: { type: "string", nullable: true },
        sort_order: { type: "number", nullable: true },
        min_zoom: { type: "number", nullable: true },
        is_active: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

export const getRefLanduseClassesSchema = {
    tags: [Tags.Ref],
    summary: "List active landuse classes",
    security: [...bearerAuth],
    response: {
        200: { type: "array", items: refLanduseClassRowSchema },
        401: messageSchema,
        500: serverErrorMessageSchema,
    },
} satisfies FastifySchema;

const refBoundaryStatusRowSchema = {
    type: "object",
    required: [
        "id",
        "code",
        "name_en",
        "name_mm",
        "helper_en",
        "helper_mm",
        "sort_order",
        "default_is_official_boundary",
        "default_boundary_confidence_score",
        "default_address_usage_code",
        "is_active",
    ],
    properties: {
        id: { type: "string" },
        code: { type: "string" },
        name_en: { type: "string" },
        name_mm: { type: "string", nullable: true },
        helper_en: { type: "string", nullable: true },
        helper_mm: { type: "string", nullable: true },
        sort_order: { type: "number" },
        default_is_official_boundary: { type: "boolean" },
        default_boundary_confidence_score: { type: "number" },
        default_address_usage_code: { type: "string", nullable: true },
        is_active: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

const refAddressUsageTypeRowSchema = {
    type: "object",
    required: ["id", "code", "name_en", "name_mm", "helper_en", "helper_mm", "sort_order", "is_active"],
    properties: {
        id: { type: "string" },
        code: { type: "string" },
        name_en: { type: "string" },
        name_mm: { type: "string", nullable: true },
        helper_en: { type: "string", nullable: true },
        helper_mm: { type: "string", nullable: true },
        sort_order: { type: "number" },
        is_active: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

export const getRefBoundaryStatusesSchema = {
    tags: [Tags.Ref],
    summary: "List active admin area boundary statuses",
    security: [...bearerAuth],
    response: {
        200: { type: "array", items: refBoundaryStatusRowSchema },
        401: messageSchema,
        500: serverErrorMessageSchema,
    },
} satisfies FastifySchema;

export const getRefAddressUsageTypesSchema = {
    tags: [Tags.Ref],
    summary: "List active admin area address usage types",
    security: [...bearerAuth],
    response: {
        200: { type: "array", items: refAddressUsageTypeRowSchema },
        401: messageSchema,
        500: serverErrorMessageSchema,
    },
} satisfies FastifySchema;
