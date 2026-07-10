import { Prisma } from "@prisma/client";

/** Entity types indexed in `search.search_documents` (canonical). */
export const SEARCH_DOCUMENT_ENTITY_TYPES = [
    "place",
    "admin_area",
    "street_group",
    "address",
    "transport_stop",
    "transport_terminal",
    "transport_route",
    "transport_route_variant",
    "building",
    "landuse",
    "water_line",
    "water_polygon",
] as const;

export type SearchDocumentEntityType = (typeof SEARCH_DOCUMENT_ENTITY_TYPES)[number];

export type SearchDocumentSyncState = "current" | "stale" | "missing" | "ghost";

/** Maps indexed entity_type → canonical source view (same families as search index health). */
export const SEARCH_ENTITY_TYPE_SOURCE_VIEWS: Readonly<
    Record<SearchDocumentEntityType, string>
> = {
    place: "search.v_search_places_source",
    admin_area: "search.v_search_admin_areas_source",
    street_group: "search.v_search_street_groups_source",
    address: "search.v_search_addresses_source",
    transport_stop: "search.v_search_bus_stops_source",
    transport_terminal: "search.v_search_transport_terminals_source",
    transport_route: "search.v_search_bus_routes_source",
    transport_route_variant: "search.v_search_bus_routes_source",
    building: "search.v_search_buildings_source",
    landuse: "search.v_search_landuse_source",
    water_line: "search.v_search_water_lines_source",
    water_polygon: "search.v_search_water_polygons_source",
};

const LEGACY_ENTITY_TYPE_ALIASES: Readonly<Record<string, SearchDocumentEntityType>> = {
    bus_stop: "transport_stop",
    bus_route: "transport_route",
    bus_route_variant: "transport_route_variant",
    street: "street_group",
};

export function normalizeSearchDocumentEntityType(value: string): SearchDocumentEntityType | null {
    const normalized = value.trim().toLowerCase();
    const aliased = LEGACY_ENTITY_TYPE_ALIASES[normalized] ?? normalized;
    if ((SEARCH_DOCUMENT_ENTITY_TYPES as readonly string[]).includes(aliased)) {
        return aliased as SearchDocumentEntityType;
    }
    return null;
}

export function resolveSearchDocumentEntityTypesForFilter(
    entityType: string | undefined,
): SearchDocumentEntityType[] | null {
    if (!entityType) {
        return null;
    }
    const canonical = normalizeSearchDocumentEntityType(entityType);
    if (!canonical) {
        return [];
    }
    if (canonical === "transport_route" || canonical === "transport_route_variant") {
        return ["transport_route", "transport_route_variant"];
    }
    return [canonical];
}

const CANONICAL_ROW_SELECT = Prisma.sql`
    entity_type,
    entity_id,
    source_updated_at,
    public_id,
    display_name,
    primary_name_my,
    primary_name_en,
    primary_name_und,
    address_parts,
    is_verified,
    importance_score,
    confidence_score
`;

/** Minimal canonical union used by index health checks. */
export function buildCanonicalFreshnessUnionSql(
    entityTypes: readonly SearchDocumentEntityType[] | null,
): Prisma.Sql {
    const types = entityTypes ?? SEARCH_DOCUMENT_ENTITY_TYPES;
    const uniqueViews = new Set<string>();
    for (const type of types) {
        uniqueViews.add(SEARCH_ENTITY_TYPE_SOURCE_VIEWS[type]);
    }

    const branches = [...uniqueViews].map(
        (view) =>
            Prisma.sql`SELECT entity_type, entity_id, source_updated_at FROM ${Prisma.raw(view)}`,
    );

    return Prisma.join(branches, " UNION ALL ");
}

/** Canonical inventory rows for missing-document inspection. */
export function buildCanonicalInventoryUnionSql(
    entityTypes: readonly SearchDocumentEntityType[] | null,
): Prisma.Sql {
    const types = entityTypes ?? SEARCH_DOCUMENT_ENTITY_TYPES;
    const uniqueViews = new Set<string>();
    for (const type of types) {
        uniqueViews.add(SEARCH_ENTITY_TYPE_SOURCE_VIEWS[type]);
    }

    const branches = [...uniqueViews].map(
        (view) => Prisma.sql`SELECT ${CANONICAL_ROW_SELECT} FROM ${Prisma.raw(view)}`,
    );

    return Prisma.join(branches, " UNION ALL ");
}

export function buildIndexedSyncStateSql(documentAlias = "d", canonicalAlias = "c"): Prisma.Sql {
    return Prisma.sql`CASE
        WHEN ${Prisma.raw(canonicalAlias)}.entity_id IS NULL THEN 'ghost'
        WHEN ${Prisma.raw(documentAlias)}.source_updated_at IS NULL
             OR ${Prisma.raw(canonicalAlias)}.source_updated_at IS NULL
             OR ${Prisma.raw(documentAlias)}.source_updated_at < ${Prisma.raw(canonicalAlias)}.source_updated_at
        THEN 'stale'
        ELSE 'current'
    END`;
}

export function buildIndexedSyncStateFilterSql(
    syncState: SearchDocumentSyncState,
    documentAlias = "d",
    canonicalAlias = "c",
): Prisma.Sql {
    if (syncState === "ghost") {
        return Prisma.sql`${Prisma.raw(canonicalAlias)}.entity_id IS NULL`;
    }
    if (syncState === "stale") {
        return Prisma.sql`${Prisma.raw(canonicalAlias)}.entity_id IS NOT NULL
            AND (
                ${Prisma.raw(documentAlias)}.source_updated_at IS NULL
                OR ${Prisma.raw(canonicalAlias)}.source_updated_at IS NULL
                OR ${Prisma.raw(documentAlias)}.source_updated_at < ${Prisma.raw(canonicalAlias)}.source_updated_at
            )`;
    }
    return Prisma.sql`${Prisma.raw(canonicalAlias)}.entity_id IS NOT NULL
        AND NOT (
            ${Prisma.raw(documentAlias)}.source_updated_at IS NULL
            OR ${Prisma.raw(canonicalAlias)}.source_updated_at IS NULL
            OR ${Prisma.raw(documentAlias)}.source_updated_at < ${Prisma.raw(canonicalAlias)}.source_updated_at
        )`;
}

export function computeSearchDocumentSyncState(input: {
    hasCanonical: boolean;
    indexedSourceUpdatedAt: Date | null;
    canonicalSourceUpdatedAt: Date | null;
}): SearchDocumentSyncState {
    if (!input.hasCanonical) {
        return "ghost";
    }
    if (
        input.indexedSourceUpdatedAt === null ||
        input.canonicalSourceUpdatedAt === null ||
        input.indexedSourceUpdatedAt < input.canonicalSourceUpdatedAt
    ) {
        return "stale";
    }
    return "current";
}
