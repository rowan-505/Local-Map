import {
    CANONICAL_TRANSPORT_SEARCH_ENTITY_TYPES,
    LEGACY_TRANSPORT_SEARCH_ENTITY_TYPES,
} from "./transport-search-entity.js";

/** Unified search document entity types supported by incremental sync. */
export const UNIFIED_SEARCH_SYNC_ENTITY_TYPES = [
    "place",
    "settlement",
    "admin_area",
    "street_group",
    ...CANONICAL_TRANSPORT_SEARCH_ENTITY_TYPES,
    ...LEGACY_TRANSPORT_SEARCH_ENTITY_TYPES,
] as const;

export type UnifiedSearchSyncEntityType = (typeof UNIFIED_SEARCH_SYNC_ENTITY_TYPES)[number];

export type UnifiedSearchSyncSpec = {
    entityType: UnifiedSearchSyncEntityType;
    entityId: bigint;
};

export type UnifiedSearchSyncResult = {
    entity_type: string;
    synced: number;
    removed: number;
    entity_ids: unknown;
};
