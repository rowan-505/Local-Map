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

export const getTransportRoutesSchema = {
    tags: [Tags.Transport],
    summary: "List transport routes (admin)",
    description:
        "Paginated, filterable routes list with variant/stop/path counts. Never returns geometry.",
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
            required: ["items", "total", "limit", "offset"],
            properties: {
                items: { type: "array", items: routeListItemSchema },
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
    },
} as const;

export const patchTransportRouteSchema = {
    tags: [Tags.Transport],
    summary: "Update transport route metadata (admin)",
    description:
        "Partial update of editable route fields. Names are edited via name_mm/name_en " +
        "(public_name is derived, Myanmar first, English fallback) and written to " +
        "transport.route_names. Cannot edit public_name, source_refs, or normalized_data. " +
        "No hard delete.",
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
        "Partial update of editable variant fields. Cannot edit source_refs or normalized_data. No hard delete.",
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

const routeStopItemSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        stop_sequence: { type: "integer" },
        pickup_type: { type: "integer" },
        drop_off_type: { type: "integer" },
        is_timing_point: { type: "boolean" },
        distance_from_start_m: { type: "number", nullable: true },
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

export const insertExistingRouteStopSchema = {
    tags: [Tags.Transport],
    summary: "Insert an existing stop into a route variant (admin)",
    description:
        "Inserts an existing stop into this variant's ordered pattern at start/end or before/after an anchor route_stop. " +
        "The backend owns stop_sequence and resequences all route_stops for the variant to 1..N (the client never sends a final sequence). " +
        "Rejects a stop already present in the variant (409). Does not create a new stop. Returns the updated ordered stops list (same shape as GET variant stops).",
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
        200: variantStopsResponseSchema,
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
        "Secondary quick-create path for the Insert Stop modal. Creates a new stop (minimal fields: localized names, " +
        "mode, stop_type, location) and inserts it into this variant in one transaction. At least one of name_mm / " +
        "name_en is required. The backend owns stop_sequence and resequences all route_stops for the variant to 1..N. " +
        "Full stop metadata editing stays on the Stop Detail page. Returns the updated ordered stops list (same shape as GET variant stops).",
    security: [...bearerAuth],
    params: publicIdParamSchema,
    body: {
        type: "object",
        required: ["mode", "stop_type", "longitude", "latitude", "position"],
        additionalProperties: false,
        properties: {
            name_mm: { type: "string", minLength: 1, maxLength: 255 },
            name_en: { type: "string", minLength: 1, maxLength: 255 },
            mode: {
                type: "string",
                enum: ["bus", "express_bus", "train", "ferry", "air", "other"],
            },
            stop_type: { type: "string", minLength: 1, maxLength: 50 },
            longitude: { type: "number", minimum: -180, maximum: 180 },
            latitude: { type: "number", minimum: -90, maximum: 90 },
            position: { type: "string", enum: ["start", "end", "before", "after"] },
            anchorRouteStopId: { type: "string", pattern: "^\\d+$" },
            pickup_type: { type: "integer", minimum: 0, maximum: 3, default: 0 },
            drop_off_type: { type: "integer", minimum: 0, maximum: 3, default: 0 },
            is_timing_point: { type: "boolean", default: false },
        },
    },
    response: {
        200: variantStopsResponseSchema,
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
    summary: "Update route stop flags (admin)",
    description:
        "Update pickup_type, drop_off_type, or is_timing_point for a route_stops row. stop_sequence is not editable here (use the move endpoint).",
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
        "Returns the updated ordered stops list (same shape as GET variant stops) plus backward-compatible `deleted` / `variantPublicId` fields.",
    security: [...bearerAuth],
    params: routeStopIdParamSchema,
    response: {
        200: {
            type: "object",
            required: [...variantStopsResponseSchema.required, "deleted"],
            properties: {
                ...variantStopsResponseSchema.properties,
                deleted: { type: "boolean" },
                variantPublicId: { type: "string", nullable: true },
            },
        },
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
