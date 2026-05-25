import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    geoJsonFeatureCollectionSchema,
    notFoundSchema,
} from "../../lib/openapi/common.js";

const publicPlaceSchema = {
    type: "object",
    required: [
        "id",
        "publicId",
        "myanmar_name",
        "english_name",
        "name_mm",
        "name_en",
        "display_name",
        "primary_name",
        "categoryId",
        "categoryCode",
        "category_name",
        "categoryName",
        "lat",
        "lng",
        "importanceScore",
        "isVerified",
    ],
    properties: {
        id: { type: "string" },
        publicId: { type: "string", format: "uuid" },
        myanmar_name: { type: "string", nullable: true },
        english_name: { type: "string", nullable: true },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        display_name: { type: "string", nullable: true },
        primary_name: { type: "string", nullable: true },
        categoryId: { type: "string" },
        categoryCode: { type: "string", nullable: true },
        category_name: { type: "string", nullable: true },
        categoryName: { type: "string", nullable: true },
        lat: { type: "number", nullable: true },
        lng: { type: "number", nullable: true },
        importanceScore: { type: "number", nullable: true },
        isVerified: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

const publicMapPlaceFeatureSchema = {
    type: "object",
    required: ["type", "id", "geometry", "properties"],
    properties: {
        type: { type: "string", enum: ["Feature"] },
        id: { type: "string", format: "uuid" },
        geometry: {
            type: "object",
            required: ["type", "coordinates"],
            properties: {
                type: { type: "string", enum: ["Point"] },
                coordinates: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
            },
            additionalProperties: false,
        },
        properties: {
            type: "object",
            required: [
                "id",
                "public_id",
                "publicId",
                "display_name",
                "primary_name",
                "name",
                "name_mm",
                "name_en",
                "category_code",
                "category_name",
                "categoryCode",
                "categoryName",
                "importance_score",
                "importanceScore",
                "is_verified",
                "isVerified",
                "lat",
                "lng",
            ],
            properties: {
                id: { type: "string" },
                public_id: { type: "string", format: "uuid" },
                publicId: { type: "string", format: "uuid" },
                display_name: { type: "string", nullable: true },
                primary_name: { type: "string", nullable: true },
                name: { type: "string" },
                name_mm: { type: "string", nullable: true },
                name_en: { type: "string", nullable: true },
                category_code: { type: "string", nullable: true },
                category_name: { type: "string", nullable: true },
                categoryCode: { type: "string", nullable: true },
                categoryName: { type: "string", nullable: true },
                importance_score: { type: "number", nullable: true },
                importanceScore: { type: "number", nullable: true },
                is_verified: { type: "boolean" },
                isVerified: { type: "boolean" },
                lat: { type: "number" },
                lng: { type: "number" },
            },
            additionalProperties: false,
        },
    },
    additionalProperties: false,
} as const;

const publicMapPlacesFeatureCollectionSchema = {
    type: "object",
    required: ["type", "features", "metadata"],
    properties: {
        type: { type: "string", enum: ["FeatureCollection"] },
        features: { type: "array", items: publicMapPlaceFeatureSchema },
        metadata: {
            type: "object",
            required: ["count", "limit", "offset", "has_more", "bbox", "zoom"],
            properties: {
                count: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1, maximum: 300 },
                offset: { type: "integer", minimum: 0 },
                has_more: { type: "boolean" },
                bbox: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
                zoom: { type: "number" },
                density_debug: {
                    type: "object",
                    required: ["zoom", "bbox", "threshold_used", "returned_count"],
                    properties: {
                        zoom: { type: "number" },
                        bbox: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
                        threshold_used: { type: "number", nullable: true },
                        returned_count: { type: "integer", minimum: 0 },
                    },
                    additionalProperties: false,
                },
            },
            additionalProperties: false,
        },
    },
    additionalProperties: false,
} as const;

const cameraTargetPointSchema = {
    type: "object",
    required: ["type", "center", "zoom"],
    properties: {
        type: { type: "string", enum: ["point"] },
        center: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
        zoom: { type: "number" },
    },
    additionalProperties: false,
} as const;

const cameraTargetBoundsSchema = {
    type: "object",
    required: ["type", "center", "zoom", "bbox", "padding"],
    properties: {
        type: { type: "string", enum: ["bounds"] },
        center: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
        zoom: { type: "number" },
        bbox: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        padding: { type: "number" },
    },
    additionalProperties: false,
} as const;

const searchHitSchema = {
    type: "object",
    required: [
        "id",
        "type",
        "myanmar_name",
        "english_name",
        "name_mm",
        "name_en",
        "display_name",
        "primary_name",
        "canonical_name",
        "subtitle",
        "categoryName",
        "lat",
        "lng",
        "cameraTarget",
    ],
    properties: {
        id: { type: "string" },
        type: { type: "string", description: "Result kind from server (e.g. place, street)" },
        myanmar_name: { type: "string", nullable: true },
        english_name: { type: "string", nullable: true },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        display_name: { type: "string", nullable: true },
        primary_name: { type: "string", nullable: true },
        canonical_name: { type: "string", nullable: true },
        subtitle: { type: "string", nullable: true },
        categoryName: { type: "string", nullable: true },
        lat: { type: "number", nullable: true },
        lng: { type: "number", nullable: true },
        cameraTarget: { oneOf: [cameraTargetPointSchema, cameraTargetBoundsSchema] },
    },
    additionalProperties: false,
} as const;

const publicCategorySchema = {
    type: "object",
    required: ["id", "code", "name", "nameLocal", "iconKey", "sortOrder"],
    properties: {
        id: { type: "string" },
        code: { type: "string" },
        name: { type: "string" },
        nameLocal: { type: "string", nullable: true },
        iconKey: { type: "string", nullable: true },
        sortOrder: { type: "number" },
    },
    additionalProperties: false,
} as const;

export const getPublicPlacesSchema = {
    tags: [Tags.Places],
    summary: "List public places",
    description: "Unauthenticated list for the public map (filtered, limited).",
    querystring: {
        type: "object",
        properties: {
            q: { type: "string", minLength: 1 },
            category: { type: "string", minLength: 1 },
            categoryId: { type: "string", pattern: "^\\d+$" },
            limit: { type: "integer", minimum: 1, maximum: 1000, default: 200 },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "array", items: publicPlaceSchema },
        400: badRequestSchema,
    },
} satisfies FastifySchema;

export const getPublicPlaceByIdSchema = {
    tags: [Tags.Places],
    summary: "Get public place",
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", format: "uuid" } },
        additionalProperties: false,
    },
    response: {
        200: publicPlaceSchema,
        400: badRequestSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const getPublicMapPlacesSchema = {
    tags: [Tags.Places],
    summary: "List public places in a map viewport",
    description: "GeoJSON FeatureCollection of lightweight public place points inside the requested bbox.",
    querystring: {
        type: "object",
        required: ["bbox", "zoom"],
        properties: {
            bbox: {
                type: "string",
                pattern: "^-?\\d+(?:\\.\\d+)?,-?\\d+(?:\\.\\d+)?,-?\\d+(?:\\.\\d+)?,-?\\d+(?:\\.\\d+)?$",
                description: "minLng,minLat,maxLng,maxLat",
            },
            zoom: { type: "number", minimum: 0, maximum: 24 },
            category: { type: "string", minLength: 1 },
            limit: { type: "integer", minimum: 1, maximum: 300, default: 100 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
        additionalProperties: false,
    },
    response: {
        200: publicMapPlacesFeatureCollectionSchema,
        400: badRequestSchema,
    },
} satisfies FastifySchema;

export const getPublicCategoriesSchema = {
    tags: [Tags.Categories],
    summary: "List public categories",
    description: "Categories exposed to the web client.",
    response: {
        200: { type: "array", items: publicCategorySchema },
    },
} satisfies FastifySchema;

export const getPublicSearchSchema = {
    tags: [Tags.Search],
    summary: "Public search",
    querystring: {
        type: "object",
        required: ["q"],
        properties: {
            q: { type: "string", minLength: 1 },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "array", items: searchHitSchema },
        400: badRequestSchema,
    },
} satisfies FastifySchema;

export const getPublicGeoStreetsSchema = {
    tags: [Tags.Streets],
    summary: "Street centerlines GeoJSON",
    description: "GeoJSON FeatureCollection for map rendering.",
    response: {
        200: geoJsonFeatureCollectionSchema,
    },
} satisfies FastifySchema;

export const getPublicGeoAdminAreasSchema = {
    tags: [Tags.AdminAreas],
    summary: "Admin area boundaries GeoJSON",
    response: {
        200: geoJsonFeatureCollectionSchema,
    },
} satisfies FastifySchema;

export const getPublicGeoBusStopsSchema = {
    tags: [Tags.Transit],
    summary: "Bus stops GeoJSON",
    response: {
        200: geoJsonFeatureCollectionSchema,
    },
} satisfies FastifySchema;

export const getPublicGeoBusRoutesSchema = {
    tags: [Tags.Transit],
    summary: "Bus routes GeoJSON",
    response: {
        200: geoJsonFeatureCollectionSchema,
    },
} satisfies FastifySchema;
