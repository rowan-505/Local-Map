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
import { SEARCH_ALIAS_TYPES } from "./search-aliases.types.js";
import { SEARCH_ALIAS_ENTITY_TYPES } from "./search-aliases.schema.js";

const searchAliasItemSchema = {
    type: "object",
    required: [
        "id",
        "entity_type",
        "entity_id",
        "alias_text",
        "normalized_alias",
        "language_code",
        "alias_type",
        "source",
        "is_active",
        "created_by",
        "created_at",
        "updated_at",
        "indexed_entity",
    ],
    properties: {
        id: { type: "string" },
        entity_type: { type: "string" },
        entity_id: { type: "string" },
        alias_text: { type: "string" },
        normalized_alias: { type: "string" },
        language_code: { type: "string", nullable: true },
        alias_type: { type: "string", enum: [...SEARCH_ALIAS_TYPES] },
        source: { type: "string", nullable: true },
        is_active: { type: "boolean" },
        created_by: { type: "string", nullable: true },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        indexed_entity: {
            oneOf: [
                {
                    type: "object",
                    required: ["display_name", "public_id"],
                    properties: {
                        display_name: { type: "string" },
                        public_id: { type: "string" },
                    },
                    additionalProperties: false,
                },
                { type: "null" },
            ],
        },
        index_sync: {
            type: "object",
            required: ["ok", "names_added", "names_removed", "documents_updated"],
            properties: {
                ok: { type: "boolean" },
                names_added: { type: "integer" },
                names_removed: { type: "integer" },
                documents_updated: { type: "integer" },
                error: { type: "string" },
            },
            additionalProperties: false,
        },
    },
    additionalProperties: false,
} as const;

const aliasIdParams = {
    type: "object",
    required: ["id"],
    properties: {
        id: { type: "string", pattern: "^\\d+$", description: "search.search_aliases.id" },
    },
    additionalProperties: false,
} as const;

export const getSearchAliasesSchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Admin: list search aliases",
    description:
        "Admin/super_admin. Paginated list of search-only aliases with optional filters and indexed entity context.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            q: { type: "string", description: "Matches alias text or indexed display name" },
            entity_type: { type: "string", enum: [...SEARCH_ALIAS_ENTITY_TYPES] },
            language_code: { type: "string" },
            alias_type: { type: "string", enum: [...SEARCH_ALIAS_TYPES] },
            is_active: { type: "boolean" },
            entity_id: { type: "string", pattern: "^\\d+$" },
            has_indexed_entity: {
                type: "boolean",
                description: "When true, only aliases linked to an active search document",
            },
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            sort: { type: "string", enum: ["alias_text", "created_at", "updated_at"], default: "updated_at" },
            order: { type: "string", enum: ["asc", "desc"], default: "desc" },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "page", "pageSize", "sort", "order"],
            properties: {
                items: { type: "array", items: searchAliasItemSchema },
                total: { type: "integer" },
                page: { type: "integer" },
                pageSize: { type: "integer" },
                sort: { type: "string", enum: ["alias_text", "created_at", "updated_at"] },
                order: { type: "string", enum: ["asc", "desc"] },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const postSearchAliasSchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Admin: create search alias",
    description:
        "Admin/super_admin. Creates a search-only alias for an indexed entity and refreshes folded aliases for that entity.",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["entity_type", "entity_id", "alias_text"],
        properties: {
            entity_type: { type: "string", enum: [...SEARCH_ALIAS_ENTITY_TYPES] },
            entity_id: { type: "string", pattern: "^\\d+$" },
            alias_text: { type: "string", minLength: 1, maxLength: 500 },
            alias_type: { type: "string", enum: [...SEARCH_ALIAS_TYPES], default: "common_name" },
            language_code: { type: "string", nullable: true },
            source: { type: "string", nullable: true },
            is_active: { type: "boolean", default: true },
        },
        additionalProperties: false,
    },
    response: {
        201: searchAliasItemSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

export const patchSearchAliasSchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Admin: update search alias",
    description:
        "Admin/super_admin. Updates alias fields and refreshes folded aliases for the linked entity.",
    security: [...bearerAuth],
    params: aliasIdParams,
    body: {
        type: "object",
        properties: {
            alias_text: { type: "string", minLength: 1, maxLength: 500 },
            alias_type: { type: "string", enum: [...SEARCH_ALIAS_TYPES] },
            language_code: { type: "string", nullable: true },
            source: { type: "string", nullable: true },
            is_active: { type: "boolean" },
        },
        additionalProperties: false,
    },
    response: {
        200: searchAliasItemSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

export const deleteSearchAliasSchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Admin: disable search alias",
    description:
        "Admin/super_admin. Soft-disables an alias (is_active=false) and refreshes folded aliases for the linked entity.",
    security: [...bearerAuth],
    params: aliasIdParams,
    response: {
        200: searchAliasItemSchema,
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;
