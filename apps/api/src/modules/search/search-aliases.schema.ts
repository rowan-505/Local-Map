import { z } from "zod";

import { SEARCH_ALIAS_TYPES } from "./search-aliases.types.js";
import { queryBooleanSchema } from "./query-boolean.schema.js";
import {
    CANONICAL_TRANSPORT_SEARCH_ENTITY_TYPES,
    LEGACY_TRANSPORT_SEARCH_ENTITY_TYPES,
} from "./transport-search-entity.js";

/** Entity types that may appear in `search.search_documents` (canonical index types). */
export const SEARCH_ALIAS_ENTITY_TYPES = [
    "place",
    "settlement",
    "admin_area",
    "street_group",
    "address",
    ...CANONICAL_TRANSPORT_SEARCH_ENTITY_TYPES,
    "building",
    "land_area",
    "water_line",
    "water_polygon",
] as const;

const SEARCH_ALIAS_ENTITY_TYPE_SET = new Set<string>(SEARCH_ALIAS_ENTITY_TYPES);

const SEARCH_ALIAS_ENTITY_INPUT_TYPES = [
    ...SEARCH_ALIAS_ENTITY_TYPES,
    ...LEGACY_TRANSPORT_SEARCH_ENTITY_TYPES,
] as const;

export type SearchAliasEntityType = (typeof SEARCH_ALIAS_ENTITY_TYPES)[number];

export function isSearchAliasEntityType(value: string): value is SearchAliasEntityType {
    return SEARCH_ALIAS_ENTITY_TYPE_SET.has(value);
}

const entityIdSchema = z
    .string()
    .trim()
    .regex(/^\d+$/, "entity_id must be a numeric id")
    .transform((value) => BigInt(value));

export const listSearchAliasesQuerySchema = z.object({
    q: z.string().trim().min(1).optional(),
    entity_type: z.enum(SEARCH_ALIAS_ENTITY_INPUT_TYPES).optional(),
    language_code: z.string().trim().min(1).max(16).optional(),
    alias_type: z.enum(SEARCH_ALIAS_TYPES).optional(),
    is_active: queryBooleanSchema.optional(),
    entity_id: entityIdSchema.optional(),
    has_indexed_entity: queryBooleanSchema.optional(),
    sort: z.enum(["alias_text", "created_at", "updated_at"]).default("updated_at"),
    order: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListSearchAliasesQuery = z.infer<typeof listSearchAliasesQuerySchema>;

export const searchAliasIdParamSchema = z.object({
    id: z
        .string()
        .trim()
        .regex(/^\d+$/, "id must be a numeric id")
        .transform((value) => BigInt(value)),
});

export const createSearchAliasBodySchema = z.object({
    entity_type: z.enum(SEARCH_ALIAS_ENTITY_INPUT_TYPES),
    entity_id: entityIdSchema,
    alias_text: z.string().trim().min(1).max(500),
    alias_type: z.enum(SEARCH_ALIAS_TYPES).default("common_name"),
    language_code: z.string().trim().min(1).max(16).nullish(),
    source: z.string().trim().min(1).max(120).nullish(),
    is_active: z.boolean().default(true),
});

export type CreateSearchAliasBody = z.infer<typeof createSearchAliasBodySchema>;

export const updateSearchAliasBodySchema = z
    .object({
        alias_text: z.string().trim().min(1).max(500).optional(),
        alias_type: z.enum(SEARCH_ALIAS_TYPES).optional(),
        language_code: z.string().trim().min(1).max(16).nullable().optional(),
        source: z.string().trim().min(1).max(120).nullable().optional(),
        is_active: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
        message: "At least one field is required",
    });

export type UpdateSearchAliasBody = z.infer<typeof updateSearchAliasBodySchema>;
