import { Prisma, type PrismaClient } from "@prisma/client";

export type CoreReviewEntityListParams = {
    limit: number;
    offset: number;
    search?: string;
    sortBy: string;
    sortOrder: "asc" | "desc";
    isVerified?: boolean;
    adminAreaId?: bigint;
    routeId?: bigint;
    isPublic?: boolean;
    parentAdminAreaId?: bigint;
};

function sortDir(order: "asc" | "desc"): Prisma.Sql {
    return order === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
}

function verifiedClause(alias: string, isVerified?: boolean): Prisma.Sql {
    if (isVerified === undefined) {
        return Prisma.empty;
    }
    return Prisma.sql`AND ${Prisma.raw(alias)}.is_verified = ${isVerified}`;
}

function adminAreaClause(alias: string, adminAreaId?: bigint): Prisma.Sql {
    if (adminAreaId === undefined) {
        return Prisma.empty;
    }
    return Prisma.sql`AND ${Prisma.raw(alias)}.admin_area_id = ${adminAreaId}`;
}

export class CoreReviewEntitiesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    // ── Bus stops ─────────────────────────────────────────────────────────────

    async listBusStops(params: CoreReviewEntityListParams) {
        const search = params.search
            ? Prisma.sql`AND (
                COALESCE(bs.name, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(bs.name_local, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(bs.stop_code, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(aa.canonical_name, '') ILIKE ${`%${params.search}%`}
            )`
            : Prisma.empty;
        const order =
            params.sortBy === "name"
                ? Prisma.sql`LOWER(bs.name) ${sortDir(params.sortOrder)} NULLS LAST`
                : Prisma.sql`bs.updated_at ${sortDir(params.sortOrder)} NULLS LAST`;

        return this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                bs.id::text AS id,
                bs.public_id::text AS "publicId",
                bs.name,
                bs.name_local AS "nameLocal",
                bs.stop_code AS "stopCode",
                bs.admin_area_id::text AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                bs.is_active AS "isActive",
                bs.is_verified AS "isVerified",
                bs.created_at AS "createdAt",
                bs.updated_at AS "updatedAt",
                ST_AsGeoJSON(bs.geom)::json AS geometry
            FROM core.core_bus_stops AS bs
            LEFT JOIN core.core_admin_areas AS aa ON aa.id = bs.admin_area_id
            WHERE bs.is_active IS TRUE
              ${search}
              ${verifiedClause("bs", params.isVerified)}
              ${adminAreaClause("bs", params.adminAreaId)}
            ORDER BY ${order}, bs.public_id ASC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `);
    }

    async countBusStops(params: CoreReviewEntityListParams): Promise<number> {
        const search = params.search
            ? Prisma.sql`AND (
                COALESCE(bs.name, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(bs.name_local, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(bs.stop_code, '') ILIKE ${`%${params.search}%`}
            )`
            : Prisma.empty;
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM core.core_bus_stops AS bs
            WHERE bs.is_active IS TRUE
              ${search}
              ${verifiedClause("bs", params.isVerified)}
              ${adminAreaClause("bs", params.adminAreaId)}
        `);
        return Number(rows[0]?.count ?? 0n);
    }

    async getBusStopByPublicId(publicId: string) {
        const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                bs.id::text AS id,
                bs.public_id::text AS "publicId",
                bs.name,
                bs.name_local AS "nameLocal",
                bs.stop_code AS "stopCode",
                bs.admin_area_id::text AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                bs.source_type_id::text AS "sourceTypeId",
                bs.is_active AS "isActive",
                bs.is_verified AS "isVerified",
                bs.created_at AS "createdAt",
                bs.updated_at AS "updatedAt",
                ST_AsGeoJSON(bs.geom)::json AS geometry,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'id', n.id::text,
                        'name', n.name,
                        'languageCode', n.language_code,
                        'nameType', n.name_type,
                        'isPrimary', n.is_primary
                    ) ORDER BY n.is_primary DESC, n.id)
                     FROM core.core_bus_stop_names AS n
                     WHERE n.stop_id = bs.id),
                    '[]'::json
                ) AS names
            FROM core.core_bus_stops AS bs
            LEFT JOIN core.core_admin_areas AS aa ON aa.id = bs.admin_area_id
            WHERE bs.public_id = CAST(${publicId} AS uuid)
              AND bs.is_active IS TRUE
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    // ── Addresses ─────────────────────────────────────────────────────────────

    async listAddresses(params: CoreReviewEntityListParams) {
        const search = params.search
            ? Prisma.sql`AND (
                COALESCE(a.full_address, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(aa.canonical_name, '') ILIKE ${`%${params.search}%`}
            )`
            : Prisma.empty;
        const order = Prisma.sql`a.updated_at ${sortDir(params.sortOrder)} NULLS LAST`;

        return this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                a.id::text AS id,
                a.public_id::text AS "publicId",
                a.full_address AS "fullAddress",
                a.house_number AS "houseNumber",
                a.admin_area_id::text AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                a.is_public AS "isPublic",
                a.is_verified AS "isVerified",
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt",
                CASE WHEN a.point_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(a.point_geom)::json END AS geometry
            FROM core.core_addresses AS a
            LEFT JOIN core.core_admin_areas AS aa ON aa.id = a.admin_area_id
            WHERE TRUE
              ${search}
              ${verifiedClause("a", params.isVerified)}
              ${adminAreaClause("a", params.adminAreaId)}
              ${params.isPublic !== undefined ? Prisma.sql`AND a.is_public = ${params.isPublic}` : Prisma.empty}
            ORDER BY ${order}, a.public_id ASC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `);
    }

    async countAddresses(params: CoreReviewEntityListParams): Promise<number> {
        const search = params.search
            ? Prisma.sql`AND COALESCE(a.full_address, '') ILIKE ${`%${params.search}%`}`
            : Prisma.empty;
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count FROM core.core_addresses AS a
            WHERE TRUE ${search}
              ${verifiedClause("a", params.isVerified)}
              ${adminAreaClause("a", params.adminAreaId)}
        `);
        return Number(rows[0]?.count ?? 0n);
    }

    async getAddressByPublicId(publicId: string) {
        const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                a.id::text AS id,
                a.public_id::text AS "publicId",
                a.full_address AS "fullAddress",
                a.house_number AS "houseNumber",
                a.unit_number AS "unitNumber",
                a.postal_code AS "postalCode",
                a.street_id::text AS "streetId",
                a.admin_area_id::text AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                a.source_type_id::text AS "sourceTypeId",
                a.is_public AS "isPublic",
                a.is_verified AS "isVerified",
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt",
                CASE WHEN a.point_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(a.point_geom)::json END AS geometry,
                CASE WHEN a.entrance_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(a.entrance_geom)::json END AS "entranceGeometry"
            FROM core.core_addresses AS a
            LEFT JOIN core.core_admin_areas AS aa ON aa.id = a.admin_area_id
            WHERE a.public_id = CAST(${publicId} AS uuid)
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    // ── Admin areas ───────────────────────────────────────────────────────────

    async listAdminAreas(params: CoreReviewEntityListParams) {
        const search = params.search
            ? Prisma.sql`AND (
                COALESCE(a.canonical_name, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(a.slug, '') ILIKE ${`%${params.search}%`}
            )`
            : Prisma.empty;
        const parent =
            params.parentAdminAreaId !== undefined
                ? Prisma.sql`AND a.parent_id = ${params.parentAdminAreaId}`
                : params.adminAreaId !== undefined
                  ? Prisma.sql`AND a.parent_id = ${params.adminAreaId}`
                  : Prisma.empty;
        const order = Prisma.sql`a.updated_at ${sortDir(params.sortOrder)} NULLS LAST`;

        return this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                a.id::text AS id,
                a.public_id::text AS "publicId",
                a.canonical_name AS "canonicalName",
                a.slug,
                a.parent_id::text AS "parentId",
                a.admin_level_id::text AS "adminLevelId",
                a.is_active AS "isActive",
                a.is_verified AS "isVerified",
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt",
                ST_AsGeoJSON(a.geom)::json AS geometry,
                ST_AsGeoJSON(a.centroid)::json AS centroid
            FROM core.core_admin_areas AS a
            WHERE a.is_active IS TRUE
              ${search}
              ${verifiedClause("a", params.isVerified)}
              ${parent}
            ORDER BY ${order}, a.public_id ASC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `);
    }

    async countAdminAreas(params: CoreReviewEntityListParams): Promise<number> {
        const search = params.search
            ? Prisma.sql`AND COALESCE(a.canonical_name, '') ILIKE ${`%${params.search}%`}`
            : Prisma.empty;
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count FROM core.core_admin_areas AS a
            WHERE a.is_active IS TRUE ${search} ${verifiedClause("a", params.isVerified)}
        `);
        return Number(rows[0]?.count ?? 0n);
    }

    async getAdminAreaByPublicId(publicId: string) {
        const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                a.id::text AS id,
                a.public_id::text AS "publicId",
                a.canonical_name AS "canonicalName",
                a.slug,
                a.parent_id::text AS "parentId",
                a.admin_level_id::text AS "adminLevelId",
                a.source_type_id::text AS "sourceTypeId",
                a.is_active AS "isActive",
                a.is_verified AS "isVerified",
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt",
                ST_AsGeoJSON(a.geom)::json AS geometry,
                ST_AsGeoJSON(a.centroid)::json AS centroid
            FROM core.core_admin_areas AS a
            WHERE a.public_id = CAST(${publicId} AS uuid)
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    // ── Map polygons (landuse, water polygons) ──────────────────────────────────

    private async listMapPolygons(
        table: "core.core_map_landuse" | "core.core_map_water_polygons",
        alias: string,
        params: CoreReviewEntityListParams
    ) {
        const search = params.search
            ? Prisma.sql`AND (
                COALESCE(${Prisma.raw(alias)}.name, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(${Prisma.raw(alias)}.class_code, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(${Prisma.raw(alias)}.external_id, '') ILIKE ${`%${params.search}%`}
            )`
            : Prisma.empty;
        const order = Prisma.sql`${Prisma.raw(alias)}.updated_at ${sortDir(params.sortOrder)} NULLS LAST`;

        return this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                ${Prisma.raw(alias)}.id::text AS id,
                ${Prisma.raw(alias)}.external_id AS "externalId",
                ${Prisma.raw(alias)}.name,
                ${Prisma.raw(alias)}.class_code AS "classCode",
                ${Prisma.raw(alias)}.is_active AS "isActive",
                ${Prisma.raw(alias)}.is_verified AS "isVerified",
                ${Prisma.raw(alias)}.created_at AS "createdAt",
                ${Prisma.raw(alias)}.updated_at AS "updatedAt",
                ST_AsGeoJSON(${Prisma.raw(alias)}.geom)::json AS geometry
            FROM ${Prisma.raw(table)} AS ${Prisma.raw(alias)}
            WHERE ${Prisma.raw(alias)}.is_active IS TRUE
              ${search}
              ${verifiedClause(alias, params.isVerified)}
            ORDER BY ${order}, ${Prisma.raw(alias)}.id ASC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `);
    }

    private async countMapPolygons(
        table: "core.core_map_landuse" | "core.core_map_water_polygons",
        alias: string,
        params: CoreReviewEntityListParams
    ): Promise<number> {
        const search = params.search
            ? Prisma.sql`AND COALESCE(${Prisma.raw(alias)}.name, '') ILIKE ${`%${params.search}%`}`
            : Prisma.empty;
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM ${Prisma.raw(table)} AS ${Prisma.raw(alias)}
            WHERE ${Prisma.raw(alias)}.is_active IS TRUE ${search}
              ${verifiedClause(alias, params.isVerified)}
        `);
        return Number(rows[0]?.count ?? 0n);
    }

    private async getMapPolygonById(
        table: "core.core_map_landuse" | "core.core_map_water_polygons",
        alias: string,
        id: string
    ) {
        const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                ${Prisma.raw(alias)}.id::text AS id,
                ${Prisma.raw(alias)}.source_staging_id::text AS "sourceStagingId",
                ${Prisma.raw(alias)}.external_id AS "externalId",
                ${Prisma.raw(alias)}.name,
                ${Prisma.raw(alias)}.class_code AS "classCode",
                ${Prisma.raw(alias)}.normalized_data AS "normalizedData",
                ${Prisma.raw(alias)}.source_refs AS "sourceRefs",
                ${Prisma.raw(alias)}.is_active AS "isActive",
                ${Prisma.raw(alias)}.is_verified AS "isVerified",
                ${Prisma.raw(alias)}.created_at AS "createdAt",
                ${Prisma.raw(alias)}.updated_at AS "updatedAt",
                ST_AsGeoJSON(${Prisma.raw(alias)}.geom)::json AS geometry
            FROM ${Prisma.raw(table)} AS ${Prisma.raw(alias)}
            WHERE ${Prisma.raw(alias)}.id = ${BigInt(id)}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    listLanduse(params: CoreReviewEntityListParams) {
        return this.listMapPolygons("core.core_map_landuse", "lu", params);
    }
    countLanduse(params: CoreReviewEntityListParams) {
        return this.countMapPolygons("core.core_map_landuse", "lu", params);
    }
    getLanduseById(id: string) {
        return this.getMapPolygonById("core.core_map_landuse", "lu", id);
    }

    listWaterPolygons(params: CoreReviewEntityListParams) {
        return this.listMapPolygons("core.core_map_water_polygons", "wp", params);
    }
    countWaterPolygons(params: CoreReviewEntityListParams) {
        return this.countMapPolygons("core.core_map_water_polygons", "wp", params);
    }
    getWaterPolygonById(id: string) {
        return this.getMapPolygonById("core.core_map_water_polygons", "wp", id);
    }

    // ── Water lines ───────────────────────────────────────────────────────────

    async listWaterLines(params: CoreReviewEntityListParams) {
        const search = params.search
            ? Prisma.sql`AND (
                COALESCE(wl.name, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(wl.class_code, '') ILIKE ${`%${params.search}%`}
            )`
            : Prisma.empty;
        const order = Prisma.sql`wl.updated_at ${sortDir(params.sortOrder)} NULLS LAST`;

        return this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                wl.id::text AS id,
                wl.external_id AS "externalId",
                wl.name,
                wl.class_code AS "classCode",
                wl.is_active AS "isActive",
                wl.is_verified AS "isVerified",
                wl.created_at AS "createdAt",
                wl.updated_at AS "updatedAt",
                ST_AsGeoJSON(wl.geom)::json AS geometry
            FROM core.core_map_water_lines AS wl
            WHERE wl.is_active IS TRUE
              ${search}
              ${verifiedClause("wl", params.isVerified)}
            ORDER BY ${order}, wl.id ASC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `);
    }

    async countWaterLines(params: CoreReviewEntityListParams): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count FROM core.core_map_water_lines AS wl
            WHERE wl.is_active IS TRUE ${verifiedClause("wl", params.isVerified)}
        `);
        return Number(rows[0]?.count ?? 0n);
    }

    async getWaterLineById(id: string) {
        const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                wl.id::text AS id,
                wl.source_staging_id::text AS "sourceStagingId",
                wl.external_id AS "externalId",
                wl.name,
                wl.class_code AS "classCode",
                wl.normalized_data AS "normalizedData",
                wl.source_refs AS "sourceRefs",
                wl.is_active AS "isActive",
                wl.is_verified AS "isVerified",
                wl.created_at AS "createdAt",
                wl.updated_at AS "updatedAt",
                ST_AsGeoJSON(wl.geom)::json AS geometry
            FROM core.core_map_water_lines AS wl
            WHERE wl.id = ${BigInt(id)}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    // ── Bus routes ────────────────────────────────────────────────────────────

    async listBusRoutes(params: CoreReviewEntityListParams) {
        const search = params.search
            ? Prisma.sql`AND (
                COALESCE(br.public_name, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(br.route_code, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(br.operator_name, '') ILIKE ${`%${params.search}%`}
            )`
            : Prisma.empty;
        const order = Prisma.sql`br.updated_at ${sortDir(params.sortOrder)} NULLS LAST`;

        return this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                br.id::text AS id,
                br.route_code AS "routeCode",
                br.public_name AS "publicName",
                br.operator_name AS "operatorName",
                br.route_type AS "routeType",
                br.directionality,
                br.is_active AS "isActive",
                br.is_verified AS "isVerified",
                br.created_at AS "createdAt",
                br.updated_at AS "updatedAt",
                (SELECT COUNT(*)::int FROM core.core_bus_route_variants AS v
                 WHERE v.route_id = br.id AND v.is_active IS TRUE) AS "variantCount"
            FROM core.core_bus_routes AS br
            WHERE br.is_active IS TRUE
              ${search}
              ${verifiedClause("br", params.isVerified)}
            ORDER BY ${order}, br.id ASC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `);
    }

    async countBusRoutes(params: CoreReviewEntityListParams): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count FROM core.core_bus_routes AS br
            WHERE br.is_active IS TRUE ${verifiedClause("br", params.isVerified)}
        `);
        return Number(rows[0]?.count ?? 0n);
    }

    async getBusRouteById(id: string) {
        const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                br.id::text AS id,
                br.route_code AS "routeCode",
                br.public_name AS "publicName",
                br.operator_name AS "operatorName",
                br.route_type AS "routeType",
                br.directionality,
                br.is_active AS "isActive",
                br.is_verified AS "isVerified",
                br.source_type_id::text AS "sourceTypeId",
                br.created_at AS "createdAt",
                br.updated_at AS "updatedAt"
            FROM core.core_bus_routes AS br
            WHERE br.id = ${BigInt(id)}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    // ── Bus route variants ────────────────────────────────────────────────────

    async listBusRouteVariants(params: CoreReviewEntityListParams) {
        const search = params.search
            ? Prisma.sql`AND (
                COALESCE(v.variant_code, '') ILIKE ${`%${params.search}%`}
                OR COALESCE(v.direction_name, '') ILIKE ${`%${params.search}%`}
            )`
            : Prisma.empty;
        const routeFilter = params.routeId
            ? Prisma.sql`AND v.route_id = ${params.routeId}`
            : Prisma.empty;
        const order =
            params.sortBy === "route_id"
                ? Prisma.sql`v.route_id ${sortDir(params.sortOrder)}`
                : Prisma.sql`v.id ${sortDir(params.sortOrder)}`;

        return this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                v.id::text AS id,
                v.route_id::text AS "routeId",
                br.public_name AS "routePublicName",
                br.route_code AS "routeCode",
                v.variant_code AS "variantCode",
                v.direction_name AS "directionName",
                v.origin_name AS "originName",
                v.destination_name AS "destinationName",
                v.distance_m AS "distanceM",
                v.is_active AS "isActive",
                v.is_verified AS "isVerified",
                ST_AsGeoJSON(v.geom)::json AS geometry
            FROM core.core_bus_route_variants AS v
            INNER JOIN core.core_bus_routes AS br ON br.id = v.route_id
            WHERE v.is_active IS TRUE
              ${search}
              ${verifiedClause("v", params.isVerified)}
              ${routeFilter}
            ORDER BY ${order}, v.id ASC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `);
    }

    async countBusRouteVariants(params: CoreReviewEntityListParams): Promise<number> {
        const routeFilter = params.routeId
            ? Prisma.sql`AND v.route_id = ${params.routeId}`
            : Prisma.empty;
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM core.core_bus_route_variants AS v
            WHERE v.is_active IS TRUE ${verifiedClause("v", params.isVerified)} ${routeFilter}
        `);
        return Number(rows[0]?.count ?? 0n);
    }

    async getBusRouteVariantById(id: string) {
        const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                v.id::text AS id,
                v.route_id::text AS "routeId",
                br.public_name AS "routePublicName",
                v.variant_code AS "variantCode",
                v.direction_name AS "directionName",
                v.origin_name AS "originName",
                v.destination_name AS "destinationName",
                v.distance_m AS "distanceM",
                v.is_active AS "isActive",
                v.is_verified AS "isVerified",
                ST_AsGeoJSON(v.geom)::json AS geometry
            FROM core.core_bus_route_variants AS v
            INNER JOIN core.core_bus_routes AS br ON br.id = v.route_id
            WHERE v.id = ${BigInt(id)}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }
}
