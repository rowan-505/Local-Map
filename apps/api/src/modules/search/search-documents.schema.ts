import { z } from "zod";

import {
    SEARCH_DOCUMENT_ENTITY_TYPES,
    type SearchDocumentSyncState,
} from "./search-canonical-source.js";
import { queryBooleanSchema } from "./query-boolean.schema.js";
import { TRANSPORT_SEARCH_MODES } from "./transport-search-entity.js";

const LEGACY_ENTITY_FILTER_TYPES = [
    ...SEARCH_DOCUMENT_ENTITY_TYPES,
    "bus_stop",
    "bus_route",
    "bus_route_variant",
    "street",
] as const;

export const SEARCH_DOCUMENT_SORT_FIELDS = [
    "name",
    "entity_type",
    "importance",
    "confidence",
    "indexed_at",
    "source_updated_at",
] as const;

export type SearchDocumentSortField = (typeof SEARCH_DOCUMENT_SORT_FIELDS)[number];

export const SEARCH_DOCUMENT_SYNC_STATES = [
    "current",
    "stale",
    "missing",
    "ghost",
] as const satisfies readonly SearchDocumentSyncState[];

export const listSearchDocumentsQuerySchema = z.object({
    q: z.string().trim().min(1).optional(),
    entity_type: z.enum(LEGACY_ENTITY_FILTER_TYPES).optional(),
    transport_mode: z.enum(TRANSPORT_SEARCH_MODES).optional(),
    review_status: z.string().trim().min(1).max(64).optional(),
    is_verified: queryBooleanSchema.optional(),
    is_public: queryBooleanSchema.optional(),
    is_active: queryBooleanSchema.optional(),
    has_alias: queryBooleanSchema.optional(),
    sync_state: z.enum(SEARCH_DOCUMENT_SYNC_STATES).optional(),
    language: z.enum(["my", "en", "und"]).optional(),
    entity_id: z
        .string()
        .trim()
        .regex(/^\d+$/, "entity_id must be a numeric id")
        .optional(),
    sort: z.enum(SEARCH_DOCUMENT_SORT_FIELDS).default("indexed_at"),
    order: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListSearchDocumentsQuery = z.infer<typeof listSearchDocumentsQuerySchema>;
