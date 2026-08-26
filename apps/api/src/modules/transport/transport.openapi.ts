import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    forbiddenSchema,
    geoJsonGeometrySchema,
    notFoundSchema,
    unauthorizedSchema,
} from "../../lib/openapi/common.js";

const publicIdParamSchema = {
    type: "object",
    required: ["publicId"],
    properties: { publicId: { type: "string", format: "uuid" } },
} as const;

const countsByKeySchema = {
    type: "object",
    additionalProperties: { type: "integer", minimum: 0 },
} as const;

const TRANSPORT_MODES = ["bus", "express_bus", "train", "ferry", "air", "other"] as const;
const INFRASTRUCTURE_LINE_TYPES = [
    "ferry",
    "rail",
    "abandoned",
    "disused",
    "construction",
    "narrow_gauge",
    "tram",
] as const;
const TRANSPORT_REVIEW_STATUSES = [
    "imported_unreviewed",
    "needs_review",
    "reviewed",
    "verified",
    "rejected",
    "manual_protected",
] as const;

const routeListItemSchema = {
    type: "object",
    required: [
        "public_id",
        "route_code",
        "public_name",
        "display_name",
        "mode",
        "route_kind",
        "review_status",
        "is_active",
        "variant_count",
        "stop_count",
        "path_count",
        "updated_at",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        route_code: { type: "string" },
        public_name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        display_name: { type: "string" },
        mode: { type: "string" },
        route_kind: { type: "string" },
        origin_name: { type: "string", nullable: true },
        destination_name: { type: "string", nullable: true },
        review_status: { type: "string" },
        confidence_score: { type: "number", nullable: true },
        is_active: { type: "boolean" },
        variant_count: { type: "integer", minimum: 0 },
        stop_count: { type: "integer", minimum: 0 },
        path_count: { type: "integer", minimum: 0 },
        updated_at: { type: "string" },
    },
} as const;

/** Public (unauthenticated) route list item — no admin public_id / counts. */
const publicRouteListItemSchema = {
    type: "object",
    required: ["route_code", "route_name_my", "route_name_en", "operator", "fare"],
    properties: {
        route_code: { type: "string" },
        route_name_my: { type: "string", nullable: true },
        route_name_en: { type: "string", nullable: true },
        operator: {
            type: "object",
            nullable: true,
            required: ["name"],
            properties: {
                name: { type: "string" },
            },
        },
        fare: {
            type: "object",
            nullable: true,
            required: ["fare_type", "amount_min", "amount_max", "currency_code", "note"],
            properties: {
                fare_type: { type: "string" },
                amount_min: { type: "number", nullable: true },
                amount_max: { type: "number", nullable: true },
                currency_code: { type: "string" },
                note: { type: "string", nullable: true },
            },
        },
    },
} as const;

const routeSearchStopSchema = {
    type: "object",
    required: ["route_stop_id", "stop_id", "public_id", "stop_sequence", "name_my", "name_en"],
    properties: {
        route_stop_id: { type: "string" },
        stop_id: { type: "string" },
        public_id: { type: "string", format: "uuid" },
        stop_sequence: { type: "integer", minimum: 1 },
        name_my: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
    },
} as const;

const routeSearchCandidateSchema = {
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
        "origin_stop_sequence",
        "destination_stop_sequence",
        "forward_stop_count",
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
        origin_name: { type: "string", nullable: true },
        destination_name: { type: "string", nullable: true },
        origin_stop_sequence: { type: "integer", minimum: 1 },
        destination_stop_sequence: { type: "integer", minimum: 1 },
        forward_stop_count: { type: "integer", minimum: 1 },
        stops: { type: "array", items: routeSearchStopSchema },
    },
} as const;

export const searchRoutesBetweenStopsSchema = {
    tags: [Tags.Transport],
    summary: "Search direct route variants between two stops",
    description:
        "Finds public-release route variants that serve both stops and returns the best forward " +
        "occurrence pair per variant (destination.stop_sequence > origin.stop_sequence, smallest span). " +
        "Supports repeated stop_id on circular routes without wrap-around.",
    querystring: {
        type: "object",
        required: ["origin_stop_public_id", "destination_stop_public_id"],
        properties: {
            origin_stop_public_id: { type: "string", format: "uuid" },
            destination_stop_public_id: { type: "string", format: "uuid" },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["origin_stop_public_id", "destination_stop_public_id", "candidates"],
            properties: {
                origin_stop_public_id: { type: "string", format: "uuid" },
                destination_stop_public_id: { type: "string", format: "uuid" },
                candidates: { type: "array", items: routeSearchCandidateSchema },
            },
        },
        400: badRequestSchema,
        404: notFoundSchema,
    },
} as const;

export const getTransportRoutesSchema = {
    tags: [Tags.Transport],
    summary: "List transport routes (admin)",
    description:
        "Paginated, filterable routes list with variant/stop/path counts. Never returns geometry. " +
        "Unauthenticated callers receive the public route list shape (route_code / names / fare).",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            search: { type: "string", minLength: 1, maxLength: 120 },
            mode: { type: "string", enum: [...TRANSPORT_MODES] },
            reviewStatus: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
            hasStops: { type: "string", enum: ["true", "false"] },
            hasPath: { type: "string", enum: ["true", "false"] },
            isActive: { type: "string", enum: ["true", "false"] },
            includeDeleted: { type: "string", enum: ["true", "false"] },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 },
            page: { type: "integer", minimum: 1 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset", "page", "hasNextPage"],
            properties: {
                items: {
                    type: "array",
                    items: {
                        oneOf: [routeListItemSchema, publicRouteListItemSchema],
                    },
                },
                total: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1 },
                offset: { type: "integer", minimum: 0 },
                page: { type: "integer", minimum: 1 },
                hasNextPage: { type: "boolean" },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

const stopListItemSchema = {
    type: "object",
    required: [
        "public_id",
        "name",
        "display_name",
        "mode",
        "stop_type",
        "route_count",
        "has_terminal",
        "review_status",
        "is_active",
        "updated_at",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        stop_code: { type: "string", nullable: true },
        name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        display_name: { type: "string" },
        mode: { type: "string" },
        stop_type: { type: "string" },
        route_count: { type: "integer", minimum: 0 },
        has_terminal: { type: "boolean" },
        terminal_role: { type: "string", nullable: true },
        terminal_code: { type: "string", nullable: true },
        admin_area_id: { type: "integer", nullable: true },
        admin_area_name: { type: "string", nullable: true },
        review_status: { type: "string" },
        confidence_score: { type: "number", nullable: true },
        is_active: { type: "boolean" },
        updated_at: { type: "string" },
    },
} as const;

export const getTransportStopsSchema = {
    tags: [Tags.Transport],
    summary: "List transport stops (admin)",
    description:
        "Paginated, filterable stops list with route counts and admin-area display. Never returns geometry.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            search: { type: "string", minLength: 1, maxLength: 120 },
            mode: { type: "string", enum: [...TRANSPORT_MODES] },
            stopType: { type: "string", minLength: 1, maxLength: 50 },
            reviewStatus: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
            generatedName: { type: "string", enum: ["true", "false"] },
            hasRoutes: { type: "string", enum: ["true", "false"] },
            hasTerminal: { type: "string", enum: ["true", "false"] },
            adminAreaId: { type: "integer", minimum: 1 },
            isActive: { type: "string", enum: ["true", "false"] },
            includeDeleted: { type: "string", enum: ["true", "false"] },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 },
            page: { type: "integer", minimum: 1 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset"],
            properties: {
                items: { type: "array", items: stopListItemSchema },
                total: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1 },
                offset: { type: "integer", minimum: 0 },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

const stopSearchItemSchema = {
    type: "object",
    required: [
        "public_id",
        "display_name",
        "mode",
        "stop_type",
        "review_status",
        "route_count",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        display_name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        mode: { type: "string" },
        stop_type: { type: "string" },
        review_status: { type: "string" },
        confidence_score: { type: "number", nullable: true },
        lon: { type: "number", nullable: true },
        lat: { type: "number", nullable: true },
        distance_m: { type: "number", nullable: true },
        route_count: { type: "integer", minimum: 0 },
    },
} as const;

export const searchTransportStopsSchema = {
    tags: [Tags.Transport],
    summary: "Search stops for route insertion (admin)",
    description:
        "Lightweight stop picker for inserting an existing stop into a route variant. Returns existing active stops only " +
        "(never source_refs / normalized_data, never the full list of routes using the stop). Text search matches " +
        "Myanmar/English/raw name and stop_code; supplying nearLng+nearLat adds a PostGIS radius filter and ranks by distance. " +
        "Pass excludeRouteVariantPublicId to drop stops already in that variant. Hard-capped at 50 results.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            search: { type: "string", minLength: 1, maxLength: 120 },
            mode: { type: "string", enum: [...TRANSPORT_MODES] },
            nearLng: { type: "number", minimum: -180, maximum: 180 },
            nearLat: { type: "number", minimum: -90, maximum: 90 },
            radiusMeters: { type: "number", minimum: 1, maximum: 50000, default: 1000 },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            excludeRouteVariantPublicId: { type: "string", format: "uuid" },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "limit"],
            properties: {
                items: { type: "array", items: stopSearchItemSchema },
                limit: { type: "integer", minimum: 1 },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

const terminalListItemSchema = {
    type: "object",
    required: [
        "public_id",
        "name",
        "raw_name_status",
        "mode",
        "terminal_role",
        "review_status",
        "is_active",
        "updated_at",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        terminal_code: { type: "string", nullable: true },
        name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        raw_name_status: { type: "string", enum: ["real", "generated", "missing"] },
        mode: { type: "string" },
        terminal_role: { type: "string" },
        linked_stop: {
            type: "object",
            nullable: true,
            properties: {
                public_id: { type: "string", format: "uuid" },
                name: { type: "string" },
            },
        },
        admin_area_id: { type: "integer", nullable: true },
        admin_area_name: { type: "string", nullable: true },
        review_status: { type: "string" },
        confidence_score: { type: "number", nullable: true },
        is_active: { type: "boolean" },
        updated_at: { type: "string" },
    },
} as const;

export const getTransportTerminalsSchema = {
    tags: [Tags.Transport],
    summary: "List transport terminals (admin)",
    description:
        "Paginated, filterable terminals list with raw-name status, linked-stop and admin-area display. Never returns geometry.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            search: { type: "string", minLength: 1, maxLength: 120 },
            mode: { type: "string", enum: [...TRANSPORT_MODES] },
            terminalRole: { type: "string", minLength: 1, maxLength: 50 },
            reviewStatus: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
            generatedName: { type: "string", enum: ["true", "false"] },
            linkedStop: { type: "string", enum: ["true", "false"] },
            adminAreaId: { type: "integer", minimum: 1 },
            confidenceMin: { type: "number", minimum: 0, maximum: 100 },
            confidenceMax: { type: "number", minimum: 0, maximum: 100 },
            isActive: { type: "string", enum: ["true", "false"] },
            includeDeleted: { type: "string", enum: ["true", "false"] },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 },
            page: { type: "integer", minimum: 1 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset"],
            properties: {
                items: { type: "array", items: terminalListItemSchema },
                total: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1 },
                offset: { type: "integer", minimum: 0 },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

const infrastructureLineListItemSchema = {
    type: "object",
    required: [
        "public_id",
        "name",
        "raw_name_status",
        "mode",
        "line_type",
        "review_status",
        "is_active",
        "updated_at",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        raw_name_status: { type: "string", enum: ["real", "generated", "missing"] },
        mode: { type: "string" },
        line_type: { type: "string" },
        admin_area_id: { type: "integer", nullable: true },
        admin_area_name: { type: "string", nullable: true },
        review_status: { type: "string" },
        confidence_score: { type: "number", nullable: true },
        is_active: { type: "boolean" },
        updated_at: { type: "string" },
    },
} as const;

const infrastructureLineJsonBlobSchema = {
    type: "object",
    additionalProperties: true,
    nullable: true,
} as const;

const infrastructureLineDetailSchema = {
    type: "object",
    required: [
        "public_id",
        "raw_name_status",
        "mode",
        "line_type",
        "review_status",
        "is_active",
        "sources",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        name: { type: "string", nullable: true },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        raw_name_status: { type: "string", enum: ["real", "generated", "missing"] },
        mode: { type: "string" },
        line_type: { type: "string" },
        admin_area_id: { type: "integer", nullable: true },
        admin_area_name: { type: "string", nullable: true },
        review_status: { type: "string" },
        confidence_score: { type: "number", nullable: true },
        is_active: { type: "boolean" },
        geometry: { ...geoJsonGeometrySchema, nullable: true },
        length_m: { type: "number", nullable: true },
        created_at: { type: "string" },
        updated_at: { type: "string" },
        deleted_at: { type: "string", nullable: true },
        sources: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    source_name: { type: "string" },
                    source_kind: { type: "string" },
                    external_id: { type: "string", nullable: true },
                    source_url: { type: "string", nullable: true },
                    is_primary: { type: "boolean" },
                },
            },
        },
        source_refs: infrastructureLineJsonBlobSchema,
        normalized_data: infrastructureLineJsonBlobSchema,
    },
} as const;

export const getTransportInfrastructureLineDetailSchema = {
    tags: [Tags.Transport],
    summary: "Get transport infrastructure line detail (admin)",
    description:
        "Full line fields incl. LineString geometry, admin-area display, approximate length, source summary, and raw debug blobs.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    response: {
        200: infrastructureLineDetailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const updateInfrastructureLineBodySchema = {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
        name: { type: "string", nullable: true, maxLength: 255 },
        name_mm: { type: "string", nullable: true, maxLength: 255 },
        name_en: { type: "string", nullable: true, maxLength: 255 },
        mode: { type: "string", enum: [...TRANSPORT_MODES] },
        line_type: { type: "string", enum: [...INFRASTRUCTURE_LINE_TYPES] },
        admin_area_id: { type: "integer", nullable: true, minimum: 1 },
        review_status: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
        confidence_score: { type: "number", minimum: 0, maximum: 100 },
        is_active: { type: "boolean" },
    },
} as const;

export const patchTransportInfrastructureLineSchema = {
    tags: [Tags.Transport],
    summary: "Update transport infrastructure line metadata (admin)",
    description:
        "Partial update of editable line fields. Cannot edit geometry, source_refs, or normalized_data. No hard delete.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    body: updateInfrastructureLineBodySchema,
    response: {
        200: infrastructureLineDetailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const getTransportInfrastructureLinesSchema = {
    tags: [Tags.Transport],
    summary: "List transport infrastructure lines (admin)",
    description:
        "Paginated, filterable infrastructure-lines list with raw-name status and admin-area display. Never returns geometry.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            search: { type: "string", minLength: 1, maxLength: 120 },
            mode: { type: "string", enum: [...TRANSPORT_MODES] },
            lineType: { type: "string", minLength: 1, maxLength: 50 },
            reviewStatus: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
            generatedName: { type: "string", enum: ["true", "false"] },
            adminAreaId: { type: "integer", minimum: 1 },
            isActive: { type: "string", enum: ["true", "false"] },
            includeDeleted: { type: "string", enum: ["true", "false"] },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 },
            page: { type: "integer", minimum: 1 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset"],
            properties: {
                items: { type: "array", items: infrastructureLineListItemSchema },
                total: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1 },
                offset: { type: "integer", minimum: 0 },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

const routeNameSchema = {
    type: "object",
    properties: {
        name: { type: "string" },
        language_code: { type: "string" },
        script_code: { type: "string", nullable: true },
        name_type: { type: "string" },
        is_primary: { type: "boolean" },
        search_weight: { type: "integer" },
    },
} as const;

const terminalDetailJsonBlobSchema = {
    type: "object",
    additionalProperties: true,
    nullable: true,
} as const;

const terminalDetailSchema = {
    type: "object",
    required: [
        "public_id",
        "name",
        "raw_name_status",
        "mode",
        "terminal_role",
        "review_status",
        "is_active",
        "vehicle_access",
        "sources",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        terminal_code: { type: "string", nullable: true },
        name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        raw_name_status: { type: "string", enum: ["real", "generated", "missing"] },
        mode: { type: "string" },
        terminal_role: { type: "string" },
        linked_stop_id: { type: "integer", nullable: true },
        linked_stop: {
            type: "object",
            nullable: true,
            properties: {
                public_id: { type: "string", format: "uuid" },
                name: { type: "string" },
                mode: { type: "string" },
                stop_type: { type: "string" },
            },
        },
        operator_id: { type: "integer", nullable: true },
        operator: {
            type: "object",
            nullable: true,
            properties: { id: { type: "integer" }, name: { type: "string" } },
        },
        admin_area_id: { type: "integer", nullable: true },
        admin_area_name: { type: "string", nullable: true },
        review_status: { type: "string" },
        confidence_score: { type: "number", nullable: true },
        is_active: { type: "boolean" },
        longitude: { type: "number", nullable: true },
        latitude: { type: "number", nullable: true },
        geometry: { ...geoJsonGeometrySchema, nullable: true },
        vehicle_access: { type: "string" },
        created_at: { type: "string" },
        updated_at: { type: "string" },
        deleted_at: { type: "string", nullable: true },
        sources: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    source_name: { type: "string" },
                    source_kind: { type: "string" },
                    external_id: { type: "string", nullable: true },
                    source_url: { type: "string", nullable: true },
                    is_primary: { type: "boolean" },
                },
            },
        },
        source_refs: terminalDetailJsonBlobSchema,
        normalized_data: terminalDetailJsonBlobSchema,
    },
} as const;

export const getTransportTerminalDetailSchema = {
    tags: [Tags.Transport],
    summary: "Get transport terminal detail (admin)",
    description:
        "Full terminal fields incl. point geometry, linked-stop/operator/admin-area display, derived vehicle_access, source summary, and raw debug blobs.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    response: {
        200: terminalDetailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const updateTerminalBodySchema = {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
        terminal_code: { type: "string", nullable: true, maxLength: 50 },
        name: { type: "string", minLength: 1, maxLength: 255 },
        name_mm: { type: "string", nullable: true, maxLength: 255 },
        name_en: { type: "string", nullable: true, maxLength: 255 },
        mode: { type: "string", enum: [...TRANSPORT_MODES] },
        terminal_role: { type: "string", minLength: 1, maxLength: 50 },
        linked_stop_id: { type: "integer", nullable: true, minimum: 1 },
        operator_id: { type: "integer", nullable: true, minimum: 1 },
        admin_area_id: { type: "integer", nullable: true, minimum: 1 },
        review_status: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
        confidence_score: { type: "number", minimum: 0, maximum: 100 },
        is_active: { type: "boolean" },
        point: {
            type: "object",
            required: ["longitude", "latitude"],
            additionalProperties: false,
            properties: {
                longitude: { type: "number", minimum: -180, maximum: 180 },
                latitude: { type: "number", minimum: -90, maximum: 90 },
            },
        },
    },
} as const;

export const patchTransportTerminalSchema = {
    tags: [Tags.Transport],
    summary: "Update transport terminal metadata + point (admin)",
    description:
        "Partial update of editable terminal fields and point geometry. Cannot edit source_refs or normalized_data. No hard delete.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    body: updateTerminalBodySchema,
    response: {
        200: terminalDetailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const sourceSummarySchema = {
    type: "object",
    properties: {
        source_name: { type: "string" },
        source_kind: { type: "string" },
        external_id: { type: "string", nullable: true },
        source_url: { type: "string", nullable: true },
        is_primary: { type: "boolean" },
    },
} as const;

/** Pass-through schema for raw importer/debug jsonb blobs (admin-only). */
const jsonBlobSchema = { type: "object", additionalProperties: true, nullable: true } as const;

const stopDetailSchema = {
    type: "object",
    required: [
        "public_id",
        "name",
        "display_name",
        "mode",
        "stop_type",
        "review_status",
        "is_active",
        "route_count",
        "sources",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        stop_code: { type: "string", nullable: true },
        name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        display_name: { type: "string" },
        mode: { type: "string" },
        stop_type: { type: "string" },
        admin_area_id: { type: "integer", nullable: true },
        admin_area_name: { type: "string", nullable: true },
        parent_stop_id: { type: "integer", nullable: true },
        parent_stop: {
            type: "object",
            nullable: true,
            properties: {
                public_id: { type: "string", format: "uuid" },
                name: { type: "string" },
            },
        },
        review_status: { type: "string" },
        confidence_score: { type: "number", nullable: true },
        is_active: { type: "boolean" },
        longitude: { type: "number", nullable: true },
        latitude: { type: "number", nullable: true },
        geometry: { ...geoJsonGeometrySchema, nullable: true },
        route_count: { type: "integer", minimum: 0 },
        linked_terminal: {
            type: "object",
            nullable: true,
            required: ["public_id", "terminal_role", "is_active"],
            properties: {
                public_id: { type: "string", format: "uuid" },
                terminal_code: { type: "string", nullable: true },
                terminal_role: { type: "string" },
                operator_id: { type: "integer", nullable: true },
                operator: {
                    type: "object",
                    nullable: true,
                    properties: { id: { type: "integer" }, name: { type: "string" } },
                },
                review_status: { type: "string" },
                confidence_score: { type: "number", nullable: true },
                is_active: { type: "boolean" },
            },
        },
        created_at: { type: "string" },
        updated_at: { type: "string" },
        deleted_at: { type: "string", nullable: true },
        sources: { type: "array", items: sourceSummarySchema },
        source_refs: jsonBlobSchema,
        normalized_data: jsonBlobSchema,
    },
} as const;

export const getTransportStopDetailSchema = {
    tags: [Tags.Transport],
    summary: "Get transport stop detail (admin)",
    description:
        "Full stop fields incl. point geometry, admin-area/parent display, source summary, and raw debug blobs.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    response: {
        200: stopDetailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const stopRouteUsageSchema = {
    type: "object",
    properties: {
        route_stop_id: { type: "string" },
        route_public_id: { type: "string", format: "uuid" },
        route_code: { type: "string" },
        route_name: { type: "string" },
        mode: { type: "string" },
        variant_public_id: { type: "string", format: "uuid" },
        variant_code: { type: "string" },
        direction_name: { type: "string", nullable: true },
        headsign: { type: "string", nullable: true },
        stop_sequence: { type: "integer" },
    },
} as const;

export const getTransportStopRoutesSchema = {
    tags: [Tags.Transport],
    summary: "List route variants that include this stop (admin)",
    description:
        "Paginated route/variant summaries (code, name, direction, sequence) — never full route detail.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "limit", "offset"],
            properties: {
                items: { type: "array", items: stopRouteUsageSchema },
                total: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1 },
                offset: { type: "integer", minimum: 0 },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const stopRouteUsageDetailItemSchema = {
    type: "object",
    required: [
        "routeStopId",
        "routeId",
        "routeCode",
        "routeName",
        "variantId",
        "variantCode",
        "directionName",
        "directionId",
        "stopSequence",
    ],
    properties: {
        routeStopId: { type: "string" },
        routeId: { type: "string", format: "uuid" },
        routeCode: { type: "string" },
        routeName: { type: "string" },
        variantId: { type: "string", format: "uuid" },
        variantCode: { type: "string" },
        directionName: { type: "string", nullable: true },
        directionId: { type: "integer", nullable: true },
        stopSequence: { type: "integer" },
    },
} as const;

const stopRouteUsageSummarySchema = {
    type: "object",
    required: [
        "totalRoutes",
        "totalVariants",
        "routeStopMemberships",
        "inboundCount",
        "outboundCount",
        "clockwiseCount",
        "anticlockwiseCount",
    ],
    properties: {
        totalRoutes: { type: "integer", minimum: 0 },
        totalVariants: { type: "integer", minimum: 0 },
        routeStopMemberships: { type: "integer", minimum: 0 },
        inboundCount: { type: "integer", minimum: 0 },
        outboundCount: { type: "integer", minimum: 0 },
        clockwiseCount: { type: "integer", minimum: 0 },
        anticlockwiseCount: { type: "integer", minimum: 0 },
    },
} as const;

const stopRouteUsageDirectionUsageSchema = {
    type: "object",
    required: ["inbound", "outbound", "clockwise", "anticlockwise"],
    properties: {
        inbound: { type: "integer", minimum: 0 },
        outbound: { type: "integer", minimum: 0 },
        clockwise: { type: "integer", minimum: 0 },
        anticlockwise: { type: "integer", minimum: 0 },
    },
} as const;

export const getTransportStopRouteUsageDetailSchema = {
    tags: [Tags.Transport],
    summary: "Route usage detail for one stop (admin)",
    description:
        "Authoritative route usage for one stop: distinct route/variant totals, direction " +
        "breakdown, and every non-deleted route membership. Uses the same membership filters " +
        "as GET /transport/stops/:publicId/routes. One query via indexed route_stops.stop_id — no N+1.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    response: {
        200: {
            type: "object",
            required: [
                "stopPublicId",
                "stopId",
                "items",
                "routes",
                "summary",
                "totalRoutes",
                "totalVariants",
                "directionUsage",
            ],
            properties: {
                stopPublicId: { type: "string", format: "uuid" },
                stopId: { type: "string", format: "uuid" },
                items: { type: "array", items: stopRouteUsageDetailItemSchema },
                routes: { type: "array", items: stopRouteUsageDetailItemSchema },
                summary: stopRouteUsageSummarySchema,
                totalRoutes: { type: "integer", minimum: 0 },
                totalVariants: { type: "integer", minimum: 0 },
                directionUsage: stopRouteUsageDirectionUsageSchema,
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const stopMergePreviewStopSchema = {
    type: "object",
    required: [
        "publicId",
        "name",
        "nameMy",
        "nameEn",
        "mode",
        "stopType",
        "adminAreaId",
        "adminAreaName",
        "reviewStatus",
        "confidenceScore",
        "isActive",
        "lat",
        "lng",
    ],
    properties: {
        publicId: { type: "string", format: "uuid" },
        name: { type: "string" },
        nameMy: { type: "string", nullable: true },
        nameEn: { type: "string", nullable: true },
        mode: { type: "string" },
        stopType: { type: "string" },
        adminAreaId: { type: "integer", nullable: true },
        adminAreaName: { type: "string", nullable: true },
        reviewStatus: { type: "string" },
        confidenceScore: { type: "number", nullable: true },
        isActive: { type: "boolean" },
        lat: { type: "number", nullable: true },
        lng: { type: "number", nullable: true },
    },
} as const;

const stopMergeReferenceCountsSchema = {
    type: "object",
    required: [
        "routeStops",
        "variantOrigins",
        "variantDestinations",
        "terminals",
        "faresOrigin",
        "faresDestination",
        "childStops",
        "stopNames",
        "sourceLinks",
    ],
    properties: {
        routeStops: { type: "integer", minimum: 0 },
        variantOrigins: { type: "integer", minimum: 0 },
        variantDestinations: { type: "integer", minimum: 0 },
        terminals: { type: "integer", minimum: 0 },
        faresOrigin: { type: "integer", minimum: 0 },
        faresDestination: { type: "integer", minimum: 0 },
        childStops: { type: "integer", minimum: 0 },
        stopNames: { type: "integer", minimum: 0 },
        sourceLinks: { type: "integer", minimum: 0 },
    },
} as const;

const stopMergeVariantConflictSchema = {
    type: "object",
    required: [
        "routeCode",
        "variantCode",
        "directionName",
        "currentRouteStopId",
        "currentSequence",
        "candidateRouteStopId",
        "candidateSequence",
    ],
    properties: {
        routeCode: { type: "string" },
        variantCode: { type: "string" },
        directionName: { type: "string", nullable: true },
        currentRouteStopId: { type: "string" },
        currentSequence: { type: "integer" },
        candidateRouteStopId: { type: "string" },
        candidateSequence: { type: "integer" },
    },
} as const;

const stopMergeAffectedRouteSchema = {
    type: "object",
    required: ["routeId", "routeCode", "routeName"],
    properties: {
        routeId: { type: "string", format: "uuid" },
        routeCode: { type: "string" },
        routeName: { type: "string" },
    },
} as const;

const stopMergeAffectedVariantSchema = {
    type: "object",
    required: ["variantId", "variantCode", "routeId", "routeCode", "directionName"],
    properties: {
        variantId: { type: "string", format: "uuid" },
        variantCode: { type: "string" },
        routeId: { type: "string", format: "uuid" },
        routeCode: { type: "string" },
        directionName: { type: "string", nullable: true },
    },
} as const;

const stopMergeDuplicateMembershipConflictSchema = {
    type: "object",
    required: [
        "routeId",
        "routeCode",
        "variantId",
        "variantCode",
        "directionName",
        "currentRouteStopId",
        "currentSequence",
        "candidateRouteStopId",
        "candidateSequence",
    ],
    properties: {
        routeId: { type: "string", format: "uuid" },
        routeCode: { type: "string" },
        variantId: { type: "string", format: "uuid" },
        variantCode: { type: "string" },
        directionName: { type: "string", nullable: true },
        currentRouteStopId: { type: "string" },
        currentSequence: { type: "integer" },
        candidateRouteStopId: { type: "string" },
        candidateSequence: { type: "integer" },
    },
} as const;

const stopMergeSequenceConflictSchema = {
    type: "object",
    required: [
        "routeId",
        "routeCode",
        "variantId",
        "variantCode",
        "directionName",
        "stopSequence",
        "currentRouteStopId",
        "candidateRouteStopId",
    ],
    properties: {
        routeId: { type: "string", format: "uuid" },
        routeCode: { type: "string" },
        variantId: { type: "string", format: "uuid" },
        variantCode: { type: "string" },
        directionName: { type: "string", nullable: true },
        stopSequence: { type: "integer" },
        currentRouteStopId: { type: "string" },
        candidateRouteStopId: { type: "string" },
    },
} as const;

const stopMergeScalarComparisonSchema = {
    type: "object",
    required: ["current", "candidate", "same"],
    properties: {
        current: {},
        candidate: {},
        same: { type: "boolean" },
    },
} as const;

const stopMergeFieldComparisonSchema = {
    type: "object",
    required: [
        "name",
        "name_mm",
        "name_en",
        "stop_type",
        "geom",
        "admin_area_id",
        "confidence_score",
        "review_status",
        "is_active",
    ],
    properties: {
        name: stopMergeScalarComparisonSchema,
        name_mm: stopMergeScalarComparisonSchema,
        name_en: stopMergeScalarComparisonSchema,
        stop_type: stopMergeScalarComparisonSchema,
        geom: {
            type: "object",
            required: ["current", "candidate", "same", "distanceMeters"],
            properties: {
                current: {
                    type: "object",
                    nullable: true,
                    properties: {
                        lat: { type: "number" },
                        lng: { type: "number" },
                    },
                },
                candidate: {
                    type: "object",
                    nullable: true,
                    properties: {
                        lat: { type: "number" },
                        lng: { type: "number" },
                    },
                },
                same: { type: "boolean" },
                distanceMeters: { type: "number", nullable: true },
            },
        },
        admin_area_id: stopMergeScalarComparisonSchema,
        confidence_score: stopMergeScalarComparisonSchema,
        review_status: stopMergeScalarComparisonSchema,
        is_active: stopMergeScalarComparisonSchema,
    },
} as const;

export const postTransportStopMergePreviewSchema = {
    tags: [Tags.Transport],
    summary: "Preview merging two transport stops (admin)",
    description:
        "Read-only merge preview for Review Map and stop dedup workflows. Requires both " +
        "stops to exist, be active (not deleted), and share the same mode. Reports variants " +
        "where both stop IDs occur (including repeated occurrences). Does not block on distance " +
        "or name similarity.",
    security: [...bearerAuth],
    body: {
        type: "object",
        additionalProperties: false,
        required: ["currentStopId", "candidateStopId"],
        properties: {
            currentStopId: { type: "string", format: "uuid" },
            candidateStopId: { type: "string", format: "uuid" },
        },
    },
    response: {
        200: {
            type: "object",
            required: [
                "currentStop",
                "candidateStop",
                "currentUsage",
                "candidateUsage",
                "sameVariantConflicts",
                "sameVariantWarning",
                "affectedRoutes",
                "affectedVariants",
                "duplicateMembershipConflicts",
                "sequenceConflicts",
                "mergeAllowed",
                "mergeBlockers",
                "terminalConflict",
                "referenceCounts",
                "fieldComparison",
            ],
            properties: {
                currentStop: stopMergePreviewStopSchema,
                candidateStop: stopMergePreviewStopSchema,
                currentUsage: {
                    type: "object",
                    required: ["items", "summary"],
                    properties: {
                        items: { type: "array", items: stopRouteUsageDetailItemSchema },
                        summary: stopRouteUsageSummarySchema,
                    },
                },
                candidateUsage: {
                    type: "object",
                    required: ["items", "summary"],
                    properties: {
                        items: { type: "array", items: stopRouteUsageDetailItemSchema },
                        summary: stopRouteUsageSummarySchema,
                    },
                },
                sameVariantConflicts: {
                    type: "array",
                    items: stopMergeVariantConflictSchema,
                },
                sameVariantWarning: { type: "string", nullable: true },
                affectedRoutes: {
                    type: "array",
                    items: stopMergeAffectedRouteSchema,
                },
                affectedVariants: {
                    type: "array",
                    items: stopMergeAffectedVariantSchema,
                },
                duplicateMembershipConflicts: {
                    type: "array",
                    items: stopMergeDuplicateMembershipConflictSchema,
                },
                sequenceConflicts: {
                    type: "array",
                    items: stopMergeSequenceConflictSchema,
                },
                mergeAllowed: { type: "boolean" },
                mergeBlockers: { type: "array", items: { type: "string" } },
                terminalConflict: {
                    type: "object",
                    required: ["exists", "canonicalTerminal", "duplicateTerminal"],
                    properties: {
                        exists: { type: "boolean" },
                        canonicalTerminal: {
                            type: "object",
                            nullable: true,
                            required: ["id", "publicId", "name"],
                            properties: {
                                id: { type: "string" },
                                publicId: { type: "string" },
                                name: { type: "string" },
                            },
                        },
                        duplicateTerminal: {
                            type: "object",
                            nullable: true,
                            required: ["id", "publicId", "name"],
                            properties: {
                                id: { type: "string" },
                                publicId: { type: "string" },
                                name: { type: "string" },
                            },
                        },
                    },
                },
                referenceCounts: {
                    type: "object",
                    required: ["current", "candidate"],
                    properties: {
                        current: stopMergeReferenceCountsSchema,
                        candidate: stopMergeReferenceCountsSchema,
                    },
                },
                fieldComparison: stopMergeFieldComparisonSchema,
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: {
            type: "object",
            properties: {
                message: { type: "string" },
                code: { type: "string" },
                blockers: { type: "array", items: { type: "string" } },
            },
        },
        500: {
            type: "object",
            properties: {
                message: { type: "string" },
            },
        },
    },
} satisfies FastifySchema;

const stopMergeGlobalReferenceChangesSchema = {
    type: "object",
    required: [
        "routeStops",
        "variantOrigins",
        "variantDestinations",
        "terminals",
        "faresOrigin",
        "faresDestination",
        "childStops",
        "stopNames",
        "sourceLinks",
    ],
    properties: {
        routeStops: { type: "integer", minimum: 0 },
        variantOrigins: { type: "integer", minimum: 0 },
        variantDestinations: { type: "integer", minimum: 0 },
        terminals: { type: "integer", minimum: 0 },
        faresOrigin: { type: "integer", minimum: 0 },
        faresDestination: { type: "integer", minimum: 0 },
        childStops: { type: "integer", minimum: 0 },
        stopNames: { type: "integer", minimum: 0 },
        sourceLinks: { type: "integer", minimum: 0 },
    },
} as const;

const stopMergeGlobalCountsSchema = {
    type: "object",
    required: ["canonicalBefore", "canonicalAfter", "duplicateBefore", "duplicateAfter"],
    properties: {
        canonicalBefore: stopMergeReferenceCountsSchema,
        canonicalAfter: stopMergeReferenceCountsSchema,
        duplicateBefore: stopMergeReferenceCountsSchema,
        duplicateAfter: stopMergeReferenceCountsSchema,
    },
} as const;

export const postTransportStopMergeGlobalSchema = {
    tags: [Tags.Transport],
    summary: "Merge transport stops — keep canonical (admin)",
    description:
        "Global keep-canonical merge: repoint all duplicate references to the canonical stop, " +
        "preserve every route_stop occurrence and sequence, preserve non-conflicting names and " +
        "source links, verify zero duplicate references, then hard-delete the duplicate stop. " +
        "Blocks when stops differ in mode. When both stops occur on the same variant, merge " +
        "requires acknowledgeSameVariantOccurrences.",
    security: [...bearerAuth],
    body: {
        type: "object",
        additionalProperties: false,
        required: ["canonicalStopId", "duplicateStopId", "currentStopId", "candidateStopId"],
        properties: {
            canonicalStopId: { type: "string", format: "uuid" },
            duplicateStopId: { type: "string", format: "uuid" },
            currentStopId: { type: "string", format: "uuid" },
            candidateStopId: { type: "string", format: "uuid" },
            fieldSources: {
                type: "object",
                additionalProperties: false,
                properties: {
                    name: { type: "string", enum: ["current", "candidate"] },
                    name_mm: { type: "string", enum: ["current", "candidate"] },
                    name_en: { type: "string", enum: ["current", "candidate"] },
                    stop_type: { type: "string", enum: ["current", "candidate"] },
                    geom: { type: "string", enum: ["current", "candidate"] },
                    admin_area_id: { type: "string", enum: ["current", "candidate"] },
                    confidence_score: { type: "string", enum: ["current", "candidate"] },
                    review_status: { type: "string", enum: ["current", "candidate"] },
                    is_active: { type: "string", enum: ["current", "candidate"] },
                },
            },
            reason: { type: "string", minLength: 1, maxLength: 500 },
            acknowledgeSameVariantOccurrences: { type: "boolean" },
        },
    },
    response: {
        200: {
            type: "object",
            required: [
                "canonicalStop",
                "deletedStop",
                "deletedStopId",
                "referencesChanged",
                "affectedRouteCodes",
                "affectedVariantCodes",
                "counts",
            ],
            properties: {
                canonicalStop: stopMergePreviewStopSchema,
                deletedStop: stopMergePreviewStopSchema,
                deletedStopId: { type: "string", format: "uuid" },
                referencesChanged: stopMergeGlobalReferenceChangesSchema,
                affectedRouteCodes: { type: "array", items: { type: "string" } },
                affectedVariantCodes: { type: "array", items: { type: "string" } },
                counts: stopMergeGlobalCountsSchema,
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: {
            type: "object",
            properties: {
                message: { type: "string" },
                code: { type: "string" },
                blockers: { type: "array", items: { type: "string" } },
            },
        },
    },
} satisfies FastifySchema;

const updateStopBodySchema = {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    description:
        "Naming is edited via name_mm / name_en only; transport.stop_names (my/en) is the source of truth and stops.name/name_mm/name_en are derived caches. The raw `name` cache is not editable. At least one of name_mm/name_en must remain after the edit.",
    properties: {
        stop_code: { type: "string", nullable: true, maxLength: 50 },
        name_mm: { type: "string", nullable: true, maxLength: 255 },
        name_en: { type: "string", nullable: true, maxLength: 255 },
        mode: { type: "string", enum: [...TRANSPORT_MODES] },
        stop_type: { type: "string", minLength: 1, maxLength: 50 },
        admin_area_id: { type: "integer", nullable: true, minimum: 1 },
        parent_stop_id: { type: "integer", nullable: true, minimum: 1 },
        review_status: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
        confidence_score: { type: "number", minimum: 0, maximum: 100 },
        is_active: { type: "boolean" },
        point: {
            type: "object",
            required: ["longitude", "latitude"],
            additionalProperties: false,
            properties: {
                longitude: { type: "number", minimum: -180, maximum: 180 },
                latitude: { type: "number", minimum: -90, maximum: 90 },
            },
        },
    },
} as const;

export const patchTransportStopSchema = {
    tags: [Tags.Transport],
    summary: "Update transport stop metadata + point (admin)",
    description:
        "Partial update of editable stop fields and point geometry. Cannot edit source_refs or normalized_data. No hard delete.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    body: updateStopBodySchema,
    response: {
        200: stopDetailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const stopPublicIdParamSchema = {
    type: "object",
    required: ["stopPublicId"],
    properties: { stopPublicId: { type: "string", format: "uuid" } },
} as const;

const nearbyStopSchema = {
    type: "object",
    required: ["stop_public_id", "name", "distance_m", "mode", "stop_type"],
    properties: {
        stop_public_id: { type: "string", format: "uuid" },
        name: { type: "string" },
        distance_m: { type: "number" },
        mode: { type: "string" },
        stop_type: { type: "string" },
    },
} as const;

const nearbyStopCandidateSchema = {
    type: "object",
    required: [
        "id",
        "publicId",
        "name",
        "nameMy",
        "nameEn",
        "mode",
        "stopType",
        "reviewStatus",
        "confidenceScore",
        "lat",
        "lng",
        "distanceMeters",
    ],
    properties: {
        id: { type: "string" },
        publicId: { type: "string", format: "uuid" },
        name: { type: "string" },
        nameMy: { type: "string", nullable: true },
        nameEn: { type: "string", nullable: true },
        mode: { type: "string" },
        stopType: { type: "string" },
        reviewStatus: { type: "string" },
        confidenceScore: { type: "number", nullable: true },
        lat: { type: "number" },
        lng: { type: "number" },
        distanceMeters: { type: "number" },
    },
} as const;

export const getTransportNearbyStopCandidatesSchema = {
    tags: [Tags.Transport],
    summary: "List nearby transport stop candidates for Review Map (admin)",
    description:
        "Reusable Review Map helper. Returns same-mode non-deleted stops within an allowed " +
        "radius around lng/lat, excludes selectedStopId (stop public_id), and orders by distance. " +
        "Route usage counts are not included — load GET /transport/stops/:publicId/route-usage-detail " +
        "for the selected stop or a candidate.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        additionalProperties: false,
        required: ["lng", "lat", "mode", "selectedStopId"],
        properties: {
            lng: { type: "number", minimum: -180, maximum: 180 },
            lat: { type: "number", minimum: -90, maximum: 90 },
            radiusMeters: { type: "integer", enum: [50, 100, 200, 500], default: 100 },
            mode: { type: "string", enum: [...TRANSPORT_MODES] },
            selectedStopId: { type: "string", format: "uuid" },
            selectedName: { type: "string", minLength: 1, maxLength: 255 },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 30 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["items", "radiusMeters", "limit"],
            properties: {
                items: { type: "array", items: nearbyStopCandidateSchema },
                radiusMeters: { type: "integer", enum: [50, 100, 200, 500] },
                limit: { type: "integer", minimum: 1, maximum: 50 },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

const updateStopLocationBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["lng", "lat"],
    description:
        "Location-only edit. Moves the stop point and optionally updates review_status / confidence_score. " +
        "Names, mode, stop_type, admin area, and parent are not editable here — use PATCH /transport/stops/:publicId. " +
        "Stamps a minimal manual/admin marker into source_refs. No hard delete.",
    properties: {
        lng: { type: "number", minimum: -180, maximum: 180 },
        lat: { type: "number", minimum: -90, maximum: 90 },
        review_status: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
        confidence_score: { type: "number", minimum: 0, maximum: 100 },
    },
} as const;

const stopLocationUpdateResultSchema = {
    type: "object",
    required: ["stop", "nearby_stops"],
    properties: {
        stop: stopDetailSchema,
        nearby_stops: { type: "array", items: nearbyStopSchema },
    },
} as const;

export const patchTransportStopLocationSchema = {
    tags: [Tags.Transport],
    summary: "Update a transport stop's location (admin)",
    description:
        "Focused location edit: updates geom (SRID 4326) and optionally review_status / confidence_score, " +
        "bumps updated_at, marks source_refs as a manual/admin location edit, and keeps any linked terminal " +
        "point in sync. Returns the refreshed stop detail plus stops within 30 m of the saved location.",
    security: [...bearerAuth],
    params: stopPublicIdParamSchema,
    body: updateStopLocationBodySchema,
    response: {
        200: stopLocationUpdateResultSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const getTransportStopNearbySchema = {
    tags: [Tags.Transport],
    summary: "Preview nearby stops around a point (admin)",
    description:
        "Read-only duplicate-check helper. Returns active stops within radius_m (default 30 m) of the given " +
        "lng/lat, nearest first, excluding the stop itself. Intended for previewing duplicates before a " +
        "location edit is committed.",
    security: [...bearerAuth],
    params: stopPublicIdParamSchema,
    querystring: {
        type: "object",
        additionalProperties: false,
        required: ["lng", "lat"],
        properties: {
            lng: { type: "number", minimum: -180, maximum: 180 },
            lat: { type: "number", minimum: -90, maximum: 90 },
            radius_m: { type: "number", minimum: 1, maximum: 500, default: 30 },
        },
    },
    response: {
        200: { type: "array", items: nearbyStopSchema },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const deleteTransportStopSchema = {
    tags: [Tags.Transport],
    summary: "Archive (soft-delete) a transport stop (admin)",
    description:
        "Soft-deletes the stop (sets deleted_at + is_active = false). Never hard-deletes and never " +
        "deletes route_stops. Rejected with 409 when the stop is still used by routes — remove it from " +
        "all routes first. Any terminal linked to the stop is archived in the same transaction. " +
        "stop_names and source_links are preserved. Accepts an optional JSON body `{ reason }` recorded " +
        "in the archive audit log.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    body: {
        type: "object",
        additionalProperties: false,
        properties: {
            reason: { type: "string", maxLength: 500 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["archived", "public_id", "route_count", "archived_terminals"],
            properties: {
                archived: { type: "boolean" },
                public_id: { type: "string", format: "uuid" },
                route_count: { type: "integer", minimum: 0 },
                archived_terminals: {
                    type: "array",
                    items: { type: "string", format: "uuid" },
                },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: badRequestSchema,
    },
} satisfies FastifySchema;

const stopDeleteReferenceCountsSchema = {
    type: "object",
    required: [
        "route_stops",
        "variant_endpoints",
        "child_stops",
        "linked_terminals",
        "fares",
    ],
    properties: {
        route_stops: { type: "integer", minimum: 0 },
        variant_endpoints: { type: "integer", minimum: 0 },
        child_stops: { type: "integer", minimum: 0 },
        linked_terminals: { type: "integer", minimum: 0 },
        fares: { type: "integer", minimum: 0 },
    },
} as const;

export const getTransportStopDeleteEligibilitySchema = {
    tags: [Tags.Transport],
    summary: "Check whether a transport stop can be permanently deleted (admin)",
    description:
        "Read-only reference check across route_stops, variant endpoints, child stops, " +
        "linked terminals, and fares (when fare stop columns exist). Verified and " +
        "manual_protected stops are never eligible.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    response: {
        200: {
            type: "object",
            required: [
                "can_delete",
                "message",
                "has_route_usage",
                "route_count",
                "review_status",
                "references",
                "blockers",
            ],
            properties: {
                can_delete: { type: "boolean" },
                message: { type: "string" },
                has_route_usage: { type: "boolean" },
                route_count: { type: "integer", minimum: 0 },
                review_status: { type: "string" },
                references: stopDeleteReferenceCountsSchema,
                blockers: { type: "array", items: { type: "string" } },
            },
        },
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const permanentDeleteTransportStopSchema = {
    tags: [Tags.Transport],
    summary: "Permanently delete a transport stop (admin)",
    description:
        "Hard-deletes the stop when it has no blocking references and is not verified / " +
        "manual_protected. Deletes related stop_names and source_links in the same transaction. " +
        "Rejected with 409 when references remain or the stop is protected. Accepts an optional " +
        "JSON body `{ reason }` recorded in the delete audit log.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    body: {
        type: "object",
        additionalProperties: false,
        properties: {
            reason: { type: "string", maxLength: 500 },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["deleted", "public_id"],
            properties: {
                deleted: { type: "boolean" },
                public_id: { type: "string", format: "uuid" },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: {
            type: "object",
            required: ["message", "has_route_usage", "route_count", "blockers"],
            properties: {
                message: { type: "string" },
                has_route_usage: { type: "boolean" },
                route_count: { type: "integer", minimum: 0 },
                blockers: { type: "array", items: { type: "string" } },
            },
        },
    },
} satisfies FastifySchema;

const routeMetadataSchema = {
    type: "object",
    required: ["summary", "names", "counts", "train", "diagnostics"],
    properties: {
        summary: {
            type: "object",
            required: [
                "mode",
                "routeKind",
                "routeType",
                "trainType",
                "trainModel",
                "operationDays",
                "sourceStatus",
                "reviewStatus",
                "isActive",
                "confidenceScore",
            ],
            properties: {
                mode: { type: "string" },
                routeKind: { type: "string" },
                routeType: { type: "string", nullable: true },
                trainType: { type: "string", nullable: true },
                trainModel: { type: "string", nullable: true },
                operationDays: { type: "array", items: { type: "string" } },
                sourceStatus: { type: "string", enum: ["none", "linked", "imported"] },
                reviewStatus: { type: "string" },
                isActive: { type: "boolean" },
                confidenceScore: { type: "number", nullable: true },
                generation: { type: "string", nullable: true },
            },
        },
        names: {
            type: "object",
            required: [
                "routeCode",
                "nameMy",
                "nameEn",
                "originName",
                "destinationName",
                "displayHeadsign",
            ],
            properties: {
                routeCode: { type: "string" },
                nameMy: { type: "string", nullable: true },
                nameEn: { type: "string", nullable: true },
                originName: { type: "string", nullable: true },
                destinationName: { type: "string", nullable: true },
                displayHeadsign: { type: "string", nullable: true },
            },
        },
        counts: {
            type: "object",
            required: ["variantCount", "stopCount", "pathCount", "sourceLinksCount"],
            properties: {
                variantCount: { type: "integer", minimum: 0 },
                stopCount: { type: "integer", minimum: 0 },
                pathCount: { type: "integer", minimum: 0 },
                sourceLinksCount: { type: "integer", minimum: 0 },
            },
        },
        train: {
            type: "object",
            required: [
                "trainNumber",
                "trainType",
                "trainModel",
                "operationDays",
                "totalStations",
                "estimatedDurationMin",
                "displayGroup",
                "isYangonUrbanService",
                "isSourceFullLoop",
                "closingDuplicateStopSkipped",
                "importedRouteStops",
            ],
            properties: {
                trainNumber: { type: "string", nullable: true },
                trainType: { type: "string", nullable: true },
                trainModel: { type: "string", nullable: true },
                operationDays: { type: "array", items: { type: "string" } },
                totalStations: { type: "integer", nullable: true, minimum: 0 },
                estimatedDurationMin: { type: "integer", nullable: true, minimum: 0 },
                displayGroup: { type: "string", nullable: true },
                isYangonUrbanService: { type: "boolean" },
                isSourceFullLoop: { type: "boolean" },
                closingDuplicateStopSkipped: { type: "boolean" },
                importedRouteStops: { type: "integer", nullable: true, minimum: 0 },
            },
        },
        diagnostics: {
            type: "object",
            required: [
                "hasSourceLinks",
                "hasPath",
                "hasCompleteStopSequence",
                "hasStopLocationWarnings",
            ],
            properties: {
                hasSourceLinks: { type: "boolean" },
                hasPath: { type: "boolean" },
                hasCompleteStopSequence: { type: "boolean" },
                hasStopLocationWarnings: { type: "boolean" },
            },
        },
    },
} as const;

const routeDetailSchema = {
    type: "object",
    required: [
        "public_id",
        "route_code",
        "public_name",
        "display_name",
        "mode",
        "route_kind",
        "review_status",
        "is_active",
        "counts",
        "names",
        "sources",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        route_code: { type: "string" },
        public_name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        display_name: { type: "string" },
        mode: { type: "string" },
        route_kind: { type: "string" },
        origin_name: { type: "string", nullable: true },
        destination_name: { type: "string", nullable: true },
        origin_admin_area_id: { type: "integer", nullable: true },
        destination_admin_area_id: { type: "integer", nullable: true },
        description: { type: "string", nullable: true },
        operator: {
            type: "object",
            nullable: true,
            properties: { id: { type: "integer" }, name: { type: "string" } },
        },
        confidence_score: { type: "number", nullable: true },
        review_status: { type: "string" },
        is_active: { type: "boolean" },
        created_at: { type: "string" },
        updated_at: { type: "string" },
        deleted_at: { type: "string", nullable: true },
        counts: {
            type: "object",
            properties: {
                variants: { type: "integer", minimum: 0 },
                stops: { type: "integer", minimum: 0 },
                paths: { type: "integer", minimum: 0 },
            },
        },
        names: { type: "array", items: routeNameSchema },
        sources: { type: "array", items: sourceSummarySchema },
        routeMetadata: routeMetadataSchema,
    },
} as const;

export const getTransportRouteDetailSchema = {
    tags: [Tags.Transport],
    summary: "Get transport route detail (admin)",
    description: "Route fields, localized names, source summary, and counts. No stop list.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    response: {
        200: routeDetailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const routeDiagnosticsRouteSchema = {
    type: "object",
    required: ["normalized_data", "source_refs"],
    properties: {
        normalized_data: { type: ["object", "null"], additionalProperties: true },
        source_refs: { type: ["object", "null"], additionalProperties: true },
    },
} as const;

const routeDiagnosticsVariantSchema = {
    type: "object",
    required: ["public_id", "variant_code", "normalized_data"],
    properties: {
        public_id: { type: "string", format: "uuid" },
        variant_code: { type: "string" },
        normalized_data: { type: ["object", "null"], additionalProperties: true },
    },
} as const;

const routeDiagnosticsSourceLinkSchema = {
    type: "object",
    required: [
        "id",
        "entity_type",
        "entity_id",
        "source_name",
        "source_kind",
        "external_id",
        "source_url",
        "import_batch_id",
        "confidence_score",
        "is_primary",
        "created_at",
    ],
    properties: {
        id: { type: "integer", minimum: 1 },
        entity_type: { type: "string" },
        entity_id: { type: "integer", minimum: 1 },
        source_name: { type: "string" },
        source_kind: { type: "string" },
        external_id: { type: "string", nullable: true },
        source_url: { type: "string", nullable: true },
        import_batch_id: { type: "integer", nullable: true, minimum: 1 },
        confidence_score: { type: "number", nullable: true },
        is_primary: { type: "boolean" },
        created_at: { type: "string", format: "date-time" },
    },
} as const;

const routeDiagnosticsResponseSchema = {
    type: "object",
    required: ["route", "variants", "source_links", "validation_warnings"],
    properties: {
        route: routeDiagnosticsRouteSchema,
        variants: { type: "array", items: routeDiagnosticsVariantSchema },
        source_links: { type: "array", items: routeDiagnosticsSourceLinkSchema },
        validation_warnings: { type: "array", items: { type: "string" } },
    },
} as const;

export const getTransportRouteDiagnosticsSchema = {
    tags: [Tags.Transport],
    summary: "Route technical diagnostics (admin)",
    description:
        "Read-only technical payload for route review: normalized_data, source_refs, variant normalized_data, " +
        "source_links, and merged validation warnings from review readiness.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    response: {
        200: routeDiagnosticsResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const updateRouteBodySchema = {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
        route_code: { type: "string", minLength: 1, maxLength: 50 },
        name_mm: { type: "string", nullable: true, maxLength: 200 },
        name_en: { type: "string", nullable: true, maxLength: 200 },
        mode: { type: "string", enum: [...TRANSPORT_MODES] },
        route_kind: { type: "string", minLength: 1, maxLength: 50 },
        origin_name: { type: "string", nullable: true, maxLength: 200 },
        destination_name: { type: "string", nullable: true, maxLength: 200 },
        description: { type: "string", nullable: true, maxLength: 2000 },
        review_status: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
        confidence_score: { type: "number", minimum: 0, maximum: 100 },
        is_active: { type: "boolean" },
        train_type: { type: "string", nullable: true, maxLength: 50 },
        train_model: { type: "string", nullable: true, maxLength: 100 },
        operation_days: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 100 },
            maxItems: 14,
        },
        is_yangon_urban_service: { type: "boolean" },
        display_headsign: { type: "string", nullable: true, maxLength: 200 },
    },
} as const;

export const patchTransportRouteSchema = {
    tags: [Tags.Transport],
    summary: "Update transport route metadata (admin)",
    description:
        "Partial update of editable route fields. Names are edited via name_mm/name_en " +
        "(public_name is derived, Myanmar first, English fallback) and written to " +
        "transport.route_names. Structured train metadata merges into normalized_data keys. " +
        "display_headsign updates the primary variant headsign. Cannot edit public_name, " +
        "source_refs, or raw normalized_data blobs. No hard delete.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    body: updateRouteBodySchema,
    response: {
        200: routeDetailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const patchRouteMetadataBodyOpenApiSchema = {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
        routeNames: {
            type: "object",
            additionalProperties: false,
            properties: {
                my: { type: "string", nullable: true, maxLength: 200 },
                en: { type: "string", nullable: true, maxLength: 200 },
            },
        },
        route: {
            type: "object",
            additionalProperties: false,
            properties: {
                originName: { type: "string", nullable: true, maxLength: 200 },
                destinationName: { type: "string", nullable: true, maxLength: 200 },
                reviewStatus: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
                confidenceScore: { type: "number", minimum: 0, maximum: 100 },
            },
        },
        normalizedDataPatch: {
            type: "object",
            additionalProperties: false,
            properties: {
                train_type: { type: "string", nullable: true, maxLength: 50 },
                train_model: { type: "string", nullable: true, maxLength: 100 },
                operation_days: {
                    type: "array",
                    items: { type: "string", minLength: 1, maxLength: 100 },
                    maxItems: 14,
                },
                display_headsign: { type: "string", nullable: true, maxLength: 200 },
                is_yangon_urban_service: { type: "boolean" },
            },
        },
    },
} as const;

export const patchRouteMetadataSchema = {
    tags: [Tags.Transport],
    summary: "Patch structured transport route metadata (admin)",
    description:
        "Structured metadata editor endpoint. Upserts route_names my/en, updates route columns, " +
        "merges normalized_data keys (never replaces the full blob), and may update the primary " +
        "variant headsign from normalizedDataPatch.display_headsign. Does not edit route_stops.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    body: patchRouteMetadataBodyOpenApiSchema,
    response: {
        200: routeDetailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const variantSummarySchema = {
    type: "object",
    properties: {
        public_id: { type: "string", format: "uuid" },
        variant_code: { type: "string" },
        direction_name: { type: "string", nullable: true },
        direction_id: { type: "integer", nullable: true },
        headsign: { type: "string", nullable: true },
        origin_name: { type: "string", nullable: true },
        destination_name: { type: "string", nullable: true },
        first_stop_name: { type: "string", nullable: true },
        stop_count: { type: "integer", minimum: 0 },
        path_count: { type: "integer", minimum: 0 },
        path_status: { type: "string", enum: ["has_path", "none"] },
        distance_m: { type: "number", nullable: true },
        estimated_duration_min: { type: "integer", nullable: true },
        review_status: { type: "string" },
        confidence_score: { type: "number", nullable: true },
        is_active: { type: "boolean" },
    },
} as const;

export const getTransportRouteVariantsSchema = {
    tags: [Tags.Transport],
    summary: "List variants for a route (admin)",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    response: {
        200: {
            type: "object",
            required: ["items", "total"],
            properties: {
                items: { type: "array", items: variantSummarySchema },
                total: { type: "integer", minimum: 0 },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const createRouteBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["mode", "route_code", "public_name"],
    properties: {
        mode: { type: "string", enum: ["bus", "train", "ferry"] },
        route_code: { type: "string", minLength: 1, maxLength: 50 },
        public_name: { type: "string", minLength: 1, maxLength: 200 },
        origin_name: { type: "string", nullable: true, maxLength: 200 },
        destination_name: { type: "string", nullable: true, maxLength: 200 },
        operator_id: { type: "integer", nullable: true, minimum: 1 },
        create_return_variant: { type: "boolean" },
        is_loop: { type: "boolean" },
    },
} as const;

const routeWithVariantsSchema = {
    ...routeDetailSchema,
    required: [...routeDetailSchema.required, "variants"],
    properties: {
        ...routeDetailSchema.properties,
        variants: { type: "array", items: variantSummarySchema },
    },
} as const;

export const postTransportRouteSchema = {
    tags: [Tags.Transport],
    summary: "Create transport route with auto variants (admin)",
    description:
        "Creates a route and its default variants in one transaction. route_kind is " +
        "derived from the mode config; review_status=needs_review, confidence_score=60, " +
        "is_active=true, and manual/admin source_refs are set by the server. Variants: " +
        "YBS bus -> ${code}-D0 + ${code}-D1; loop -> ${code}-LOOP; " +
        "other bus/train -> ${code}-A outbound + ${code}-B inbound; " +
        "ferry -> ${code}-A outbound (+ ${code}-B inbound when create_return_variant). " +
        "Returns the created route detail including variants. 409 on duplicate code.",
    security: [...bearerAuth],
    body: createRouteBodySchema,
    response: {
        201: routeWithVariantsSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        409: badRequestSchema,
    },
} satisfies FastifySchema;

const updateVariantBodySchema = {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
        variant_code: { type: "string", minLength: 1, maxLength: 50 },
        direction_name: { type: "string", nullable: true, maxLength: 100 },
        direction_id: { type: "integer", nullable: true, minimum: 0, maximum: 32767 },
        headsign: { type: "string", nullable: true, maxLength: 200 },
        origin_name: { type: "string", nullable: true, maxLength: 200 },
        destination_name: { type: "string", nullable: true, maxLength: 200 },
        estimated_duration_min: { type: "integer", nullable: true, minimum: 0, maximum: 100000 },
        review_status: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
        confidence_score: { type: "number", minimum: 0, maximum: 100 },
        is_active: { type: "boolean" },
    },
} as const;

export const patchTransportVariantSchema = {
    tags: [Tags.Transport],
    summary: "Update transport route variant metadata (admin)",
    description:
        "Partial update of editable variant fields. For YBS bus routes, direction_id is the source of truth and variant_code/direction_name are derived as D0/D1. Cannot edit source_refs or normalized_data. No hard delete.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    body: updateVariantBodySchema,
    response: {
        200: variantSummarySchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const routeVariantsParamSchema = {
    type: "object",
    required: ["routePublicId"],
    properties: { routePublicId: { type: "string", format: "uuid" } },
} as const;

const variantPublicIdParamSchema = {
    type: "object",
    required: ["variantPublicId"],
    properties: { variantPublicId: { type: "string", format: "uuid" } },
} as const;

const createVariantBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["variant_code"],
    properties: {
        variant_code: { type: "string", minLength: 1, maxLength: 50 },
        direction_id: { type: "integer", nullable: true, minimum: 0, maximum: 2 },
        direction_name: { type: "string", nullable: true, maxLength: 100 },
        headsign: { type: "string", nullable: true, maxLength: 200 },
        origin_name: { type: "string", nullable: true, maxLength: 200 },
        destination_name: { type: "string", nullable: true, maxLength: 200 },
        origin_stop_public_id: { type: "string", format: "uuid", nullable: true },
        destination_stop_public_id: { type: "string", format: "uuid", nullable: true },
        review_status: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
        confidence_score: { type: "number", minimum: 0, maximum: 100 },
    },
} as const;

const patchVariantBodySchema = {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
        variant_code: { type: "string", minLength: 1, maxLength: 50 },
        direction_id: { type: "integer", nullable: true, minimum: 0, maximum: 2 },
        direction_name: { type: "string", nullable: true, maxLength: 100 },
        headsign: { type: "string", nullable: true, maxLength: 200 },
        origin_name: { type: "string", nullable: true, maxLength: 200 },
        destination_name: { type: "string", nullable: true, maxLength: 200 },
        origin_stop_public_id: { type: "string", format: "uuid", nullable: true },
        destination_stop_public_id: { type: "string", format: "uuid", nullable: true },
        review_status: { type: "string", enum: [...TRANSPORT_REVIEW_STATUSES] },
        confidence_score: { type: "number", minimum: 0, maximum: 100 },
    },
} as const;

export const postSwapRouteDirectionSchema = {
    tags: [Tags.Transport],
    summary: "Swap direction metadata for a two-variant route (admin)",
    description:
        "Atomically swaps direction_id, direction_name, and variant_code between the route's " +
        "two active variants. YBS uses neutral D0/D1 labels and preserves normalized_data " +
        "provenance; non-YBS modes retain existing direction semantics. Requires exactly one " +
        "direction_id 0 and one direction_id 1. Does not change route_stops, paths, or endpoint stop pointers.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    response: {
        200: {
            type: "object",
            required: ["variants"],
            properties: {
                variants: { type: "array", items: variantSummarySchema, minItems: 2, maxItems: 2 },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const postRouteVariantSchema = {
    tags: [Tags.Transport],
    summary: "Create a route variant (admin)",
    description:
        "Creates a variant under an active route. variant_code is unique per route " +
        "(route_id + variant_code); a collision returns 409. For YBS bus routes, direction_id " +
        "0/1 generates canonical D0/D1 identity without geographic meaning. Other modes retain " +
        "existing semantics; 2 is loop/branch/special and null unknown. review_status defaults to " +
        "needs_review and confidence_score to 60 when omitted. Returns the created variant.",
    security: [...bearerAuth],
    params: routeVariantsParamSchema,
    body: createVariantBodySchema,
    response: {
        201: variantSummarySchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: badRequestSchema,
    },
} satisfies FastifySchema;

export const patchVariantSchema = {
    tags: [Tags.Transport],
    summary: "Update a route variant (admin)",
    description:
        "Partial update of editable variant fields, including origin/destination stop " +
        "pointers (by stop public_id; null clears). Cannot edit source_refs or " +
        "normalized_data. No hard delete. Returns the updated variant.",
    security: [...bearerAuth],
    params: variantPublicIdParamSchema,
    body: patchVariantBodySchema,
    response: {
        200: variantSummarySchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: badRequestSchema,
    },
} satisfies FastifySchema;

export const deleteVariantSchema = {
    tags: [Tags.Transport],
    summary: "Soft-delete a route variant (admin)",
    description:
        "Soft-deletes the variant (deleted_at = now(), is_active = false). Never hard-deletes " +
        "and never removes route_stops or route_paths. Returns the parent route detail.",
    security: [...bearerAuth],
    params: variantPublicIdParamSchema,
    response: {
        200: routeDetailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const variantPathResultSchema = {
    type: "object",
    required: ["path", "variant"],
    properties: {
        path: {
            type: "object",
            nullable: true,
            required: ["path_kind", "distance_m", "geometry"],
            properties: {
                path_kind: { type: "string" },
                distance_m: { type: "number", nullable: true },
                geometry: { ...geoJsonGeometrySchema, nullable: true },
            },
        },
        variant: variantSummarySchema,
    },
} as const;

const putVariantPathBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["coordinates"],
    description:
        "Upserts the variant's single active manual route path from an ordered LineString " +
        "(≥ 2 [lng, lat] positions). path_kind may be manual or manual_drawn when the " +
        "geometry was edited in the dashboard. Sets review_status=needs_review, " +
        "confidence_score=70, is_active=true and recomputes distance_m.",
    properties: {
        coordinates: {
            type: "array",
            minItems: 2,
            items: {
                type: "array",
                minItems: 2,
                maxItems: 2,
                items: { type: "number" },
            },
        },
        path_kind: { type: "string", enum: ["manual", "manual_drawn"] },
        manually_adjusted: { type: "boolean" },
    },
} as const;

export const putTransportVariantPathSchema = {
    tags: [Tags.Transport],
    summary: "Create or replace a route variant's path (admin)",
    description:
        "Upserts the variant's single active manual route path. If an active path exists it is updated " +
        "in place; otherwise one is inserted. No second active path is ever created. Returns the updated " +
        "path geometry plus the refreshed variant summary.",
    security: [...bearerAuth],
    params: variantPublicIdParamSchema,
    body: putVariantPathBodySchema,
    response: {
        200: variantPathResultSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const deleteTransportVariantPathSchema = {
    tags: [Tags.Transport],
    summary: "Soft-delete a route variant's path (admin)",
    description:
        "Soft-deletes the variant's active route path (deleted_at = now(), is_active = false). Never " +
        "hard-deletes, and never touches the variant or its stops. A no-op when no active path exists. " +
        "Returns the path (now null) plus the variant summary.",
    security: [...bearerAuth],
    params: variantPublicIdParamSchema,
    response: {
        200: variantPathResultSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const generatePathFromStopsResultSchema = {
    type: "object",
    required: ["route_path_id", "path_kind", "review_status", "geometry", "warnings"],
    properties: {
        route_path_id: { type: "string", format: "uuid" },
        path_kind: { type: "string" },
        review_status: { type: "string" },
        geometry: geoJsonGeometrySchema,
        distance_m: { type: "number", nullable: true },
        warnings: { type: "array", items: { type: "string" } },
    },
} as const;

export const postGeneratePathFromStopsSchema = {
    tags: [Tags.Transport],
    summary: "Generate a road-following path from ordered stops (admin)",
    description:
        "Builds a Valhalla-snapped route path through the variant's ordered stop coordinates " +
        "(all route_stop occurrences, including circular loop closure), replaces the active " +
        "route_paths row for this variant, and returns the new geometry.",
    security: [...bearerAuth],
    params: routeVariantsParamSchema,
    response: {
        200: generatePathFromStopsResultSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        501: { type: "object", properties: { message: { type: "string" } } },
    },
} satisfies FastifySchema;

const routeStopItemSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        stop_sequence: { type: "integer" },
        pickup_type: { type: "integer" },
        drop_off_type: { type: "integer" },
        is_timing_point: { type: "boolean" },
        distance_from_start_m: { type: "number", nullable: true },
        source_time_text: {
            type: "string",
            nullable: true,
            description: "Read-only import provenance (e.g. 04:45 PM). Not editable via API.",
        },
        source_time_type: {
            type: "string",
            nullable: true,
            description: "Read-only import provenance: arrival, departure, arrival_departure, or unknown.",
        },
        travel_time_from_previous_seconds: { type: "integer", nullable: true },
        waiting_time_seconds: { type: "integer", nullable: true },
        arrival_offset_seconds: { type: "integer", nullable: true },
        departure_offset_seconds: { type: "integer", nullable: true },
        stop: {
            type: "object",
            properties: {
                public_id: { type: "string", format: "uuid" },
                name: { type: "string" },
                name_mm: { type: "string", nullable: true },
                name_en: { type: "string", nullable: true },
                mode: { type: "string" },
                stop_type: { type: "string" },
                geometry: { ...geoJsonGeometrySchema, nullable: true },
            },
        },
    },
} as const;

/** Shared 200 body for variant ordered-stops (GET list + insert-existing). */
const variantStopsResponseSchema = {
    type: "object",
    required: ["items", "total", "limit", "offset", "path"],
    properties: {
        items: { type: "array", items: routeStopItemSchema },
        total: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0 },
        path: {
            type: "object",
            nullable: true,
            properties: {
                path_kind: { type: "string" },
                distance_m: { type: "number", nullable: true },
                geometry: { ...geoJsonGeometrySchema, nullable: true },
            },
        },
    },
} as const;

/** Flat lightweight ordered-stop row returned by route_stop mutations. */
const orderedStopLiteSchema = {
    type: "object",
    required: [
        "route_stop_id",
        "stop_public_id",
        "stop_sequence",
        "display_name",
        "name_mm",
        "name_en",
        "mode",
        "stop_type",
        "longitude",
        "latitude",
        "actual_longitude",
        "actual_latitude",
        "geometry_source",
        "pickup_type",
        "drop_off_type",
        "is_timing_point",
        "is_loop_closure",
    ],
    properties: {
        route_stop_id: { type: "string" },
        stop_public_id: { type: "string", format: "uuid" },
        stop_sequence: { type: "integer" },
        display_name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        mode: { type: "string" },
        stop_type: { type: "string" },
        longitude: { type: "number", nullable: true },
        latitude: { type: "number", nullable: true },
        actual_longitude: { type: "number", nullable: true },
        actual_latitude: { type: "number", nullable: true },
        geometry_source: { type: "string", enum: ["route_stop_review_geom", "stop_geom"] },
        pickup_type: { type: "integer" },
        drop_off_type: { type: "integer" },
        is_timing_point: { type: "boolean" },
        review_status: { type: "string" },
        source_time_text: {
            type: "string",
            nullable: true,
            description: "Read-only import provenance (e.g. 04:45 PM). Not editable via API.",
        },
        source_time_type: {
            type: "string",
            nullable: true,
            description: "Read-only import provenance: arrival, departure, arrival_departure, or unknown.",
        },
        travel_time_from_previous_seconds: { type: "integer", nullable: true },
        waiting_time_seconds: { type: "integer", nullable: true },
        arrival_offset_seconds: { type: "integer", nullable: true },
        departure_offset_seconds: { type: "integer", nullable: true },
        is_loop_closure: { type: "boolean" },
    },
} as const;

/**
 * Shared compact 200 body for route_stop mutations (insert-existing /
 * create-and-insert / remove). Returns the full updated ordered membership plus
 * count and a cheap path-existence flag — no route path geometry, no heavy stop
 * fields — so the dashboard updates locally without a heavy refetch.
 */
const routeStopMutationResponseSchema = {
    type: "object",
    required: ["variant_public_id", "ordered_stops", "route_stop_count", "has_verified_path", "has_review_placeholder_path"],
    properties: {
        variant_public_id: { type: "string", nullable: true },
        ordered_stops: { type: "array", items: orderedStopLiteSchema },
        route_stop_count: { type: "integer", minimum: 0 },
        has_verified_path: { type: "boolean" },
        has_review_placeholder_path: { type: "boolean" },
        created_stop: {
            type: "object",
            nullable: true,
            required: [
                "route_stop_id",
                "public_id",
                "display_name",
                "name_mm",
                "name_en",
                "mode",
                "stop_type",
                "longitude",
                "latitude",
            ],
            properties: {
                route_stop_id: { type: "string" },
                public_id: { type: "string", format: "uuid" },
                display_name: { type: "string" },
                name_mm: { type: "string", nullable: true },
                name_en: { type: "string", nullable: true },
                mode: { type: "string" },
                stop_type: { type: "string" },
                longitude: { type: "number", nullable: true },
                latitude: { type: "number", nullable: true },
            },
        },
        deleted: { type: "boolean" },
    },
} as const;

export const getTransportVariantOrderedStopsSchema = {
    tags: [Tags.Transport],
    summary: "List lightweight ordered stops for a route variant (admin)",
    description:
        "Lightweight ordered-stops read for the Route Detail ordered-stop panel + map markers. " +
        "Joins only route_stops + stops, filters route_variant_id and non-deleted stops, orders by stop_sequence. " +
        "Returns the flat stop shape (no path geometry, no source_refs/normalized_data, no route detail/list) plus " +
        "route_stop_count and has_verified_path. Fetch the verified path overlay separately only when has_verified_path is true.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    response: {
        200: routeStopMutationResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const getTransportVariantStopsSchema = {
    tags: [Tags.Transport],
    summary: "List ordered stops for a route variant (admin)",
    description:
        "Stops ordered by stop_sequence with stop GeoJSON points. Pass includePath=true to also return the variant path geometry.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 1000, default: 500 },
            offset: { type: "integer", minimum: 0, default: 0 },
            includePath: { type: "string", enum: ["true", "false"] },
        },
    },
    response: {
        200: variantStopsResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const variantStopQualityItemSchema = {
    type: "object",
    required: [
        "route_stop_id",
        "stop_public_id",
        "stop_name",
        "stop_sequence",
        "lng",
        "lat",
        "distance_from_previous_m",
        "distance_from_path_m",
        "is_exact_duplicate_in_variant",
        "is_loop_closure",
        "nearby_duplicate_count",
    ],
    properties: {
        route_stop_id: { type: "string" },
        stop_public_id: { type: "string", format: "uuid" },
        stop_name: { type: "string", nullable: true },
        stop_sequence: { type: "integer" },
        lng: { type: "number", nullable: true },
        lat: { type: "number", nullable: true },
        distance_from_previous_m: { type: "number", nullable: true },
        distance_from_path_m: { type: "number", nullable: true },
        is_exact_duplicate_in_variant: { type: "boolean" },
        is_loop_closure: { type: "boolean" },
        nearby_duplicate_count: { type: "integer", minimum: 0 },
    },
} as const;

const variantStopQualityResponseSchema = {
    type: "object",
    required: ["items", "total"],
    properties: {
        items: { type: "array", items: variantStopQualityItemSchema },
        total: { type: "integer", minimum: 0 },
    },
} as const;

export const getTransportVariantStopQualitySchema = {
    tags: [Tags.Transport],
    summary: "Stop-quality diagnostics for a route variant (admin)",
    description:
        "Read-only diagnostics for one variant's ordered stops. Per stop: straight-line gap from the " +
        "previous stop (null for the first), deviation from the active route path (null when no active " +
        "path exists), a defensive exact-duplicate flag, and a count of other active same-mode stops " +
        "within ~30 m. Diagnostics only — no automatic fixes.",
    security: [...bearerAuth],
    params: variantPublicIdParamSchema,
    response: {
        200: variantStopQualityResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const insertExistingRouteStopSchema = {
    tags: [Tags.Transport],
    summary: "Insert an existing stop into a route variant (admin)",
    description:
        "Inserts an existing stop into this variant's ordered pattern at start/end or before/after an anchor route_stop. " +
        "The backend owns stop_sequence and resequences all route_stops for the variant to 1..N (the client never sends a final sequence). " +
        "The same physical stop may appear more than once (each row is a distinct route_stops occurrence). " +
        "Does not create a new stop. Returns the updated ordered stops (lightweight shape) plus route_stop_count and has_verified_path so the client can update locally without a refetch.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    body: {
        type: "object",
        required: ["position"],
        additionalProperties: false,
        properties: {
            stopPublicId: { type: "string", format: "uuid" },
            stopId: { type: "integer", minimum: 1 },
            position: { type: "string", enum: ["start", "end", "before", "after"] },
            anchorRouteStopId: { type: "string", pattern: "^\\d+$" },
            pickup_type: { type: "integer", minimum: 0, maximum: 3, default: 0 },
            drop_off_type: { type: "integer", minimum: 0, maximum: 3, default: 0 },
            is_timing_point: { type: "boolean", default: false },
        },
    },
    response: {
        200: routeStopMutationResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: badRequestSchema,
    },
} satisfies FastifySchema;

export const createAndInsertRouteStopSchema = {
    tags: [Tags.Transport],
    summary: "Create a new stop and insert it into a route variant (admin)",
    description:
        "Quick-create path for the Insert Stop modal. Creates a new stop (localized names, " +
        "mode, stop_type) and inserts it into this variant in one transaction. Placeholder " +
        "geometry is derived from the variant stop sequence, or from optional longitude/latitude " +
        "when the variant is empty. At least one of name_mm / name_en is required. The backend owns stop_sequence and resequences all route_stops for the variant to 1..N. " +
        "Returns the updated ordered stops (lightweight shape) plus route_stop_count, has_verified_path, and the created_stop summary so the client can update locally without a refetch.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    body: {
        type: "object",
        required: ["mode", "stop_type", "position"],
        additionalProperties: false,
        properties: {
            name_mm: { type: "string", minLength: 1, maxLength: 255 },
            name_en: { type: "string", minLength: 1, maxLength: 255 },
            mode: {
                type: "string",
                enum: ["bus", "express_bus", "train", "ferry", "air", "other"],
            },
            stop_type: { type: "string", minLength: 1, maxLength: 50 },
            position: { type: "string", enum: ["start", "end", "before", "after"] },
            anchorRouteStopId: { type: "string", pattern: "^\\d+$" },
            pickup_type: { type: "integer", minimum: 0, maximum: 3, default: 0 },
            drop_off_type: { type: "integer", minimum: 0, maximum: 3, default: 0 },
            is_timing_point: { type: "boolean", default: false },
            longitude: { type: "number", minimum: -180, maximum: 180 },
            latitude: { type: "number", minimum: -90, maximum: 90 },
        },
    },
    response: {
        200: routeStopMutationResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: badRequestSchema,
    },
} satisfies FastifySchema;

const routeStopIdParamSchema = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", pattern: "^\\d+$" } },
} as const;

export const patchRouteStopSchema = {
    tags: [Tags.Transport],
    summary: "Update route stop membership flags (admin)",
    description:
        "Update pickup_type, drop_off_type, and is_timing_point for a route_stops row. " +
        "stop_sequence is not editable here (use the move endpoint). " +
        "Imported source_time_text / source_time_type and timetable offsets are read-only via this route; " +
        "use PATCH /transport/route-stops/:id/timing for travel/waiting edits and " +
        "PATCH /transport/route-variants/:publicId/departure-time for the variant departure anchor.",
    security: [...bearerAuth],
    params: routeStopIdParamSchema,
    body: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
            pickup_type: { type: "integer", minimum: 0, maximum: 3 },
            drop_off_type: { type: "integer", minimum: 0, maximum: 3 },
            is_timing_point: { type: "boolean" },
        },
    },
    response: {
        200: routeStopItemSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const patchRouteStopTimingBodyOpenApiSchema = {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
        travelTimeFromPreviousSeconds: { type: "integer", minimum: 0, nullable: true },
        waitingTimeSeconds: { type: "integer", minimum: 0, nullable: true },
    },
} as const;

export const patchRouteStopTimingSchema = {
    tags: [Tags.Transport],
    summary: "Update route stop timetable inputs (admin)",
    description:
        "Update editable travel/waiting seconds on one route_stops row, recalculate arrival/departure " +
        "offsets for the whole variant in one transaction, and return the refreshed ordered stop list. " +
        "Does not change stop_id, stop geometry, stop_sequence, or imported source_time_text / source_time_type.",
    security: [...bearerAuth],
    params: routeStopIdParamSchema,
    body: patchRouteStopTimingBodyOpenApiSchema,
    response: {
        200: routeStopMutationResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const patchVariantDepartureTimeSchema = {
    tags: [Tags.Transport],
    summary: "Update variant departure time (admin)",
    description:
        "Stores departure_time_text on the variant normalized_data blob, recalculates timetable offsets " +
        "for all ordered stops in one transaction, and returns the refreshed ordered stop list.",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    body: {
        type: "object",
        required: ["departureTimeText"],
        additionalProperties: false,
        properties: {
            departureTimeText: { type: "string", nullable: true, maxLength: 200 },
        },
    },
    response: {
        200: routeStopMutationResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const moveRouteStopSchema = {
    tags: [Tags.Transport],
    summary: "Move a route stop up or down (admin)",
    description:
        "Swap a route stop's sequence with its adjacent neighbor in the same variant. Affects this route variant only.",
    security: [...bearerAuth],
    params: routeStopIdParamSchema,
    body: {
        type: "object",
        required: ["direction"],
        additionalProperties: false,
        properties: { direction: { type: "string", enum: ["up", "down"] } },
    },
    response: {
        200: {
            type: "object",
            required: ["moved"],
            properties: {
                moved: { type: "boolean" },
                variantPublicId: { type: "string", nullable: true },
            },
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const deleteRouteStopSchema = {
    tags: [Tags.Transport],
    summary: "Remove a stop from a route variant (admin)",
    description:
        "Deletes the route_stops membership row only. The stop record itself is never deleted. " +
        "After removal the remaining route_stops are resequenced to a gap-free 1..N. " +
        "Accepts an optional JSON body `{ reason }` recorded in the removal audit log. " +
        "Returns the updated ordered stops (lightweight shape) plus route_stop_count, has_verified_path, and deleted=true so the client can update locally without a refetch.",
    security: [...bearerAuth],
    params: routeStopIdParamSchema,
    response: {
        200: routeStopMutationResponseSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

const overviewResponseSchema = {
    type: "object",
    required: ["counts", "byMode", "reviewStatus", "quality", "importIssues", "schemaAvailable"],
    properties: {
        counts: {
            type: "object",
            required: [
                "routes",
                "routeVariants",
                "routePaths",
                "routeStops",
                "stops",
                "terminals",
                "infrastructureLines",
                "importBatches",
                "importErrors",
            ],
            properties: {
                routes: { type: "integer", minimum: 0 },
                routeVariants: { type: "integer", minimum: 0 },
                routePaths: { type: "integer", minimum: 0 },
                routeStops: { type: "integer", minimum: 0 },
                stops: { type: "integer", minimum: 0 },
                terminals: { type: "integer", minimum: 0 },
                infrastructureLines: { type: "integer", minimum: 0 },
                importBatches: { type: "integer", minimum: 0 },
                importErrors: { type: "integer", minimum: 0 },
            },
        },
        byMode: {
            type: "object",
            required: ["routes", "stops", "terminals", "infrastructureLines"],
            properties: {
                routes: countsByKeySchema,
                stops: countsByKeySchema,
                terminals: countsByKeySchema,
                infrastructureLines: countsByKeySchema,
            },
        },
        reviewStatus: {
            type: "object",
            required: ["routes", "stops", "terminals", "infrastructureLines"],
            properties: {
                routes: countsByKeySchema,
                stops: countsByKeySchema,
                terminals: countsByKeySchema,
                infrastructureLines: countsByKeySchema,
            },
        },
        quality: {
            type: "object",
            required: [
                "routesWithStops",
                "routesWithoutStops",
                "routeVariantsWithPath",
                "routeVariantsWithoutPath",
                "ferryTerminalsImportedUnreviewed",
                "generatedNameTerminals",
                "generatedNameStops",
            ],
            properties: {
                routesWithStops: { type: "integer", minimum: 0 },
                routesWithoutStops: { type: "integer", minimum: 0 },
                routeVariantsWithPath: { type: "integer", minimum: 0 },
                routeVariantsWithoutPath: { type: "integer", minimum: 0 },
                ferryTerminalsImportedUnreviewed: { type: "integer", minimum: 0 },
                generatedNameTerminals: { type: "integer", minimum: 0 },
                generatedNameStops: { type: "integer", minimum: 0 },
            },
        },
        importIssues: {
            type: "object",
            required: [
                "missingNameMm",
                "missingNameEn",
                "fallbackName",
                "routeGeometry",
                "routeStopMember",
                "lowConfidence",
                "other",
            ],
            properties: {
                missingNameMm: { type: "integer", minimum: 0 },
                missingNameEn: { type: "integer", minimum: 0 },
                fallbackName: { type: "integer", minimum: 0 },
                routeGeometry: { type: "integer", minimum: 0 },
                routeStopMember: { type: "integer", minimum: 0 },
                lowConfidence: { type: "integer", minimum: 0 },
                other: { type: "integer", minimum: 0 },
            },
        },
        schemaAvailable: { type: "boolean" },
    },
} as const;

export const getTransportOverviewSchema = {
    tags: [Tags.Transport],
    summary: "Transport dashboard overview (admin)",
    description:
        "Aggregate counts by entity, review status, and mode plus an import-health summary. Admin only.",
    security: [...bearerAuth],
    response: {
        200: overviewResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

const dataQualityQueuesResponseSchema = {
    type: "object",
    required: [
        "generatedNameStops",
        "generatedNameTerminals",
        "missingNameStops",
        "missingNameTerminals",
        "routesWithoutPath",
        "routesWithStopsButNoPath",
        "routesWithPathButNoStops",
        "ferryLandingCandidates",
        "lowConfidenceStops",
        "lowConfidenceTerminals",
        "lowConfidenceRoutes",
        "importErrors",
        "lowConfidenceThreshold",
        "schemaAvailable",
    ],
    properties: {
        generatedNameStops: { type: "integer", minimum: 0 },
        generatedNameTerminals: { type: "integer", minimum: 0 },
        missingNameStops: { type: "integer", minimum: 0 },
        missingNameTerminals: { type: "integer", minimum: 0 },
        routesWithoutPath: { type: "integer", minimum: 0 },
        routesWithStopsButNoPath: { type: "integer", minimum: 0 },
        routesWithPathButNoStops: { type: "integer", minimum: 0 },
        ferryLandingCandidates: { type: "integer", minimum: 0 },
        lowConfidenceStops: { type: "integer", minimum: 0 },
        lowConfidenceTerminals: { type: "integer", minimum: 0 },
        lowConfidenceRoutes: { type: "integer", minimum: 0 },
        importErrors: { type: "integer", minimum: 0 },
        lowConfidenceThreshold: { type: "integer", minimum: 0, maximum: 100 },
        schemaAvailable: { type: "boolean" },
    },
} as const;

export const getTransportDataQualityQueuesSchema = {
    tags: [Tags.Transport],
    summary: "Transport data-quality review queues (admin)",
    description:
        "Aggregate-only counts for data-quality review queues (generated/missing names, route path/stop gaps, ferry landing candidates, low-confidence rows, import errors). Admin only.",
    security: [...bearerAuth],
    response: {
        200: dataQualityQueuesResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

const qualitySummaryRowSchema = {
    type: "object",
    required: [
        "mode",
        "routes",
        "variants",
        "variants_without_stops",
        "variants_without_path",
        "variants_unknown_direction",
        "routes_without_variants",
    ],
    properties: {
        mode: { type: "string" },
        routes: { type: "integer", minimum: 0 },
        variants: { type: "integer", minimum: 0 },
        variants_without_stops: { type: "integer", minimum: 0 },
        variants_without_path: { type: "integer", minimum: 0 },
        variants_unknown_direction: { type: "integer", minimum: 0 },
        routes_without_variants: { type: "integer", minimum: 0 },
    },
} as const;

const qualitySummaryResponseSchema = {
    type: "object",
    required: ["items", "schemaAvailable"],
    properties: {
        items: { type: "array", items: qualitySummaryRowSchema },
        schemaAvailable: { type: "boolean" },
    },
} as const;

export const getTransportQualitySummarySchema = {
    tags: [Tags.Transport],
    summary: "Transport quality summary by mode (admin)",
    description:
        "Read-only per-mode counts (routes, variants, variants missing stops/path/direction, routes missing variants) to help admins triage what to fix first. Admin only.",
    security: [...bearerAuth],
    response: {
        200: qualitySummaryResponseSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

function paginatedResponse(itemSchema: Record<string, unknown>) {
    return {
        type: "object",
        required: ["items", "total", "limit", "offset"],
        properties: {
            items: { type: "array", items: itemSchema },
            total: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1 },
            offset: { type: "integer", minimum: 0 },
        },
    } as const;
}

const importBatchListItemSchema = {
    type: "object",
    required: [
        "id",
        "public_id",
        "source_name",
        "source_kind",
        "import_scope",
        "import_mode",
        "status",
        "started_at",
        "inserted_count",
        "updated_count",
        "skipped_count",
        "error_count",
        "created_at",
        "updated_at",
    ],
    properties: {
        id: { type: "integer" },
        public_id: { type: "string", format: "uuid" },
        source_name: { type: "string" },
        source_kind: { type: "string" },
        import_scope: { type: "string" },
        import_mode: { type: "string" },
        status: { type: "string" },
        started_at: { type: "string" },
        finished_at: { type: "string", nullable: true },
        inserted_count: { type: "integer" },
        updated_count: { type: "integer" },
        skipped_count: { type: "integer" },
        error_count: { type: "integer" },
        notes: { type: "string", nullable: true },
        created_at: { type: "string" },
        updated_at: { type: "string" },
    },
} as const;

export const getTransportImportBatchesSchema = {
    tags: [Tags.Transport],
    summary: "List transport import batches (admin, read-only)",
    description: "Paginated, filterable import-batch audit list. Read-only.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            sourceName: { type: "string", minLength: 1, maxLength: 120 },
            sourceKind: { type: "string", minLength: 1, maxLength: 120 },
            status: { type: "string", minLength: 1, maxLength: 50 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 },
            page: { type: "integer", minimum: 1 },
        },
    },
    response: {
        200: paginatedResponse(importBatchListItemSchema),
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

const importErrorListItemSchema = {
    type: "object",
    required: ["id", "entity_type", "error_code", "error_message", "created_at"],
    properties: {
        id: { type: "integer" },
        import_batch_id: { type: "integer", nullable: true },
        entity_type: { type: "string" },
        external_id: { type: "string", nullable: true },
        error_code: { type: "string" },
        error_message: { type: "string" },
        created_at: { type: "string" },
    },
} as const;

export const getTransportImportErrorsSchema = {
    tags: [Tags.Transport],
    summary: "List transport import errors (admin, read-only)",
    description: "Paginated, filterable import-error list (no raw payload). Read-only.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            importBatchId: { type: "integer", minimum: 1 },
            entityType: { type: "string", minLength: 1, maxLength: 50 },
            errorCode: { type: "string", minLength: 1, maxLength: 120 },
            search: { type: "string", minLength: 1, maxLength: 200 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 },
            page: { type: "integer", minimum: 1 },
        },
    },
    response: {
        200: paginatedResponse(importErrorListItemSchema),
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

const sourceLinkListItemSchema = {
    type: "object",
    required: [
        "id",
        "entity_type",
        "entity_id",
        "source_name",
        "source_kind",
        "is_primary",
        "created_at",
    ],
    properties: {
        id: { type: "integer" },
        entity_type: { type: "string" },
        entity_id: { type: "integer" },
        source_name: { type: "string" },
        source_kind: { type: "string" },
        external_id: { type: "string", nullable: true },
        source_url: { type: "string", nullable: true },
        import_batch_id: { type: "integer", nullable: true },
        confidence_score: { type: "number", nullable: true },
        is_primary: { type: "boolean" },
        created_at: { type: "string" },
    },
} as const;

export const getTransportSourceLinksSchema = {
    tags: [Tags.Transport],
    summary: "List transport source links (admin, read-only)",
    description: "Paginated, filterable source-provenance list (no payload). Read-only.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            entityType: { type: "string", minLength: 1, maxLength: 50 },
            entityId: { type: "integer", minimum: 1 },
            sourceName: { type: "string", minLength: 1, maxLength: 120 },
            sourceKind: { type: "string", minLength: 1, maxLength: 120 },
            externalId: { type: "string", minLength: 1, maxLength: 200 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 },
            page: { type: "integer", minimum: 1 },
        },
    },
    response: {
        200: paginatedResponse(sourceLinkListItemSchema),
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;
