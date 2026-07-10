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
import { FAILED_SEARCH_RESOLUTION_TYPES } from "./failed-searches.schema.js";

const failedSearchItemSchema = {
    type: "object",
    required: [
        "id",
        "query",
        "normalized_query",
        "language",
        "category",
        "transport_type",
        "transport_mode",
        "entity_types_key",
        "types",
        "area_context_key",
        "result_count",
        "occurrence_count",
        "first_seen_at",
        "last_seen_at",
        "is_resolved",
        "resolved_at",
        "resolution_type",
        "linked_alias",
        "linked_entity",
    ],
    properties: {
        id: { type: "string" },
        query: { type: "string" },
        normalized_query: { type: "string", nullable: true },
        language: { type: "string", nullable: true },
        category: { type: "string", nullable: true },
        transport_type: { type: "string", nullable: true },
        transport_mode: { type: "string", nullable: true },
        entity_types_key: { type: "string", nullable: true },
        types: {
            type: "array",
            items: { type: "string" },
            nullable: true,
        },
        area_context_key: { type: "string", nullable: true },
        result_count: { type: "integer" },
        occurrence_count: { type: "integer" },
        first_seen_at: { type: "string", format: "date-time" },
        last_seen_at: { type: "string", format: "date-time" },
        is_resolved: { type: "boolean" },
        resolved_at: { type: "string", format: "date-time", nullable: true },
        resolution_type: {
            type: "string",
            enum: [...FAILED_SEARCH_RESOLUTION_TYPES],
            nullable: true,
        },
        linked_alias: {
            oneOf: [
                {
                    type: "object",
                    required: ["id", "alias_text"],
                    properties: {
                        id: { type: "string" },
                        alias_text: { type: "string" },
                    },
                    additionalProperties: false,
                },
                { type: "null" },
            ],
        },
        linked_entity: {
            oneOf: [
                {
                    type: "object",
                    required: ["entity_type", "entity_id", "display_name", "public_id"],
                    properties: {
                        entity_type: { type: "string" },
                        entity_id: { type: "string" },
                        display_name: { type: "string" },
                        public_id: { type: "string" },
                    },
                    additionalProperties: false,
                },
                { type: "null" },
            ],
        },
    },
    additionalProperties: false,
} as const;

const failedSearchIdParams = {
    type: "object",
    required: ["id"],
    properties: {
        id: { type: "string", pattern: "^\\d+$" },
    },
    additionalProperties: false,
} as const;

export const getFailedSearchesSchema: FastifySchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "List failed / zero-result search logs",
    security: bearerAuth,
    querystring: {
        type: "object",
        properties: {
            q: { type: "string" },
            lang: { type: "string", enum: ["my", "en", "und"] },
            resolved: { type: "string", enum: ["true", "false"] },
            last_seen_from: { type: "string", format: "date-time" },
            last_seen_to: { type: "string", format: "date-time" },
            min_occurrence: { type: "integer", minimum: 1 },
            sort: {
                type: "string",
                enum: ["occurrence_count", "last_seen_at", "first_seen_at", "query"],
            },
            order: { type: "string", enum: ["asc", "desc"] },
            page: { type: "integer", minimum: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "page", "pageSize", "sort", "order"],
            properties: {
                items: { type: "array", items: failedSearchItemSchema },
                total: { type: "integer" },
                page: { type: "integer" },
                pageSize: { type: "integer" },
                sort: { type: "string" },
                order: { type: "string", enum: ["asc", "desc"] },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
};

export const getFailedSearchByIdSchema: FastifySchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Get a failed search log by id",
    security: bearerAuth,
    params: failedSearchIdParams,
    response: {
        200: failedSearchItemSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
};

export const patchFailedSearchSchema: FastifySchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Resolve or reopen a failed search log",
    security: bearerAuth,
    params: failedSearchIdParams,
    body: {
        oneOf: [
            {
                type: "object",
                required: ["action", "resolution_type"],
                properties: {
                    action: { type: "string", enum: ["resolve"] },
                    resolution_type: { type: "string", enum: [...FAILED_SEARCH_RESOLUTION_TYPES] },
                    linked_alias_id: { type: "string", pattern: "^\\d+$" },
                },
                additionalProperties: false,
            },
            {
                type: "object",
                required: ["action"],
                properties: {
                    action: { type: "string", enum: ["reopen"] },
                },
                additionalProperties: false,
            },
        ],
    },
    response: {
        200: failedSearchItemSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
};
