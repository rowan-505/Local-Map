import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    geoJsonFeatureCollectionSchema,
    geoJsonGeometrySchema,
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

/** Detail-only: base public place plus on-demand reverse-address enrichment (never on list responses). */
const publicPlaceDetailSchema = {
    type: "object",
    required: publicPlaceSchema.required,
    properties: {
        ...publicPlaceSchema.properties,
        address_line: { type: "string" },
        plus_code: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const publicTransportStopRouteServingSchema = {
    type: "object",
    required: [
        "route_id",
        "route_public_id",
        "route_code",
        "public_name",
        "variant_id",
        "variant_public_id",
        "variant_code",
        "direction_name",
        "origin_name",
        "destination_name",
        "stop_sequence",
    ],
    properties: {
        route_id: { type: "string" },
        route_public_id: { type: "string", format: "uuid" },
        route_code: { type: "string" },
        public_name: { type: "string", nullable: true },
        variant_id: { type: "string" },
        variant_public_id: { type: "string", format: "uuid" },
        variant_code: { type: "string" },
        direction_name: { type: "string", nullable: true },
        origin_name: { type: "string", nullable: true },
        destination_name: { type: "string", nullable: true },
        stop_sequence: { type: "integer", minimum: 1 },
    },
    additionalProperties: false,
} as const;

const publicTransportStopNextPreviewItemSchema = {
    type: "object",
    required: [
        "stop_sequence",
        "id",
        "public_id",
        "display_name",
        "name",
        "name_mm",
        "name_en",
        "lat",
        "lng",
    ],
    properties: {
        stop_sequence: { type: "integer", minimum: 1 },
        id: { type: "string" },
        public_id: { type: "string", format: "uuid" },
        display_name: { type: "string" },
        name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        lat: { type: "number" },
        lng: { type: "number" },
    },
    additionalProperties: false,
} as const;

const publicTransportStopNextPreviewGroupSchema = {
    type: "object",
    required: [
        "route_id",
        "route_public_id",
        "route_code",
        "public_name",
        "variant_id",
        "variant_public_id",
        "variant_code",
        "direction_name",
        "destination_name",
        "current_stop_sequence",
        "stop_sequence",
        "next_stops",
        "stops",
    ],
    properties: {
        route_id: { type: "string" },
        route_public_id: { type: "string", format: "uuid" },
        route_code: { type: "string" },
        public_name: { type: "string", nullable: true },
        variant_id: { type: "string" },
        variant_public_id: { type: "string", format: "uuid" },
        variant_code: { type: "string" },
        direction_name: { type: "string", nullable: true },
        destination_name: { type: "string", nullable: true },
        current_stop_sequence: { type: "integer", minimum: 1 },
        stop_sequence: { type: "integer", minimum: 1 },
        next_stops: { type: "array", items: publicTransportStopNextPreviewItemSchema },
        stops: { type: "array", items: publicTransportStopNextPreviewItemSchema },
    },
    additionalProperties: false,
} as const;

const publicTransportStopDetailSchema = {
    type: "object",
    required: [
        "id",
        "publicId",
        "public_id",
        "name",
        "myanmar_name",
        "english_name",
        "name_mm",
        "name_en",
        "display_name",
        "primary_name",
        "stop_code",
        "mode",
        "stop_type",
        "admin_area_name",
        "lat",
        "lng",
        "coordinates",
        "isVerified",
        "verification_status",
        "status_label",
        "confidenceScore",
        "route_count",
        "routes_serving_this_stop",
        "next_stops_preview",
    ],
    properties: {
        id: { type: "string" },
        publicId: { type: "string", format: "uuid" },
        public_id: { type: "string", format: "uuid" },
        name: { type: "string" },
        myanmar_name: { type: "string", nullable: true },
        english_name: { type: "string", nullable: true },
        name_mm: { type: "string", nullable: true },
        name_my: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        name_und: { type: "string", nullable: true },
        display_name: { type: "string", nullable: true },
        primary_name: { type: "string", nullable: true },
        canonical_name: { type: "string", nullable: true },
        stop_code: { type: "string", nullable: true },
        mode: { type: "string" },
        stop_type: { type: "string", enum: ["bus_stop", "station", "terminal"] },
        admin_area_name: { type: "string", nullable: true },
        lat: { type: "number" },
        lng: { type: "number" },
        coordinates: {
            type: "array",
            items: { type: "number" },
            minItems: 2,
            maxItems: 2,
        },
        isVerified: { type: "boolean" },
        verification_status: { type: "string" },
        status_label: { type: "string" },
        confidenceScore: { type: "number", nullable: true },
        route_count: { type: "integer", minimum: 0 },
        routes_serving_this_stop: {
            type: "array",
            items: publicTransportStopRouteServingSchema,
        },
        next_stops_preview: {
            type: "array",
            items: publicTransportStopNextPreviewGroupSchema,
        },
        address_line: { type: "string" },
        plus_code: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const publicTransportTerminalDetailSchema = {
    type: "object",
    required: [
        "id",
        "publicId",
        "public_id",
        "entity_type",
        "name",
        "myanmar_name",
        "english_name",
        "name_mm",
        "name_en",
        "display_name",
        "primary_name",
        "terminal_code",
        "terminal_role",
        "mode",
        "admin_area_name",
        "lat",
        "lng",
        "coordinates",
        "isVerified",
        "verification_status",
        "status_label",
        "confidenceScore",
        "route_count",
        "routes_serving_this_stop",
    ],
    properties: {
        id: { type: "string" },
        publicId: { type: "string", format: "uuid" },
        public_id: { type: "string", format: "uuid" },
        entity_type: { type: "string", enum: ["terminal"] },
        name: { type: "string" },
        myanmar_name: { type: "string", nullable: true },
        english_name: { type: "string", nullable: true },
        name_mm: { type: "string", nullable: true },
        name_my: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        name_und: { type: "string", nullable: true },
        display_name: { type: "string", nullable: true },
        primary_name: { type: "string", nullable: true },
        canonical_name: { type: "string", nullable: true },
        terminal_code: { type: "string", nullable: true },
        terminal_role: { type: "string" },
        mode: { type: "string" },
        admin_area_name: { type: "string", nullable: true },
        lat: { type: "number" },
        lng: { type: "number" },
        coordinates: {
            type: "array",
            items: { type: "number" },
            minItems: 2,
            maxItems: 2,
        },
        isVerified: { type: "boolean" },
        verification_status: { type: "string" },
        status_label: { type: "string" },
        confidenceScore: { type: "number", nullable: true },
        route_count: { type: "integer", minimum: 0 },
        routes_serving_this_stop: {
            type: "array",
            items: publicTransportStopRouteServingSchema,
        },
        address_line: { type: "string" },
        plus_code: { type: "string", nullable: true },
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
    // A bounds target carries bbox + padding; `center` is optional (only present
    // when the row has a centroid) and there is no `zoom` (the map fits the bbox).
    required: ["type", "bbox", "padding"],
    properties: {
        type: { type: "string", enum: ["bounds"] },
        center: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
        bbox: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        padding: { type: "number" },
    },
    additionalProperties: false,
} as const;

const publicSearchVerificationSchema = {
    type: "object",
    required: [
        "isVerified",
        "confidenceScore",
        "boundaryConfidenceScore",
        "reviewStatus",
        "verificationStatus",
    ],
    properties: {
        isVerified: { type: "boolean" },
        confidenceScore: { type: "number", nullable: true },
        boundaryConfidenceScore: { type: "number", nullable: true },
        reviewStatus: { type: "string", nullable: true },
        verificationStatus: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const publicSearchCategorySummarySchema = {
    type: "object",
    required: ["code", "name"],
    properties: {
        code: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const publicSearchTransportSummarySchema = {
    type: "object",
    required: [
        "mode",
        "stopType",
        "routeCode",
        "parentRoutePublicId",
        "variantCode",
        "headsign",
        "directionName",
        "originName",
        "destinationName",
    ],
    properties: {
        mode: { type: "string", nullable: true },
        stopType: { type: "string", nullable: true },
        routeCode: { type: "string", nullable: true },
        parentRoutePublicId: { type: "string", nullable: true },
        variantCode: { type: "string", nullable: true },
        headsign: { type: "string", nullable: true },
        directionName: { type: "string", nullable: true },
        originName: { type: "string", nullable: true },
        destinationName: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const searchHitSchema = {
    type: "object",
    required: ["id", "entityType", "type", "displayName", "hasGeometry", "score", "verification"],
    properties: {
        id: { type: "string" },
        entityType: { type: "string" },
        type: { type: "string", description: "Alias of entityType (backward compat)" },
        entityId: { type: "string", nullable: true },
        publicId: { type: "string", nullable: true },
        displayName: { type: "string", nullable: true },
        subtitle: { type: "string", nullable: true },
        primaryNameMy: { type: "string", nullable: true },
        primaryNameEn: { type: "string", nullable: true },
        lat: { type: "number", nullable: true },
        lng: { type: "number", nullable: true },
        center: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, nullable: true },
        bbox: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4, nullable: true },
        geometryType: { type: "string", nullable: true },
        hasGeometry: { type: "boolean" },
        score: { type: "number" },
        verification: publicSearchVerificationSchema,
        category: { ...publicSearchCategorySummarySchema, nullable: true },
        transport: publicSearchTransportSummarySchema,
        cameraTarget: { oneOf: [cameraTargetPointSchema, cameraTargetBoundsSchema] },
        plusCode: {
            type: "object",
            properties: {
                code: { type: "string" },
                referenceRequired: { type: "boolean" },
                outsideServiceArea: { type: "boolean" },
                reason: { type: "string" },
            },
            additionalProperties: false,
        },
        coordinate: {
            type: "object",
            required: ["outsideServiceArea"],
            properties: {
                outsideServiceArea: { type: "boolean" },
            },
            additionalProperties: false,
        },
        reverse: {
            type: "object",
            nullable: true,
            properties: {
                nearbyName: { type: "string", nullable: true },
                nearbyType: { type: "string", nullable: true },
                nearbyDistanceM: { type: "number", nullable: true },
                township: { type: "string", nullable: true },
                district: { type: "string", nullable: true },
                regionState: { type: "string", nullable: true },
                country: { type: "string", nullable: true },
                confidence: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
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
        200: publicPlaceDetailSchema,
        400: badRequestSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const getPublicTransportStopByIdSchema = {
    tags: [Tags.Transit],
    summary: "Get public transport stop",
    description:
        "Unauthenticated stop detail for the public web map. Lookup accepts uuid public_id " +
        "or internal numeric id. Names resolve from transport.stop_names primary rows " +
        "(my/en/und) with optional ?lang=my|en|und for display_name. Includes routes serving " +
        "the stop and a short downstream stop preview per route variant (no route geometry).",
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: {
                type: "string",
                description: "Stop public_id (uuid) or internal numeric id",
            },
        },
        additionalProperties: false,
    },
    querystring: {
        type: "object",
        properties: {
            lang: {
                type: "string",
                enum: ["my", "en", "und"],
                description: "Preferred display language for name/display_name fields",
            },
        },
        additionalProperties: false,
    },
    response: {
        200: publicTransportStopDetailSchema,
        400: badRequestSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const getPublicTransportTerminalByIdSchema = {
    tags: [Tags.Transit],
    summary: "Get public transport terminal",
    description:
        "Unauthenticated terminal detail for the public web map. Lookup accepts uuid public_id " +
        "or internal numeric id. Names resolve from terminal name fields with optional " +
        "?lang=my|en|und for display_name. Includes routes serving the linked stop when " +
        "available (no route geometry).",
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: {
                type: "string",
                description: "Terminal public_id (uuid) or internal numeric id",
            },
        },
        additionalProperties: false,
    },
    querystring: {
        type: "object",
        properties: {
            lang: {
                type: "string",
                enum: ["my", "en", "und"],
                description: "Preferred display language for name/display_name fields",
            },
        },
        additionalProperties: false,
    },
    response: {
        200: publicTransportTerminalDetailSchema,
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
    description:
        "Unified public search over the search index (search.search_documents). " +
        "Matches places, grouped streets (street_group), admin areas, addresses, " +
        "bus stops/routes, buildings, water and land areas. Streets are returned as one " +
        "logical road per result, not per segment. A Plus Code query is decoded to a " +
        "point; a short Plus Code requires lat/lng (map center or user location) to " +
        "expand, otherwise referenceRequired is returned.",
    querystring: {
        type: "object",
        required: ["q"],
        properties: {
            q: { type: "string", minLength: 1 },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            cursor: {
                type: "string",
                minLength: 1,
                description:
                    "Opaque continuation cursor from a previous response nextCursor. " +
                    "Must be reused with the same q, filters, types, and reference location.",
            },
            category: {
                type: "string",
                enum: ["all", "places", "areas", "roads", "transport", "addresses"],
                default: "all",
            },
            transportType: {
                type: "string",
                enum: ["all", "stops", "stations", "terminals", "routes"],
                default: "all",
            },
            mode: {
                type: "string",
                enum: ["all", "bus", "train", "express", "ferry", "flight", "other"],
                default: "all",
                description: "Transport mode filter (only when category=transport).",
            },
            lat: { type: "number", minimum: -90, maximum: 90 },
            lng: { type: "number", minimum: -180, maximum: 180 },
            lang: {
                type: "string",
                enum: ["my", "en", "und"],
                description:
                    "Preferred display language for result labels. Does not change ranking sort keys.",
            },
            types: {
                type: "string",
                description:
                    "Optional comma-separated entity-type filter, e.g. " +
                    "'place,street_group,admin_area'. Unknown values are ignored.",
            },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items", "nextCursor", "hasMore"],
            properties: {
                items: { type: "array", items: searchHitSchema },
                nextCursor: { type: "string", nullable: true },
                hasMore: { type: "boolean" },
                analytics: {
                    type: "object",
                    required: ["eventId"],
                    properties: {
                        eventId: {
                            type: "string",
                            format: "uuid",
                            description:
                                "Correlation id for optional POST /public/search/analytics/clicks.",
                        },
                    },
                    additionalProperties: false,
                },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        503: {
            type: "object",
            required: ["code", "message", "retryable"],
            properties: {
                code: { type: "string", enum: ["SEARCH_TIMEOUT"] },
                message: { type: "string" },
                retryable: { type: "boolean", enum: [true] },
            },
            additionalProperties: false,
        },
    },
} satisfies FastifySchema;

const searchGeometryFeatureSchema = {
    type: "object",
    required: ["type", "geometry", "properties"],
    properties: {
        type: { type: "string", enum: ["Feature"] },
        geometry: geoJsonGeometrySchema,
        properties: {
            type: "object",
            required: ["entityType", "entityId"],
            properties: {
                entityType: { type: "string" },
                entityId: { type: "string" },
            },
            additionalProperties: false,
        },
    },
    additionalProperties: false,
} as const;

const searchGeometrySchema = {
    type: "object",
    required: ["entityType", "entityId", "geometryType", "bbox", "feature"],
    properties: {
        entityType: { type: "string" },
        entityId: { type: "string" },
        geometryType: { type: "string", nullable: true },
        bbox: {
            type: "array",
            items: { type: "number" },
            minItems: 4,
            maxItems: 4,
            description: "[minLng, minLat, maxLng, maxLat]",
        },
        feature: searchGeometryFeatureSchema,
    },
    additionalProperties: false,
} as const;

export const getPublicSearchGeometrySchema = {
    tags: [Tags.Search],
    summary: "Selected search-result geometry",
    description:
        "Returns the full GeoJSON geometry for a single search result, fetched on click " +
        "(the search list only carries centroid/bbox). Large line/polygon geometries are " +
        "optionally simplified via ?zoom=. Points are never simplified.",
    params: {
        type: "object",
        required: ["entityType", "entityId"],
        properties: {
            entityType: {
                type: "string",
                enum: [
                    "place",
                    "settlement",
                    "address",
                    "bus_stop",
                    "admin_area",
                    "street",
                    "street_group",
                    "bus_route",
                    "bus_route_variant",
                    "building",
                    "water_line",
                    "water_polygon",
                    "land_area",
                ],
            },
            entityId: { type: "string", description: "Internal numeric id or uuid public_id" },
        },
        additionalProperties: false,
    },
    querystring: {
        type: "object",
        properties: {
            zoom: { type: "number", minimum: 0, maximum: 24 },
        },
        additionalProperties: false,
    },
    response: {
        200: searchGeometrySchema,
        400: badRequestSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const transportRouteMapPreviewVariantSchema = {
    type: "object",
    required: ["entityId", "publicId", "variantCode", "headsign", "directionName", "isPrimary"],
    properties: {
        entityId: { type: "string" },
        publicId: { type: "string", nullable: true },
        variantCode: { type: "string", nullable: true },
        headsign: { type: "string", nullable: true },
        directionName: { type: "string", nullable: true },
        isPrimary: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

const transportRouteMapPreviewStopSchema = {
    type: "object",
    required: ["publicId", "displayName", "sequence", "lat", "lng"],
    properties: {
        publicId: { type: "string" },
        displayName: { type: "string" },
        sequence: { type: "integer", minimum: 1 },
        lat: { type: "number" },
        lng: { type: "number" },
    },
    additionalProperties: false,
} as const;

const transportRouteMapPreviewSchema = {
    type: "object",
    required: ["entityType", "entityId", "bbox", "path", "variants", "importantStops"],
    properties: {
        entityType: { type: "string", enum: ["transport_route", "transport_route_variant"] },
        entityId: { type: "string" },
        bbox: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        path: searchGeometryFeatureSchema,
        variants: { type: "array", items: transportRouteMapPreviewVariantSchema },
        importantStops: { type: "array", items: transportRouteMapPreviewStopSchema },
    },
    additionalProperties: false,
} as const;

export const getPublicSearchMapPreviewSchema = {
    tags: [Tags.Search],
    summary: "Transport route map preview",
    description:
        "Returns a lightweight map overlay for a selected transport route: one simplified path, " +
        "variant summaries, and optional endpoint stops. Parent routes use the focus/primary " +
        "variant only (no multi-variant geometry collect).",
    params: {
        type: "object",
        required: ["entityType", "entityId"],
        properties: {
            entityType: {
                type: "string",
                enum: [
                    "transport_route",
                    "transport_route_variant",
                    "bus_route",
                    "bus_route_variant",
                ],
            },
            entityId: { type: "string", description: "Internal numeric id or uuid public_id" },
        },
        additionalProperties: false,
    },
    querystring: {
        type: "object",
        properties: {
            zoom: { type: "number", minimum: 0, maximum: 24 },
        },
        additionalProperties: false,
    },
    response: {
        200: transportRouteMapPreviewSchema,
        400: badRequestSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const publicAdminAreaSchema = {
    type: "object",
    required: [
        "id",
        "name",
        "name_my",
        "name_en",
        "admin_level",
        "admin_level_code",
        "parent_name",
        "display_name",
    ],
    properties: {
        id: { type: "string" },
        name: { type: "string" },
        name_my: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        admin_level: { type: "string", nullable: true },
        admin_level_code: { type: "string", nullable: true },
        parent_name: { type: "string", nullable: true },
        display_name: { type: "string" },
    },
    additionalProperties: false,
} as const;

export const getPublicAdminAreasSearchSchema = {
    tags: [Tags.AdminAreas],
    summary: "Search admin areas (public)",
    description:
        "Public, read-only search over active admin areas for the profile region picker. Matches Myanmar/English names, canonical name, and slug.",
    querystring: {
        type: "object",
        properties: {
            q: { type: "string", minLength: 1 },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "array", items: publicAdminAreaSchema },
        400: badRequestSchema,
    },
} satisfies FastifySchema;

export const getPublicAdminAreaByIdSchema = {
    tags: [Tags.AdminAreas],
    summary: "Get one admin area (public)",
    description: "Public, read-only lookup of a single active admin area by id (region picker prefill).",
    params: {
        type: "object",
        required: ["id"],
        properties: {
            id: { type: "string", pattern: "^\\d+$" },
        },
        additionalProperties: false,
    },
    response: {
        200: publicAdminAreaSchema,
        400: badRequestSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const postSearchResultClickAnalyticsSchema = {
    tags: [Tags.Search],
    summary: "Record search result click analytics",
    description:
        "Best-effort telemetry when a user selects a search result. " +
        "Use eventId from GET /public/search analytics field. Never blocks user flows.",
    body: {
        type: "object",
        required: ["event_id", "entity_type", "entity_id", "clicked_rank"],
        properties: {
            event_id: {
                type: "string",
                format: "uuid",
                description: "analytics.eventId from the originating search response",
            },
            entity_type: { type: "string" },
            entity_id: { type: "string", pattern: "^\\d+$" },
            clicked_rank: { type: "integer", minimum: 1, maximum: 100 },
            time_to_click_ms: { type: "integer", minimum: 0, maximum: 1800000 },
        },
        additionalProperties: false,
    },
    response: {
        204: { type: "null", description: "Accepted" },
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
