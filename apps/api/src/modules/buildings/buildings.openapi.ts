import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    forbiddenSchema,
    messageSchema,
    notFoundSchema,
} from "../../lib/openapi/common.js";

const buildingTypeRefSchema = {
    type: "object",
    required: ["id", "code", "name", "name_mm", "parent_id"],
    properties: {
        id: { type: "string" },
        code: { type: "string" },
        name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        parent_id: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const adminAreaInlineSchema = {
    type: "object",
    required: ["id", "canonical_name", "slug"],
    properties: {
        id: { type: "string" },
        canonical_name: { type: "string" },
        slug: { type: "string" },
    },
    additionalProperties: false,
} as const;

const polygonGeometrySchema = {
    type: "object",
    required: ["type", "coordinates"],
    properties: {
        type: { type: "string", enum: ["Polygon"] },
        coordinates: {
            type: "array",
            items: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2 } },
            minItems: 1,
        },
    },
    additionalProperties: false,
} as const;

const multiPolygonGeometrySchema = {
    type: "object",
    required: ["type", "coordinates"],
    properties: {
        type: { type: "string", enum: ["MultiPolygon"] },
        coordinates: {
            type: "array",
            items: {
                type: "array",
                items: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2 } },
                minItems: 1,
            },
            minItems: 1,
        },
    },
    additionalProperties: false,
} as const;

const buildingGeometrySchema = { oneOf: [polygonGeometrySchema, multiPolygonGeometrySchema] } as const;

const buildingRowSchema = {
    type: "object",
    required: [
        "id",
        "public_id",
        "source_staging_id",
        "external_id",
        "name",
        "building_type_id",
        "building_type",
        "building_type_code",
        "building_type_name",
        "building_type_name_mm",
        "admin_area_id",
        "admin_area",
        "class_code",
        "normalized_data",
        "source_refs",
        "levels",
        "height_m",
        "area_m2",
        "confidence_score",
        "is_verified",
        "is_active",
        "created_at",
        "updated_at",
        "deleted_at",
        "geometry",
    ],
    properties: {
        id: { type: "string" },
        public_id: { type: "string", format: "uuid" },
        source_staging_id: { type: "string", nullable: true },
        external_id: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
        building_type_id: { type: "string", nullable: true },
        building_type: { oneOf: [buildingTypeRefSchema, { type: "null" }] },
        building_type_code: { type: "string", nullable: true },
        building_type_name: { type: "string", nullable: true },
        building_type_name_mm: { type: "string", nullable: true },
        admin_area_id: { type: "string", nullable: true },
        admin_area: { oneOf: [adminAreaInlineSchema, { type: "null" }] },
        class_code: { type: "string", nullable: true },
        normalized_data: {
            type: "object",
            nullable: true,
            description: "Pipeline metadata JSON",
            additionalProperties: true,
        },
        source_refs: {
            type: "object",
            nullable: true,
            description: "Provenance JSON",
            additionalProperties: true,
        },
        levels: { type: "integer", nullable: true },
        height_m: { type: "number", nullable: true },
        area_m2: { type: "number", nullable: true },
        confidence_score: { type: "number", nullable: true },
        is_verified: { type: "boolean" },
        is_active: { type: "boolean" },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        deleted_at: { type: "string", format: "date-time", nullable: true },
        geometry: { oneOf: [buildingGeometrySchema, { type: "null" }] },
    },
    additionalProperties: false,
} as const;

const validationIssueSchema = {
    type: "object",
    required: ["path", "message"],
    properties: {
        path: { type: "string" },
        message: { type: "string" },
    },
    additionalProperties: false,
} as const;

const buildingValidationErrorSchema = {
    type: "object",
    required: ["message"],
    properties: {
        message: { type: "string" },
        issues: { type: "array", items: validationIssueSchema },
    },
    additionalProperties: false,
} as const;

const buildingsListQuery = {
    type: "object",
    properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
        offset: { type: "integer", minimum: 0, default: 0 },
        q: { type: "string", minLength: 1 },
        sortBy: {
            type: "string",
            enum: ["name", "building_type", "admin_area", "created", "updated", "updated_at"],
            default: "updated_at",
        },
        sortOrder: { type: "string", enum: ["asc", "desc"], default: "desc" },
    },
    additionalProperties: false,
} as const;

const createBuildingBodyOpenApi = {
    type: "object",
    required: ["geometry"],
    properties: {
        geometry: buildingGeometrySchema,
        name: { type: "string", nullable: true },
        building_type: { type: "string", minLength: 1 },
        building_type_id: { type: "string", description: "Bigint id string" },
        admin_area_id: { type: "string" },
        levels: { type: "integer", minimum: 0 },
        height_m: { type: "number", minimum: 0 },
        confidence_score: { type: "number" },
        is_verified: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

const updateBuildingBodyOpenApi = {
    type: "object",
    minProperties: 1,
    properties: {
        geometry: buildingGeometrySchema,
        name: { type: "string", nullable: true },
        building_type: { type: "string", minLength: 1 },
        building_type_id: { type: "string", nullable: true },
        admin_area_id: { type: "string", nullable: true },
        levels: { type: "integer", minimum: 0, nullable: true },
        height_m: { type: "number", minimum: 0, nullable: true },
        confidence_score: { type: "number" },
        is_verified: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

const buildingTypeListRowSchema = {
    type: "object",
    required: ["id", "code", "name", "name_mm", "parent_id", "sort_order"],
    properties: {
        id: { type: "string" },
        code: { type: "string" },
        name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        parent_id: { type: "string", nullable: true },
        sort_order: { type: "number" },
    },
    additionalProperties: false,
} as const;

const buildingIdParam = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
    additionalProperties: false,
} as const;

const serverErrorMessageSchema = {
    type: "object",
    required: ["message"],
    properties: { message: { type: "string" } },
    additionalProperties: false,
} as const;

export const getBuildingTypesSchema = {
    tags: [Tags.Buildings],
    summary: "List building types",
    security: [...bearerAuth],
    response: {
        200: { type: "array", items: buildingTypeListRowSchema },
        401: messageSchema,
        500: serverErrorMessageSchema,
    },
} satisfies FastifySchema;

export const getBuildingsListSchema = {
    tags: [Tags.Buildings],
    summary: "List buildings",
    security: [...bearerAuth],
    querystring: buildingsListQuery,
    response: {
        200: { type: "array", items: buildingRowSchema },
        400: badRequestSchema,
        401: messageSchema,
        500: serverErrorMessageSchema,
    },
} satisfies FastifySchema;

export const getBuildingByIdSchema = {
    tags: [Tags.Buildings],
    summary: "Get building",
    security: [...bearerAuth],
    params: buildingIdParam,
    response: {
        200: buildingRowSchema,
        400: badRequestSchema,
        401: messageSchema,
        404: notFoundSchema,
        500: serverErrorMessageSchema,
    },
} satisfies FastifySchema;

export const postBuildingsSchema = {
    tags: [Tags.Buildings],
    summary: "Create building",
    security: [...bearerAuth],
    body: createBuildingBodyOpenApi,
    response: {
        201: buildingRowSchema,
        400: {
            oneOf: [badRequestSchema, buildingValidationErrorSchema],
        },
        401: messageSchema,
        403: forbiddenSchema,
        500: serverErrorMessageSchema,
    },
} satisfies FastifySchema;

export const patchBuildingSchema = {
    tags: [Tags.Buildings],
    summary: "Update building",
    security: [...bearerAuth],
    params: buildingIdParam,
    body: updateBuildingBodyOpenApi,
    response: {
        200: buildingRowSchema,
        400: {
            oneOf: [badRequestSchema, buildingValidationErrorSchema],
        },
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: serverErrorMessageSchema,
    },
} satisfies FastifySchema;

export const deleteBuildingSchema = {
    tags: [Tags.Buildings],
    summary: "Soft-delete building",
    security: [...bearerAuth],
    params: buildingIdParam,
    response: {
        200: {
            type: "object",
            required: ["ok", "deleted", "public_id"],
            properties: {
                ok: { type: "boolean" },
                deleted: { type: "boolean" },
                public_id: { type: "string", format: "uuid" },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        500: serverErrorMessageSchema,
    },
} satisfies FastifySchema;
