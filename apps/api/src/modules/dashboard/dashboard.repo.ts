import { Prisma, type PrismaClient } from "@prisma/client";

import type {
    DashboardStatsHealthCounts,
    DashboardStatsMainCounts,
    DashboardStatsMetadataCounts,
    DashboardStatsTransitCounts,
} from "./dashboard.types.js";

type CountRow = { c: bigint };

function isMissingDbObjectError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const msg = error.message;

    if (/relation .+ does not exist/i.test(msg)) {
        return true;
    }

    if (/current transaction is aborted/i.test(msg)) {
        return false;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
        return /does not exist/i.test(msg);
    }

    if (/does not exist/i.test(msg) && (/column\b/i.test(msg) || /relation\b/i.test(msg))) {
        return true;
    }

    return false;
}

/**
 * Runs SELECT COUNT(*)::bigint against a fixed core.* relation.
 * Missing table/column yields 0 (no throw).
 */
async function countOrZero(prisma: PrismaClient, sql: Prisma.Sql): Promise<number> {
    try {
        const rows = await prisma.$queryRaw<CountRow[]>(sql);
        return Number(rows[0]?.c ?? 0);
    } catch (error) {
        if (isMissingDbObjectError(error)) {
            return 0;
        }

        throw error;
    }
}

export class DashboardStatsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async getMainCounts(): Promise<DashboardStatsMainCounts> {
        const [
            places,
            map_buildings,
            streets,
            admin_areas,
            addresses,
        ] = await Promise.all([
            countOrZero(this.prisma, Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_places`),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_map_buildings`
            ),
            countOrZero(this.prisma, Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_streets`),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_admin_areas`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_addresses`
            ),
        ]);

        return { places, map_buildings, streets, admin_areas, addresses };
    }

    async getMetadataCounts(): Promise<DashboardStatsMetadataCounts> {
        const [
            place_names,
            street_names,
            admin_area_names,
            place_contacts,
            place_sources,
            place_media,
            place_versions,
        ] = await Promise.all([
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_place_names`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_street_names`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_admin_area_names`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_place_contacts`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_place_sources`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_place_media`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_place_versions`
            ),
        ]);

        return {
            place_names,
            street_names,
            admin_area_names,
            place_contacts,
            place_sources,
            place_media,
            place_versions,
        };
    }

    async getTransitCounts(): Promise<DashboardStatsTransitCounts> {
        const [bus_routes, bus_route_variants, bus_stops, bus_route_stops] = await Promise.all([
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_bus_routes`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_bus_route_variants`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_bus_stops`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_bus_route_stops`
            ),
        ]);

        return { bus_routes, bus_route_variants, bus_stops, bus_route_stops };
    }

    async getHealthCounts(): Promise<DashboardStatsHealthCounts> {
        const [
            places_active,
            places_deleted,
            places_verified,
            places_unverified,
            buildings_active,
            buildings_deleted,
            streets_active,
            streets_inactive,
        ] = await Promise.all([
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_places WHERE deleted_at IS NULL`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_places WHERE deleted_at IS NOT NULL`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_places WHERE deleted_at IS NULL AND is_verified IS TRUE`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_places WHERE deleted_at IS NULL AND is_verified IS NOT TRUE`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_map_buildings WHERE deleted_at IS NULL AND is_active IS TRUE`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_map_buildings WHERE deleted_at IS NOT NULL`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_streets WHERE is_active IS TRUE`
            ),
            countOrZero(
                this.prisma,
                Prisma.sql`SELECT COUNT(*)::bigint AS c FROM core.core_streets WHERE is_active IS NOT TRUE`
            ),
        ]);

        return {
            places_active,
            places_deleted,
            places_verified,
            places_unverified,
            buildings_active,
            buildings_deleted,
            streets_active,
            streets_inactive,
        };
    }
}
