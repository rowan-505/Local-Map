import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    conflictSchema,
    forbiddenSchema,
    messageSchema,
    notFoundSchema,
} from "../../lib/openapi/common.js";

const relationTypeEnum = { type: "string", enum: ["inside", "entrance", "nearby", "compound"] } as const;

const buildingTypeRefInLinkSchema = {
    oneOf: [
        { type: "null" },
        {
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
        },
    ],
} as const;

const buildingInlineInLinkSchema = {
    type: "object",
    required: [
        "public_id",
        "name",
        "building_type_id",
        "building_type",
        "building_type_code",
        "building_type_name",
        "building_type_name_mm",
        "class_code",
        "area_m2",
        "admin_area",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        name: { type: "string", nullable: true },
        building_type_id: { type: "string", nullable: true },
        building_type: buildingTypeRefInLinkSchema,
        building_type_code: { type: "string", nullable: true },
        building_type_name: { type: "string", nullable: true },
        building_type_name_mm: { type: "string", nullable: true },
        class_code: { type: "string", nullable: true },
        area_m2: { type: "number", nullable: true },
        admin_area: {
            oneOf: [
                { type: "null" },
                {
                    type: "object",
                    required: ["id", "canonical_name", "slug"],
                    properties: {
                        id: { type: "string" },
                        canonical_name: { type: "string" },
                        slug: { type: "string" },
                    },
                    additionalProperties: false,
                },
            ],
        },
    },
    additionalProperties: false,
} as const;

const buildingLinkItemSchema = {
    type: "object",
    required: ["relation_type", "is_primary", "created_at", "building"],
    properties: {
        relation_type: relationTypeEnum,
        is_primary: { type: "boolean" },
        created_at: { type: "string", format: "date-time" },
        building: buildingInlineInLinkSchema,
    },
    additionalProperties: false,
} as const;

const placeInlineInLinkSchema = {
    type: "object",
    required: ["public_id", "primary_name", "display_name", "lat", "lng", "category_name"],
    properties: {
        public_id: { type: "string", format: "uuid" },
        primary_name: { type: "string", nullable: true },
        display_name: { type: "string", nullable: true },
        lat: { type: "number", nullable: true },
        lng: { type: "number", nullable: true },
        category_name: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const placeLinkItemSchema = {
    type: "object",
    required: ["relation_type", "is_primary", "created_at", "place"],
    properties: {
        relation_type: relationTypeEnum,
        is_primary: { type: "boolean" },
        created_at: { type: "string", format: "date-time" },
        place: placeInlineInLinkSchema,
    },
    additionalProperties: false,
} as const;

const linkCreateBodySchema = {
    type: "object",
    required: ["building_id"],
    properties: {
        building_id: { type: "string", format: "uuid" },
        relation_type: {
            type: "string",
            enum: ["inside", "entrance", "nearby", "compound"],
            default: "inside",
        },
        is_primary: { type: "boolean", default: false },
    },
    additionalProperties: false,
} as const;

const linkPatchBodySchema = {
    type: "object",
    minProperties: 1,
    properties: {
        relation_type: relationTypeEnum,
        is_primary: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

const placeWithBuildingListResponse = {
    type: "object",
    required: ["items"],
    properties: {
        items: { type: "array", items: buildingLinkItemSchema },
    },
    additionalProperties: false,
} as const;

const buildingWithPlaceListResponse = {
    type: "object",
    required: ["items"],
    properties: {
        items: { type: "array", items: placeLinkItemSchema },
    },
    additionalProperties: false,
} as const;

const linkedBuildingPayloadSchema = {
    type: "object",
    required: ["place_id", "relation_type", "is_primary", "created_at", "building"],
    properties: {
        place_id: { type: "string", format: "uuid" },
        relation_type: relationTypeEnum,
        is_primary: { type: "boolean" },
        created_at: { type: "string", format: "date-time" },
        building: buildingInlineInLinkSchema,
    },
    additionalProperties: false,
} as const;

const unlinkResponseSchema = {
    type: "object",
    required: ["ok", "place_id", "building_id"],
    properties: {
        ok: { type: "boolean" },
        place_id: { type: "string", format: "uuid" },
        building_id: { type: "string", format: "uuid" },
    },
    additionalProperties: false,
} as const;

const placeIdParamsOpenApi = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
    additionalProperties: false,
} as const;

const placeBuildingParamsOpenApi = {
    type: "object",
    required: ["id", "buildingId"],
    properties: {
        id: { type: "string", format: "uuid" },
        buildingId: { type: "string", format: "uuid" },
    },
    additionalProperties: false,
} as const;

export const getPlaceBuildingsSchema = {
    tags: [Tags.Places],
    summary: "List buildings linked to a place",
    security: [...bearerAuth],
    params: placeIdParamsOpenApi,
    response: {
        200: placeWithBuildingListResponse,
        400: badRequestSchema,
        401: messageSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const postPlaceBuildingLinkSchema = {
    tags: [Tags.Places],
    summary: "Link building to place",
    security: [...bearerAuth],
    params: placeIdParamsOpenApi,
    body: linkCreateBodySchema,
    response: {
        201: linkedBuildingPayloadSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

export const patchPlaceBuildingLinkSchema = {
    tags: [Tags.Places],
    summary: "Update place–building link",
    security: [...bearerAuth],
    params: placeBuildingParamsOpenApi,
    body: linkPatchBodySchema,
    response: {
        200: linkedBuildingPayloadSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const deletePlaceBuildingLinkSchema = {
    tags: [Tags.Places],
    summary: "Remove place–building link",
    security: [...bearerAuth],
    params: placeBuildingParamsOpenApi,
    response: {
        200: unlinkResponseSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const getBuildingPlacesSchema = {
    tags: [Tags.Places],
    summary: "List places linked to a building",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
        additionalProperties: false,
    },
    response: {
        200: buildingWithPlaceListResponse,
        400: badRequestSchema,
        401: messageSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;
