import { z } from "zod";

import { SEARCH_INDEX_HEALTH_FAMILIES } from "./search-index-health.js";
import { UNIFIED_SEARCH_SYNC_ENTITY_TYPES } from "./unified-search-sync.types.js";

const healthFamilyEnum = z.enum(
    SEARCH_INDEX_HEALTH_FAMILIES as [string, ...string[]],
);

const incrementalEntityTypeEnum = z.enum([
    ...UNIFIED_SEARCH_SYNC_ENTITY_TYPES,
] as [string, ...string[]]);

export const reindexSearchFamilyBodySchema = z.object({
    entity_family: healthFamilyEnum,
});

export const reindexSearchEntityBodySchema = z.object({
    entity_type: incrementalEntityTypeEnum,
    entity_id: z.coerce.bigint().refine((value) => value > 0n, {
        message: "entity_id must be a positive integer",
    }),
});

export type ReindexSearchFamilyBody = z.infer<typeof reindexSearchFamilyBodySchema>;
export type ReindexSearchEntityBody = z.infer<typeof reindexSearchEntityBodySchema>;
