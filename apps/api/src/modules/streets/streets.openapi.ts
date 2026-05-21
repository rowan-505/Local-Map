import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    forbiddenSchema,
    messageSchema,
    notFoundSchema,
} from "../../lib/openapi/common.js";

const coordPairSchema = {
    type: "array",
    items: { type: "number" },
    minItems: 2,
    maxItems: 2,
} as const;

const lineStringGeometrySchema = {
    type: "object",
    required: ["type", "coordinates"],
    properties: {
        type: { type: "string", enum: ["LineString"] },
        coordinates: { type: "array", items: coordPairSchema, minItems: 2 },
    },
    additionalProperties: false,
} as const;

const streetNameRowSchema = {
    type: "object",
    required: ["id", "name", "language_code", "script_code", "name_type", "is_primary"],
    properties: {
        id: { type: "string" },
        name: { type: "string" },
        language_code: { type: "string", nullable: true },
        script_code: { type: "string", nullable: true },
        name_type: { type: "string" },
        is_primary: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

/** Dashboard may return MultiLineString from legacy data; API types focus on LineString. */
const streetGeometrySchema = {
    oneOf: [
        lineStringGeometrySchema,
        {
            type: "object",
            required: ["type", "coordinates"],
            properties: {
                type: { type: "string", enum: ["MultiLineString"] },
                coordinates: {
                    type: "array",
                    items: { type: "array", items: coordPairSchema, minItems: 2 },
                    minItems: 1,
                },
            },
            additionalProperties: false,
        },
    ],
} as const;

const streetRowSchema = {
    type: "object",
    required: [
        "public_id",
        "canonical_name",
        "admin_area_id",
        "admin_area_name",
        "road_class_id",
        "road_class",
        "road_class_name",
        "surface",
        "is_oneway",
        "bridge",
        "tunnel",
        "manual_override",
        "edit_status",
        "routing_status",
        "deleted_at",
        "last_edited_at",
        "is_active",
        "is_verified",
        "created_at",
        "updated_at",
        "geometry",
        "names",
        "myanmarName",
        "englishName",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        canonical_name: { type: "string", nullable: true },
        admin_area_id: { type: "string", nullable: true },
        admin_area_name: { type: "string", nullable: true },
        source_type_id: { type: "string", nullable: true },
        road_class_id: { type: "string", nullable: true },
        road_class: { type: "string", nullable: true },
        road_class_name: { type: "string", nullable: true },
        surface: { type: "string", nullable: true },
        is_oneway: { type: "boolean" },
        bridge: { type: "boolean" },
        tunnel: { type: "boolean" },
        manual_override: { type: "boolean" },
        edit_status: { type: "string" },
        routing_status: { type: "string" },
        deleted_at: { type: "string", format: "date-time", nullable: true },
        last_edited_at: { type: "string", format: "date-time", nullable: true },
        is_active: { type: "boolean" },
        is_verified: { type: "boolean" },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        geometry: { oneOf: [streetGeometrySchema, { type: "null" }] },
        names: { type: "array", items: streetNameRowSchema },
        myanmarName: { type: "string", nullable: true },
        englishName: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const roadClassSchema = {
    type: "object",
    required: ["id", "code", "name", "rank"],
    properties: {
        id: { type: "string" },
        code: { type: "string" },
        name: { type: "string" },
        rank: { type: "number" },
    },
    additionalProperties: false,
} as const;

const nearestPointHitSchema = {
    type: "object",
    required: ["street_id", "nearest", "distance_m", "street_name", "road_class"],
    properties: {
        street_id: { type: "string", format: "uuid" },
        nearest: {
            type: "object",
            required: ["lng", "lat"],
            properties: { lng: { type: "number" }, lat: { type: "number" } },
            additionalProperties: false,
        },
        distance_m: { type: "number" },
        street_name: { type: "string", nullable: true },
        road_class: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const connectionSchema = {
    oneOf: [
        { type: "null" },
        {
            type: "object",
            required: ["streetId", "nearest", "distanceM", "streetName", "roadClass"],
            properties: {
                streetId: { type: "string", format: "uuid" },
                nearest: {
                    type: "object",
                    required: ["lng", "lat"],
                    properties: { lng: { type: "number" }, lat: { type: "number" } },
                    additionalProperties: false,
                },
                distanceM: { type: "number" },
                streetName: { type: "string", nullable: true },
                roadClass: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
    ],
} as const;

const crossingHitSchema = {
    type: "object",
    required: ["streetId", "streetName", "roadClass"],
    properties: {
        streetId: { type: "string", format: "uuid" },
        streetName: { type: "string", nullable: true },
        roadClass: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const duplicateHitSchema = {
    type: "object",
    required: ["streetId", "streetName", "roadClass", "kind"],
    properties: {
        streetId: { type: "string", format: "uuid" },
        streetName: { type: "string", nullable: true },
        roadClass: { type: "string", nullable: true },
        kind: { type: "string", enum: ["overlap", "near_duplicate"] },
    },
    additionalProperties: false,
} as const;

const validateGeometryResponseSchema = {
    type: "object",
    required: ["isValid", "errors", "warnings", "startConnection", "endConnection", "crossings", "duplicates"],
    properties: {
        isValid: { type: "boolean" },
        errors: { type: "array", items: { type: "string" } },
        warnings: { type: "array", items: { type: "string" } },
        startConnection: connectionSchema,
        endConnection: connectionSchema,
        crossings: { type: "array", items: crossingHitSchema },
        duplicates: { type: "array", items: duplicateHitSchema },
    },
    additionalProperties: false,
} as const;

const splitStreetResponseSchema = {
    type: "object",
    required: ["originalStreetId", "newStreets", "streets"],
    properties: {
        originalStreetId: { type: "string", format: "uuid" },
        newStreets: { type: "array", items: streetRowSchema, minItems: 2, maxItems: 2 },
        streets: { type: "array", items: streetRowSchema, minItems: 2, maxItems: 2 },
    },
    additionalProperties: false,
} as const;

const streetsListQuery = {
    type: "object",
    properties: {
        q: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        sortBy: { type: "string", enum: ["name", "admin_area", "created", "updated", "updated_at"], default: "updated_at" },
        sortOrder: { type: "string", enum: ["asc", "desc"], default: "desc" },
        include_deleted: { type: "boolean", default: false },
    },
    additionalProperties: false,
} as const;

const nearestPointQuery = {
    type: "object",
    required: ["lat", "lng"],
    properties: {
        lat: { type: "number", minimum: -90, maximum: 90 },
        lng: { type: "number", minimum: -180, maximum: 180 },
        radiusMeters: { type: "number", exclusiveMinimum: 0, maximum: 500, default: 50 },
        excludePublicId: { type: "string", format: "uuid" },
    },
    additionalProperties: false,
} as const;

const validateGeometryBodySchema = {
    type: "object",
    required: ["geometry"],
    properties: {
        geometry: lineStringGeometrySchema,
        streetId: {
            oneOf: [
                { type: "string", format: "uuid" },
                { type: "string", pattern: "^\\d+$" },
                { type: "integer", minimum: 1 },
            ],
        },
        toleranceMeters: { type: "number", exclusiveMinimum: 0, maximum: 500, default: 10 },
        street_id: { type: "string", format: "uuid", description: "Deprecated" },
    },
    additionalProperties: false,
} as const;

const createStreetBodyOpenApi = {
    type: "object",
    required: ["road_class_id", "geometry"],
    properties: {
        myanmarName: { type: "string" },
        englishName: { type: "string" },
        road_class_id: { type: "string", description: "Bigint as string" },
        is_oneway: { type: "boolean", default: false },
        surface: { type: "string", nullable: true },
        admin_area_id: { type: "string", nullable: true },
        adminAreaId: { type: "string", nullable: true },
        source_type_id: { type: "string", nullable: true },
        sourceTypeId: { type: "string", nullable: true },
        geometry: lineStringGeometrySchema,
        is_active: { type: "boolean" },
        bridge: { type: "boolean", default: false },
        tunnel: { type: "boolean", default: false },
    },
    additionalProperties: false,
} as const;

const updateStreetBodyOpenApi = {
    type: "object",
    minProperties: 1,
    properties: {
        myanmarName: { type: "string" },
        englishName: { type: "string" },
        geometry: lineStringGeometrySchema,
        road_class_id: { type: "string", nullable: true },
        roadClassId: { type: "string", nullable: true },
        is_oneway: { type: "boolean" },
        isOneway: { type: "boolean" },
        surface: { type: "string", nullable: true },
        admin_area_id: { type: "string", nullable: true },
        adminAreaId: { type: "string", nullable: true },
        edit_reason: { type: "string", maxLength: 500 },
        bridge: { type: "boolean" },
        tunnel: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

const splitStreetBodyOpenApi = {
    type: "object",
    properties: {
        point: {
            type: "object",
            required: ["lat", "lng"],
            properties: { lat: { type: "number" }, lng: { type: "number" } },
            additionalProperties: false,
        },
        editReason: { type: "string", maxLength: 500 },
        split_point: {
            type: "object",
            required: ["type", "coordinates"],
            properties: {
                type: { type: "string", enum: ["Point"] },
                coordinates: coordPairSchema,
            },
            additionalProperties: false,
        },
        edit_reason: { type: "string", maxLength: 500 },
    },
    additionalProperties: false,
} as const;

const streetUuidParam = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
    additionalProperties: false,
} as const;

const splitStreetIdParam = {
    type: "object",
    required: ["id"],
    properties: {
        id: {
            oneOf: [{ type: "string", format: "uuid" }, { type: "string", pattern: "^\\d+$" }],
        },
    },
    additionalProperties: false,
} as const;

const deleteStreetBodyOpenApi = {
    type: "object",
    properties: {
        edit_reason: { type: "string", maxLength: 500 },
    },
    additionalProperties: false,
} as const;

export const getRoadClassesSchema = {
    tags: [Tags.Streets],
    summary: "List road classes",
    security: [...bearerAuth],
    response: {
        200: { type: "array", items: roadClassSchema },
        401: messageSchema,
    },
} satisfies FastifySchema;

export const getStreetsListSchema = {
    tags: [Tags.Streets],
    summary: "List streets (dashboard)",
    security: [...bearerAuth],
    querystring: streetsListQuery,
    response: {
        200: { type: "array", items: streetRowSchema },
        400: badRequestSchema,
        401: messageSchema,
    },
} satisfies FastifySchema;

export const getStreetsNearestPointSchema = {
    tags: [Tags.Streets],
    summary: "Nearest point on a street",
    description: "Snap helper within a search radius (meters).",
    security: [...bearerAuth],
    querystring: nearestPointQuery,
    response: {
        200: { oneOf: [nearestPointHitSchema, { type: "null" }] },
        400: badRequestSchema,
        401: messageSchema,
    },
} satisfies FastifySchema;

export const postStreetsValidateGeometrySchema = {
    tags: [Tags.Streets],
    summary: "Validate street geometry",
    description: "Topology checks against `core.core_streets`. Requires admin or editor.",
    security: [...bearerAuth],
    body: validateGeometryBodySchema,
    response: {
        200: validateGeometryResponseSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const getStreetByIdSchema = {
    tags: [Tags.Streets],
    summary: "Get street by public id",
    security: [...bearerAuth],
    params: streetUuidParam,
    response: {
        200: streetRowSchema,
        400: badRequestSchema,
        401: messageSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const postStreetsSchema = {
    tags: [Tags.Streets],
    summary: "Create street",
    security: [...bearerAuth],
    body: createStreetBodyOpenApi,
    response: {
        201: streetRowSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const patchStreetSchema = {
    tags: [Tags.Streets],
    summary: "Update street",
    security: [...bearerAuth],
    params: streetUuidParam,
    body: updateStreetBodyOpenApi,
    response: {
        200: streetRowSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const postStreetSplitSchema = {
    tags: [Tags.Streets],
    summary: "Split street at point",
    security: [...bearerAuth],
    params: splitStreetIdParam,
    body: splitStreetBodyOpenApi,
    response: {
        200: splitStreetResponseSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const deleteStreetSchema = {
    tags: [Tags.Streets],
    summary: "Soft-delete street",
    security: [...bearerAuth],
    params: streetUuidParam,
    body: deleteStreetBodyOpenApi,
    response: {
        200: streetRowSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;
