import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    forbiddenSchema,
    messageSchema,
} from "../../lib/openapi/common.js";
import {
    SEARCH_DOCUMENT_SORT_FIELDS,
    SEARCH_DOCUMENT_SYNC_STATES,
} from "./search-documents.schema.js";
import { SEARCH_DOCUMENT_ENTITY_TYPES } from "./search-canonical-source.js";
import { TRANSPORT_SEARCH_MODES } from "./transport-search-entity.js";

const searchDocumentItemSchema = {
    type: "object",
    required: [
        "search_document_id",
        "entity_type",
        "entity_id",
        "public_id",
        "display_name",
        "primary_name_my",
        "primary_name_en",
        "primary_name_und",
        "transport_mode",
        "review_status",
        "is_verified",
        "is_public",
        "is_active",
        "importance_score",
        "confidence_score",
        "indexed_at",
        "source_updated_at",
        "canonical_source_updated_at",
        "alias_count",
        "sync_state",
    ],
    properties: {
        search_document_id: { type: "string", nullable: true },
        entity_type: { type: "string" },
        entity_id: { type: "string" },
        public_id: { type: "string", nullable: true },
        display_name: { type: "string", nullable: true },
        primary_name_my: { type: "string", nullable: true },
        primary_name_en: { type: "string", nullable: true },
        primary_name_und: { type: "string", nullable: true },
        transport_mode: { type: "string", nullable: true },
        review_status: { type: "string", nullable: true },
        is_verified: { type: "boolean" },
        is_public: { type: "boolean" },
        is_active: { type: "boolean" },
        importance_score: { type: "number" },
        confidence_score: { type: "number" },
        indexed_at: { type: "string", format: "date-time", nullable: true },
        source_updated_at: { type: "string", format: "date-time", nullable: true },
        canonical_source_updated_at: { type: "string", format: "date-time", nullable: true },
        alias_count: { type: "integer" },
        sync_state: { type: "string", enum: [...SEARCH_DOCUMENT_SYNC_STATES] },
    },
    additionalProperties: false,
} as const;

export const getSearchDocumentsSchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Admin: list search documents",
    description:
        "Admin/super_admin. Paginated inspection of unified search index rows with sync state, alias counts, and server-side filters/sorting.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            q: { type: "string" },
            entity_type: { type: "string", enum: [...SEARCH_DOCUMENT_ENTITY_TYPES, "bus_stop", "bus_route", "bus_route_variant", "street"] },
            transport_mode: { type: "string", enum: [...TRANSPORT_SEARCH_MODES] },
            review_status: { type: "string" },
            is_verified: { type: "boolean" },
            is_public: { type: "boolean" },
            is_active: { type: "boolean" },
            has_alias: { type: "boolean" },
            sync_state: { type: "string", enum: [...SEARCH_DOCUMENT_SYNC_STATES] },
            language: { type: "string", enum: ["my", "en", "und"] },
            sort: { type: "string", enum: [...SEARCH_DOCUMENT_SORT_FIELDS], default: "indexed_at" },
            order: { type: "string", enum: ["asc", "desc"], default: "desc" },
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 25 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items", "total", "page", "pageSize", "sort", "order"],
            properties: {
                items: { type: "array", items: searchDocumentItemSchema },
                total: { type: "integer" },
                page: { type: "integer" },
                pageSize: { type: "integer" },
                sort: { type: "string", enum: [...SEARCH_DOCUMENT_SORT_FIELDS] },
                order: { type: "string", enum: ["asc", "desc"] },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;
