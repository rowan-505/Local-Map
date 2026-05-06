import { Prisma, type PrismaClient } from "@prisma/client";

import type {
    DashboardStatsHealthCounts,
    DashboardStatsMainCounts,
    DashboardStatsMetadataCounts,
    DashboardStatsTransitCounts,
} from "./dashboard.types.js";

/** Base table names under schema `core` (unquoted lowercase). Allowlist only — never built from clients. */
const CORE_STATS_TABLE_ALLOWLIST_SQL = `
  'core_places',
  'core_map_buildings',
  'core_streets',
  'core_admin_areas',
  'core_addresses',
  'core_place_names',
  'core_street_names',
  'core_admin_area_names',
  'core_place_contacts',
  'core_place_sources',
  'core_place_media',
  'core_place_versions',
  'core_bus_routes',
  'core_bus_route_variants',
  'core_bus_stops',
  'core_bus_route_stops'
`;

/**
 * One row from information_schema-derived flags — no COUNT against optional core tables yet.
 */
type CatalogFlagRow = {
    t_core_places: boolean;
    t_core_map_buildings: boolean;
    t_core_streets: boolean;
    t_core_admin_areas: boolean;
    t_core_addresses: boolean;
    t_core_place_names: boolean;
    t_core_street_names: boolean;
    t_core_admin_area_names: boolean;
    t_core_place_contacts: boolean;
    t_core_place_sources: boolean;
    t_core_place_media: boolean;
    t_core_place_versions: boolean;
    t_core_bus_routes: boolean;
    t_core_bus_route_variants: boolean;
    t_core_bus_stops: boolean;
    t_core_bus_route_stops: boolean;
    c_core_places_deleted_at: boolean;
    c_core_places_is_verified: boolean;
    c_core_map_buildings_deleted_at: boolean;
    c_core_map_buildings_is_active: boolean;
    c_core_streets_is_active: boolean;
};

type StatsSnapshotRow = {
    places: bigint;
    map_buildings: bigint;
    streets: bigint;
    admin_areas: bigint;
    addresses: bigint;
    place_names: bigint;
    street_names: bigint;
    admin_area_names: bigint;
    place_contacts: bigint;
    place_sources: bigint;
    place_media: bigint;
    place_versions: bigint;
    bus_routes: bigint;
    bus_route_variants: bigint;
    bus_stops: bigint;
    bus_route_stops: bigint;
    places_active: bigint;
    places_deleted: bigint;
    places_verified: bigint;
    places_unverified: bigint;
    buildings_active: bigint;
    buildings_deleted: bigint;
    streets_active: bigint;
    streets_inactive: bigint;
};

function n(v: bigint | null | undefined): number {
    return Number(v ?? 0);
}

/**
 * Static SQL only references `information_schema` and the allowlist CTE — never optional physical relations.
 */
const CATALOG_FLAGS_SQL = Prisma.sql`
WITH present AS (
  SELECT table_name
  FROM information_schema.tables t
  WHERE t.table_catalog = current_database()
    AND t.table_schema = 'core'
    AND t.table_type = 'BASE TABLE'
    AND t.table_name IN (${Prisma.raw(CORE_STATS_TABLE_ALLOWLIST_SQL)})
)
SELECT
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_places') AS t_core_places,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_map_buildings') AS t_core_map_buildings,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_streets') AS t_core_streets,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_admin_areas') AS t_core_admin_areas,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_addresses') AS t_core_addresses,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_place_names') AS t_core_place_names,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_street_names') AS t_core_street_names,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_admin_area_names') AS t_core_admin_area_names,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_place_contacts') AS t_core_place_contacts,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_place_sources') AS t_core_place_sources,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_place_media') AS t_core_place_media,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_place_versions') AS t_core_place_versions,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_bus_routes') AS t_core_bus_routes,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_bus_route_variants') AS t_core_bus_route_variants,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_bus_stops') AS t_core_bus_stops,
  EXISTS (SELECT 1 FROM present p WHERE p.table_name = 'core_bus_route_stops') AS t_core_bus_route_stops,
  EXISTS (
      SELECT 1
      FROM information_schema.columns col
      WHERE col.table_catalog = current_database()
        AND col.table_schema = 'core'
        AND col.table_name = 'core_places'
        AND col.column_name = 'deleted_at'
  ) AS c_core_places_deleted_at,
  EXISTS (
      SELECT 1
      FROM information_schema.columns col
      WHERE col.table_catalog = current_database()
        AND col.table_schema = 'core'
        AND col.table_name = 'core_places'
        AND col.column_name = 'is_verified'
  ) AS c_core_places_is_verified,
  EXISTS (
      SELECT 1
      FROM information_schema.columns col
      WHERE col.table_catalog = current_database()
        AND col.table_schema = 'core'
        AND col.table_name = 'core_map_buildings'
        AND col.column_name = 'deleted_at'
  ) AS c_core_map_buildings_deleted_at,
  EXISTS (
      SELECT 1
      FROM information_schema.columns col
      WHERE col.table_catalog = current_database()
        AND col.table_schema = 'core'
        AND col.table_name = 'core_map_buildings'
        AND col.column_name = 'is_active'
  ) AS c_core_map_buildings_is_active,
  EXISTS (
      SELECT 1
      FROM information_schema.columns col
      WHERE col.table_catalog = current_database()
        AND col.table_schema = 'core'
        AND col.table_name = 'core_streets'
        AND col.column_name = 'is_active'
  ) AS c_core_streets_is_active
`;

function zeroAs(alias: keyof StatsSnapshotRow): Prisma.Sql {
    return Prisma.sql`0::bigint AS ${Prisma.raw(alias)}`;
}

function countFrom(
    alias: keyof StatsSnapshotRow,
    qualifiedRelation: string,
    hasTable: boolean
): Prisma.Sql {
    if (!hasTable) {
        return zeroAs(alias);
    }
    return Prisma.sql`(SELECT COUNT(*)::bigint FROM ${Prisma.raw(qualifiedRelation)}) AS ${Prisma.raw(alias)}`;
}

function healthCount(
    alias: keyof StatsSnapshotRow,
    qualifiedRelation: string,
    whereClause: string,
    hasTable: boolean,
    colOk: boolean
): Prisma.Sql {
    if (!hasTable || !colOk) {
        return zeroAs(alias);
    }
    return Prisma.sql`(SELECT COUNT(*)::bigint FROM ${Prisma.raw(qualifiedRelation)} WHERE ${Prisma.raw(whereClause)}) AS ${Prisma.raw(alias)}`;
}

function healthPlaces(
    alias: keyof StatsSnapshotRow,
    whereClause: string,
    f: CatalogFlagRow,
    needVerified: boolean
): Prisma.Sql {
    const hasTable = f.t_core_places;
    const colOk = f.c_core_places_deleted_at && (!needVerified || f.c_core_places_is_verified);
    return healthCount(alias, "core.core_places", whereClause, hasTable, colOk);
}

function buildSnapshotQuery(f: CatalogFlagRow): Prisma.Sql {
    const parts: Prisma.Sql[] = [
        countFrom("places", "core.core_places", f.t_core_places),
        countFrom("map_buildings", "core.core_map_buildings", f.t_core_map_buildings),
        countFrom("streets", "core.core_streets", f.t_core_streets),
        countFrom("admin_areas", "core.core_admin_areas", f.t_core_admin_areas),
        countFrom("addresses", "core.core_addresses", f.t_core_addresses),
        countFrom("place_names", "core.core_place_names", f.t_core_place_names),
        countFrom("street_names", "core.core_street_names", f.t_core_street_names),
        countFrom("admin_area_names", "core.core_admin_area_names", f.t_core_admin_area_names),
        countFrom("place_contacts", "core.core_place_contacts", f.t_core_place_contacts),
        countFrom("place_sources", "core.core_place_sources", f.t_core_place_sources),
        countFrom("place_media", "core.core_place_media", f.t_core_place_media),
        countFrom("place_versions", "core.core_place_versions", f.t_core_place_versions),
        countFrom("bus_routes", "core.core_bus_routes", f.t_core_bus_routes),
        countFrom("bus_route_variants", "core.core_bus_route_variants", f.t_core_bus_route_variants),
        countFrom("bus_stops", "core.core_bus_stops", f.t_core_bus_stops),
        countFrom("bus_route_stops", "core.core_bus_route_stops", f.t_core_bus_route_stops),
        healthPlaces("places_active", "deleted_at IS NULL", f, false),
        healthPlaces("places_deleted", "deleted_at IS NOT NULL", f, false),
        healthPlaces("places_verified", "deleted_at IS NULL AND is_verified IS TRUE", f, true),
        healthPlaces("places_unverified", "deleted_at IS NULL AND is_verified IS NOT TRUE", f, true),
        healthCount(
            "buildings_active",
            "core.core_map_buildings",
            "deleted_at IS NULL AND is_active IS TRUE",
            f.t_core_map_buildings,
            f.c_core_map_buildings_deleted_at && f.c_core_map_buildings_is_active
        ),
        healthCount(
            "buildings_deleted",
            "core.core_map_buildings",
            "deleted_at IS NOT NULL",
            f.t_core_map_buildings,
            f.c_core_map_buildings_deleted_at
        ),
        healthCount(
            "streets_active",
            "core.core_streets",
            "is_active IS TRUE",
            f.t_core_streets,
            f.c_core_streets_is_active
        ),
        healthCount(
            "streets_inactive",
            "core.core_streets",
            "is_active IS NOT TRUE",
            f.t_core_streets,
            f.c_core_streets_is_active
        ),
    ];

    return Prisma.sql`SELECT ${Prisma.join(parts, ", ")}`;
}

export class DashboardStatsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    /**
     * Two sequential SQL round-trips: catalog flags (no optional table FROM), then counts only for present tables.
     */
    async fetchStatsSnapshot(): Promise<{
        main: DashboardStatsMainCounts;
        metadata: DashboardStatsMetadataCounts;
        transit: DashboardStatsTransitCounts;
        health: DashboardStatsHealthCounts;
    }> {
        const flagRows = await this.prisma.$queryRaw<CatalogFlagRow[]>(CATALOG_FLAGS_SQL);
        const flags = flagRows[0];
        if (flags === undefined) {
            throw new Error("Dashboard stats catalog flags returned no row");
        }

        const rows = await this.prisma.$queryRaw<StatsSnapshotRow[]>(buildSnapshotQuery(flags));
        const row = rows[0];
        if (row === undefined) {
            throw new Error("Dashboard stats snapshot returned no row");
        }

        return {
            main: {
                places: n(row.places),
                map_buildings: n(row.map_buildings),
                streets: n(row.streets),
                admin_areas: n(row.admin_areas),
                addresses: n(row.addresses),
            },
            metadata: {
                place_names: n(row.place_names),
                street_names: n(row.street_names),
                admin_area_names: n(row.admin_area_names),
                place_contacts: n(row.place_contacts),
                place_sources: n(row.place_sources),
                place_media: n(row.place_media),
                place_versions: n(row.place_versions),
            },
            transit: {
                bus_routes: n(row.bus_routes),
                bus_route_variants: n(row.bus_route_variants),
                bus_stops: n(row.bus_stops),
                bus_route_stops: n(row.bus_route_stops),
            },
            health: {
                places_active: n(row.places_active),
                places_deleted: n(row.places_deleted),
                places_verified: n(row.places_verified),
                places_unverified: n(row.places_unverified),
                buildings_active: n(row.buildings_active),
                buildings_deleted: n(row.buildings_deleted),
                streets_active: n(row.streets_active),
                streets_inactive: n(row.streets_inactive),
            },
        };
    }
}
