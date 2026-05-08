import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    forbiddenSchema,
    messageSchema,
    notFoundSchema,
} from "../../lib/openapi/common.js";

const placeNameRowSchema = {
    type: "object",
    required: ["id", "name", "language_code", "script_code", "name_type", "is_primary", "search_weight"],
    properties: {
        id: { type: "string" },
        name: { type: "string" },
        language_code: { type: "string", nullable: true },
        script_code: { type: "string", nullable: true },
        name_type: { type: "string" },
        is_primary: { type: "boolean" },
        search_weight: { type: "number" },
    },
    additionalProperties: false,
} as const;

const placeListItemSchema = {
    type: "object",
    required: [
        "id",
        "public_id",
        "primary_name",
        "secondary_name",
        "name_local",
        "myanmar_name",
        "english_name",
        "name_mm",
        "name_en",
        "display_name",
        "category_id",
        "category_name",
        "admin_area_id",
        "admin_area_name",
        "lat",
        "lng",
        "importance_score",
        "popularity_score",
        "confidence_score",
        "is_public",
        "is_verified",
        "source_type_id",
        "publish_status_id",
        "created_at",
        "updated_at",
        "names",
        "myanmarName",
        "englishName",
    ],
    properties: {
        id: { type: "string" },
        public_id: { type: "string", format: "uuid" },
        primary_name: { type: "string" },
        secondary_name: { type: "string", nullable: true },
        name_local: { type: "string", nullable: true },
        myanmar_name: { type: "string", nullable: true },
        english_name: { type: "string", nullable: true },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        display_name: { type: "string" },
        category_id: { type: "string" },
        category_name: { type: "string", nullable: true },
        admin_area_id: { type: "string", nullable: true },
        admin_area_name: { type: "string", nullable: true },
        lat: { type: "number", nullable: true },
        lng: { type: "number", nullable: true },
        importance_score: { type: "number", nullable: true },
        popularity_score: { type: "number", nullable: true },
        confidence_score: { type: "number", nullable: true },
        is_public: { type: "boolean" },
        is_verified: { type: "boolean" },
        source_type_id: { type: "string" },
        publish_status_id: { type: "string", nullable: true },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        names: { type: "array", items: placeNameRowSchema },
        myanmarName: { type: "string", nullable: true },
        englishName: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const placeDetailSchema = {
    type: "object",
    required: [
        "id",
        "public_id",
        "primary_name",
        "secondary_name",
        "name_local",
        "myanmar_name",
        "english_name",
        "name_mm",
        "name_en",
        "display_name",
        "category_id",
        "category_name",
        "admin_area_id",
        "admin_area_name",
        "lat",
        "lng",
        "importance_score",
        "popularity_score",
        "confidence_score",
        "is_public",
        "is_verified",
        "source_type_id",
        "publish_status_id",
        "created_at",
        "updated_at",
        "names",
        "myanmarName",
        "englishName",
        "plus_code",
        "current_version_id",
        "deleted_at",
    ],
    properties: {
        id: { type: "string" },
        public_id: { type: "string", format: "uuid" },
        primary_name: { type: "string" },
        secondary_name: { type: "string", nullable: true },
        name_local: { type: "string", nullable: true },
        myanmar_name: { type: "string", nullable: true },
        english_name: { type: "string", nullable: true },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        display_name: { type: "string" },
        category_id: { type: "string" },
        category_name: { type: "string", nullable: true },
        admin_area_id: { type: "string", nullable: true },
        admin_area_name: { type: "string", nullable: true },
        lat: { type: "number", nullable: true },
        lng: { type: "number", nullable: true },
        importance_score: { type: "number", nullable: true },
        popularity_score: { type: "number", nullable: true },
        confidence_score: { type: "number", nullable: true },
        is_public: { type: "boolean" },
        is_verified: { type: "boolean" },
        source_type_id: { type: "string" },
        publish_status_id: { type: "string", nullable: true },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        names: { type: "array", items: placeNameRowSchema },
        myanmarName: { type: "string", nullable: true },
        englishName: { type: "string", nullable: true },
        plus_code: { type: "string", nullable: true },
        current_version_id: { type: "string", nullable: true },
        deleted_at: { type: "string", format: "date-time", nullable: true },
    },
    additionalProperties: false,
} as const;

const createPlaceBodySchema = {
    type: "object",
    required: ["categoryId", "lat", "lng"],
    properties: {
        myanmarName: { type: "string", minLength: 1 },
        englishName: { type: "string", minLength: 1 },
        categoryId: { type: "string", description: "Bigint as string or integer" },
        adminAreaId: { type: "string", nullable: true },
        lat: { type: "number", minimum: -90, maximum: 90 },
        lng: { type: "number", minimum: -180, maximum: 180 },
        plusCode: { type: "string", nullable: true },
        importanceScore: { type: "number" },
        popularityScore: { type: "number" },
        confidenceScore: { type: "number" },
        isPublic: { type: "boolean" },
        isVerified: { type: "boolean" },
        sourceTypeId: { type: "string", nullable: true },
        publishStatusId: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const updatePlaceBodySchema = {
    type: "object",
    minProperties: 1,
    properties: {
        myanmarName: { type: "string" },
        englishName: { type: "string" },
        categoryId: { type: "string" },
        adminAreaId: { type: "string", nullable: true },
        lat: { type: "number", minimum: -90, maximum: 90 },
        lng: { type: "number", minimum: -180, maximum: 180 },
        plusCode: { type: "string", nullable: true },
        importanceScore: { type: "number" },
        popularityScore: { type: "number" },
        confidenceScore: { type: "number" },
        isPublic: { type: "boolean" },
        isVerified: { type: "boolean" },
        sourceTypeId: { type: "string", nullable: true },
        publishStatusId: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const placeFormOptionsSchema = {
    type: "object",
    required: ["categories", "admin_areas", "source_types", "publish_statuses"],
    properties: {
        categories: {
            type: "array",
            items: {
                type: "object",
                required: ["id", "label"],
                properties: { id: { type: "string" }, label: { type: "string" } },
                additionalProperties: false,
            },
        },
        admin_areas: {
            type: "array",
            items: {
                type: "object",
                required: ["id", "label"],
                properties: { id: { type: "string" }, label: { type: "string" } },
                additionalProperties: false,
            },
        },
        source_types: {
            type: "array",
            items: {
                type: "object",
                required: ["id", "code", "label"],
                properties: {
                    id: { type: "string" },
                    code: { type: "string" },
                    label: { type: "string" },
                },
                additionalProperties: false,
            },
        },
        publish_statuses: {
            type: "array",
            items: {
                type: "object",
                required: ["id", "code", "label"],
                properties: {
                    id: { type: "string" },
                    code: { type: "string" },
                    label: { type: "string" },
                },
                additionalProperties: false,
            },
        },
    },
    additionalProperties: false,
} as const;

const placeIdParams = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
    additionalProperties: false,
} as const;

const placesListQuery = {
    type: "object",
    properties: {
        q: { type: "string" },
        category: { type: "string" },
        is_public: { type: "boolean" },
        is_verified: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        offset: { type: "integer", minimum: 0, default: 0 },
        sortBy: {
            type: "string",
            enum: ["name", "category", "admin_area", "created", "updated", "updated_at"],
            default: "updated_at",
        },
        sortOrder: { type: "string", enum: ["asc", "desc"], default: "desc" },
    },
    additionalProperties: false,
} as const;

export const getPlacesSchema = {
    tags: [Tags.Places],
    summary: "List places",
    description: "Paginated place list for the dashboard (authenticated).",
    security: [...bearerAuth],
    querystring: placesListQuery,
    response: {
        200: { type: "array", items: placeListItemSchema },
        400: badRequestSchema,
        401: messageSchema,
    },
} satisfies FastifySchema;

export const getPlaceFormOptionsSchema = {
    tags: [Tags.Places],
    summary: "Place form reference options",
    description: "Dropdown values for create/edit place forms.",
    security: [...bearerAuth],
    response: {
        200: placeFormOptionsSchema,
        401: messageSchema,
    },
} satisfies FastifySchema;

export const getPlaceByIdSchema = {
    tags: [Tags.Places],
    summary: "Get place by id",
    security: [...bearerAuth],
    params: placeIdParams,
    response: {
        200: placeDetailSchema,
        400: badRequestSchema,
        401: messageSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const postPlacesSchema = {
    tags: [Tags.Places],
    summary: "Create place",
    description: "Requires admin or editor role. At least one of `myanmarName` or `englishName` must be provided.",
    security: [...bearerAuth],
    body: createPlaceBodySchema,
    response: {
        201: placeDetailSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const patchPlaceSchema = {
    tags: [Tags.Places],
    summary: "Update place",
    security: [...bearerAuth],
    params: placeIdParams,
    body: updatePlaceBodySchema,
    response: {
        200: placeDetailSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const deletePlaceSchema = {
    tags: [Tags.Places],
    summary: "Delete place",
    security: [...bearerAuth],
    params: placeIdParams,
    response: {
        200: {
            type: "object",
            required: ["success", "public_id"],
            properties: {
                success: { type: "boolean" },
                public_id: { type: "string", format: "uuid" },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;
