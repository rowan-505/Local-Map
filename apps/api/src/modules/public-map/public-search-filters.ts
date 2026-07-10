import { Prisma } from "@prisma/client";

import { expandSearchEntityTypeFilters } from "../search/transport-search-entity.js";

/** Default searchable entity surface when category=all and no legacy types filter. */
export const DEFAULT_PUBLIC_SEARCH_ENTITY_TYPES = [
    "place",
    "address",
    "transport_stop",
    "transport_terminal",
    "transport_route",
    "transport_route_variant",
    "bus_stop",
    "admin_area",
    "street_group",
    "street",
    "bus_route",
    "bus_route_variant",
    "building",
    "water_line",
    "water_polygon",
    "landuse",
] as const;

/** Public search top-level category chips. */
export const PUBLIC_SEARCH_CATEGORIES = [
    "all",
    "places",
    "areas",
    "roads",
    "transport",
    "addresses",
] as const;

export type PublicSearchCategory = (typeof PUBLIC_SEARCH_CATEGORIES)[number];

/** Transport subtype chips (only applied when category=transport). */
export const PUBLIC_SEARCH_TRANSPORT_TYPES = [
    "all",
    "stops",
    "stations",
    "terminals",
    "routes",
] as const;

export type PublicSearchTransportType = (typeof PUBLIC_SEARCH_TRANSPORT_TYPES)[number];

/** Transport mode chips (only applied when category=transport). */
export const PUBLIC_SEARCH_TRANSPORT_MODES = [
    "all",
    "bus",
    "train",
    "express",
    "ferry",
    "flight",
    "other",
] as const;

export type PublicSearchTransportMode = (typeof PUBLIC_SEARCH_TRANSPORT_MODES)[number];

const CATEGORY_ENTITY_TYPES: Record<Exclude<PublicSearchCategory, "all">, readonly string[]> = {
    places: ["place"],
    areas: ["admin_area"],
    roads: ["street_group", "street"],
    transport: [
        "transport_stop",
        "transport_terminal",
        "transport_route",
        "transport_route_variant",
    ],
    addresses: ["address"],
};

const TRANSPORT_ROUTE_ENTITY_TYPES = ["transport_route", "transport_route_variant"] as const;
const TRANSPORT_STOP_ENTITY_TYPES = ["transport_stop", "bus_stop"] as const;

const TRANSPORT_STOP_TYPE_GROUPS: Record<
    Exclude<PublicSearchTransportType, "all" | "terminals" | "routes">,
    readonly string[]
> = {
    stops: ["stop", "bus_stop", "ferry_landing"],
    stations: ["station", "airport"],
};

export type ResolvedPublicSearchFilters = {
    /** Canonical entity types requested (before legacy alias expansion). */
    entityTypes: readonly string[];
    /** Expanded entity types for SQL IN (...) — includes legacy bus_* aliases. */
    expandedEntityTypes: readonly string[];
    category: PublicSearchCategory;
    transportType: PublicSearchTransportType;
    /** Requested transport mode chip (all when not narrowing). */
    transportMode: PublicSearchTransportMode;
    /** Active transport mode SQL filter, or null when mode=all. */
    transportModeFilter: PublicSearchTransportMode | null;
    transportStopTypes: readonly string[] | null;
};

export type PublicSearchFilterSelection = {
    category?: PublicSearchCategory | undefined;
    transportType?: PublicSearchTransportType | undefined;
    transportMode?: PublicSearchTransportMode | undefined;
    legacyTypes?: readonly string[] | undefined;
};

function intersectTypes(
    left: readonly string[],
    right: readonly string[],
): string[] {
    const allowed = new Set(right);
    return left.filter((type) => allowed.has(type));
}

/**
 * Resolve public search category / transport chips into SQL-friendly filters.
 * Legacy `types` query values are intersected when provided.
 */
export function resolvePublicSearchFilters(
    input: PublicSearchFilterSelection,
): ResolvedPublicSearchFilters {
    const category = input.category ?? "all";
    const transportType = input.transportType ?? "all";
    const transportMode = input.transportMode ?? "all";

    let entityTypes: string[] =
        category === "all" ? [...DEFAULT_PUBLIC_SEARCH_ENTITY_TYPES] : [...CATEGORY_ENTITY_TYPES[category]];

    let transportStopTypes: readonly string[] | null = null;

    if (category === "transport" && transportType !== "all") {
        if (transportType === "terminals") {
            entityTypes = ["transport_terminal"];
        } else if (transportType === "routes") {
            entityTypes = [...TRANSPORT_ROUTE_ENTITY_TYPES];
        } else if (transportType === "stops" || transportType === "stations") {
            entityTypes = [...TRANSPORT_STOP_ENTITY_TYPES];
            transportStopTypes = TRANSPORT_STOP_TYPE_GROUPS[transportType];
        }
    }

    if (input.legacyTypes && input.legacyTypes.length > 0) {
        entityTypes = intersectTypes(entityTypes, input.legacyTypes);
    }

    const expandedEntityTypes = expandSearchEntityTypeFilters(entityTypes);

    return {
        entityTypes,
        expandedEntityTypes,
        category,
        transportType,
        transportMode,
        transportModeFilter:
            category === "transport" && transportMode !== "all" ? transportMode : null,
        transportStopTypes,
    };
}

/** SQL filter clauses applied inside the scored CTE before ranking/pagination. */
export function buildPublicSearchFilterSql(filters: ResolvedPublicSearchFilters): {
    entityTypeFilter: Prisma.Sql;
    transportModeFilter: Prisma.Sql;
    transportStopTypeFilter: Prisma.Sql;
} {
    const entityTypeFilter =
        filters.expandedEntityTypes.length > 0
            ? Prisma.sql`AND d.entity_type IN (${Prisma.join([...filters.expandedEntityTypes])})`
            : Prisma.sql`AND false`;

    const transportModeFilter = filters.transportModeFilter
        ? Prisma.sql`AND lower(
              coalesce(nullif(btrim(d.category_code), ''), nullif(d.address_parts->>'mode', ''), 'other')
          ) = ${filters.transportModeFilter}`
        : Prisma.empty;

    const transportStopTypeFilter =
        filters.transportStopTypes && filters.transportStopTypes.length > 0
            ? Prisma.sql`AND (
                  d.entity_type NOT IN ('transport_stop', 'bus_stop')
                  OR lower(
                      coalesce(
                          nullif(btrim(d.category_name_en), ''),
                          nullif(d.address_parts->>'stop_type', ''),
                          ''
                      )
                  ) IN (${Prisma.join([...filters.transportStopTypes])})
              )`
            : Prisma.empty;

    return {
        entityTypeFilter,
        transportModeFilter,
        transportStopTypeFilter,
    };
}
