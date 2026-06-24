import { Prisma, type PrismaClient } from "@prisma/client";

import {
    coreReviewListStatusClause,
    type CoreReviewListStatus,
} from "./core-review-list-status.js";
import { getCoreReviewLifecycleConfig } from "./core-review-lifecycle.config.js";
import type { CoreReviewEntitySlug } from "./core-review.types.js";
import {
    coreReviewVerificationFilterClause,
    type CoreReviewVerificationFilterParams,
} from "./core-review-verification-filter.js";

import type { CoreReviewVerificationStatus } from "./core-review-verification-filter.js";

export type CoreReviewEntityListParams = {
    limit: number;
    offset: number;
    search?: string;
    sortBy: string;
    sortOrder: "asc" | "desc";
    verificationStatus?: CoreReviewVerificationStatus;
    adminAreaId?: bigint;
    routeId?: bigint;
    isPublic?: boolean;
    parentAdminAreaId?: bigint;
    boundaryStatus?: string;
    addressUsage?: string;
    isOfficialBoundary?: boolean;
    status?: CoreReviewListStatus;
};

function genericListStatusClause(slug: CoreReviewEntitySlug, alias: string, status?: CoreReviewListStatus) {
    const config = getCoreReviewLifecycleConfig(slug);
    return coreReviewListStatusClause(alias, status ?? "active", config);
}

function sortDir(order: "asc" | "desc"): Prisma.Sql {
    return order === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
}

function verificationFilterClause(alias: string, params: CoreReviewVerificationFilterParams): Prisma.Sql {
    return coreReviewVerificationFilterClause(alias, params);
}

function adminAreaClause(alias: string, adminAreaId?: bigint): Prisma.Sql {
    if (adminAreaId === undefined) {
        return Prisma.empty;
    }
    return Prisma.sql`AND ${Prisma.raw(alias)}.admin_area_id = ${adminAreaId}`;
}

const ADMIN_AREA_BOUNDARY_COLUMNS = Prisma.sql`
    a.boundary_status AS "boundaryStatus",
    bs.name_en AS "boundaryStatusLabelEn",
    bs.name_mm AS "boundaryStatusLabelMm",
    bs.helper_en AS "boundaryStatusHelperEn",
    a.address_usage AS "addressUsage",
    au.name_en AS "addressUsageLabelEn",
    au.name_mm AS "addressUsageLabelMm",
    au.helper_en AS "addressUsageHelperEn",
    a.is_official_boundary AS "isOfficialBoundary",
    a.boundary_confidence_score::float8 AS "boundaryConfidenceScore",
    a.boundary_note AS "boundaryNote"
`;

const ADMIN_AREA_BOUNDARY_JOINS = Prisma.sql`
    LEFT JOIN ref.ref_boundary_statuses AS bs ON bs.code = a.boundary_status
    LEFT JOIN ref.ref_address_usage_types AS au ON au.code = a.address_usage
`;

const ADMIN_AREA_NAME_COLUMNS = Prisma.sql`
    an_mm.name AS "nameMm",
    an_en.name AS "nameEn"
`;

const ADMIN_AREA_NAME_JOINS = Prisma.sql`
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_admin_area_names AS n
        WHERE n.admin_area_id = a.id
          AND (
              lower(trim(coalesce(n.language_code, ''))) = 'my'
              OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
          )
        ORDER BY
            CASE
                WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                WHEN n.is_primary = true THEN 2
                WHEN n.name_type = 'official' THEN 3
                ELSE 4
            END,
            n.search_weight DESC NULLS LAST,
            n.name ASC
        LIMIT 1
    ) AS an_mm ON true
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_admin_area_names AS n
        WHERE n.admin_area_id = a.id
          AND (
              lower(trim(coalesce(n.language_code, ''))) = 'en'
              OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
          )
        ORDER BY
            CASE
                WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                WHEN n.is_primary = true THEN 2
                WHEN n.name_type = 'official' THEN 3
                ELSE 4
            END,
            n.search_weight DESC NULLS LAST,
            n.name ASC
        LIMIT 1
    ) AS an_en ON true
`;

function adminAreaBoundaryListFilters(params: CoreReviewEntityListParams): Prisma.Sql {
    const parts: Prisma.Sql[] = [];
    if (params.boundaryStatus !== undefined) {
        parts.push(Prisma.sql`AND a.boundary_status = ${params.boundaryStatus}`);
    }
    if (params.addressUsage !== undefined) {
        parts.push(Prisma.sql`AND a.address_usage = ${params.addressUsage}`);
    }
    if (params.isOfficialBoundary !== undefined) {
        parts.push(Prisma.sql`AND a.is_official_boundary = ${params.isOfficialBoundary}`);
    }
    return parts.length > 0 ? Prisma.join(parts, " ") : Prisma.empty;
}

export class CoreReviewEntitiesRepository {
    constructor(private readonly prisma: PrismaClient) {}

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
                a.verification_status AS "verificationStatus",
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt",
                CASE WHEN a.point_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(a.point_geom)::json END AS geometry
            FROM core.core_addresses AS a
            LEFT JOIN core.core_admin_areas AS aa ON aa.id = a.admin_area_id
            WHERE ${genericListStatusClause("addresses", "a", params.status)}
              ${search}
              ${verificationFilterClause("a", params)}
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
            WHERE ${genericListStatusClause("addresses", "a", params.status)} ${search}
              ${verificationFilterClause("a", params)}
              ${adminAreaClause("a", params.adminAreaId)}
        `);
        return Number(rows[0]?.count ?? 0n);
    }

    async getAddressByPublicId(publicId: string, options: { anyStatus?: boolean } = {}) {
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
                a.verification_status AS "verificationStatus",
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt",
                CASE WHEN a.point_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(a.point_geom)::json END AS geometry,
                CASE WHEN a.entrance_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(a.entrance_geom)::json END AS "entranceGeometry"
            FROM core.core_addresses AS a
            LEFT JOIN core.core_admin_areas AS aa ON aa.id = a.admin_area_id
            WHERE a.public_id = CAST(${publicId} AS uuid)
              AND ${
                  options.anyStatus
                      ? Prisma.sql`TRUE`
                      : genericListStatusClause("addresses", "a", "active")
              }
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
                a.verification_status AS "verificationStatus",
                ${ADMIN_AREA_BOUNDARY_COLUMNS},
                ${ADMIN_AREA_NAME_COLUMNS},
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt",
                ST_AsGeoJSON(a.geom)::json AS geometry,
                ST_AsGeoJSON(a.centroid)::json AS centroid
            FROM core.core_admin_areas AS a
            ${ADMIN_AREA_BOUNDARY_JOINS}
            ${ADMIN_AREA_NAME_JOINS}
            WHERE ${genericListStatusClause("admin-areas", "a", params.status)}
              ${search}
              ${verificationFilterClause("a", params)}
              ${parent}
              ${adminAreaBoundaryListFilters(params)}
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
            WHERE ${genericListStatusClause("admin-areas", "a", params.status)} ${search}
              ${verificationFilterClause("a", params)}
              ${adminAreaBoundaryListFilters(params)}
        `);
        return Number(rows[0]?.count ?? 0n);
    }

    async getAdminAreaByPublicId(publicId: string, options: { anyStatus?: boolean } = {}) {
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
                a.verification_status AS "verificationStatus",
                ${ADMIN_AREA_BOUNDARY_COLUMNS},
                ${ADMIN_AREA_NAME_COLUMNS},
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt",
                ST_AsGeoJSON(a.geom)::json AS geometry,
                ST_AsGeoJSON(a.centroid)::json AS centroid
            FROM core.core_admin_areas AS a
            ${ADMIN_AREA_BOUNDARY_JOINS}
            ${ADMIN_AREA_NAME_JOINS}
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
                ${Prisma.raw(alias)}.verification_status AS "verificationStatus",
                ${Prisma.raw(alias)}.created_at AS "createdAt",
                ${Prisma.raw(alias)}.updated_at AS "updatedAt",
                ST_AsGeoJSON(${Prisma.raw(alias)}.geom)::json AS geometry
            FROM ${Prisma.raw(table)} AS ${Prisma.raw(alias)}
            WHERE ${genericListStatusClause(
                  table === "core.core_map_landuse" ? "landuse" : "water-polygons",
                  alias,
                  params.status
              )}
              ${search}
              ${verificationFilterClause(alias, params)}
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
            WHERE ${genericListStatusClause(
                  table === "core.core_map_landuse" ? "landuse" : "water-polygons",
                  alias,
                  params.status
              )} ${search}
              ${verificationFilterClause(alias, params)}
        `);
        return Number(rows[0]?.count ?? 0n);
    }

    private async getMapPolygonById(
        table: "core.core_map_landuse" | "core.core_map_water_polygons",
        alias: string,
        id: string,
        options: { anyStatus?: boolean } = {}
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
                ${Prisma.raw(alias)}.verification_status AS "verificationStatus",
                ${Prisma.raw(alias)}.created_at AS "createdAt",
                ${Prisma.raw(alias)}.updated_at AS "updatedAt",
                ST_AsGeoJSON(${Prisma.raw(alias)}.geom)::json AS geometry
            FROM ${Prisma.raw(table)} AS ${Prisma.raw(alias)}
            WHERE ${Prisma.raw(alias)}.id = ${BigInt(id)}
              AND ${
                  options.anyStatus
                      ? Prisma.sql`TRUE`
                      : genericListStatusClause(
                            table === "core.core_map_landuse" ? "landuse" : "water-polygons",
                            alias,
                            "active"
                        )
              }
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
    getLanduseById(id: string, options: { anyStatus?: boolean } = {}) {
        return this.getMapPolygonById("core.core_map_landuse", "lu", id, options);
    }

    listWaterPolygons(params: CoreReviewEntityListParams) {
        return this.listMapPolygons("core.core_map_water_polygons", "wp", params);
    }
    countWaterPolygons(params: CoreReviewEntityListParams) {
        return this.countMapPolygons("core.core_map_water_polygons", "wp", params);
    }
    getWaterPolygonById(id: string, options: { anyStatus?: boolean } = {}) {
        return this.getMapPolygonById("core.core_map_water_polygons", "wp", id, options);
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
                wl.verification_status AS "verificationStatus",
                wl.created_at AS "createdAt",
                wl.updated_at AS "updatedAt",
                ST_AsGeoJSON(wl.geom)::json AS geometry
            FROM core.core_map_water_lines AS wl
            WHERE ${genericListStatusClause("water-lines", "wl", params.status)}
              ${search}
              ${verificationFilterClause("wl", params)}
            ORDER BY ${order}, wl.id ASC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `);
    }

    async countWaterLines(params: CoreReviewEntityListParams): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count FROM core.core_map_water_lines AS wl
            WHERE ${genericListStatusClause("water-lines", "wl", params.status)}
              ${verificationFilterClause("wl", params)}
        `);
        return Number(rows[0]?.count ?? 0n);
    }

    async getWaterLineById(id: string, options: { anyStatus?: boolean } = {}) {
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
                wl.verification_status AS "verificationStatus",
                wl.created_at AS "createdAt",
                wl.updated_at AS "updatedAt",
                ST_AsGeoJSON(wl.geom)::json AS geometry
            FROM core.core_map_water_lines AS wl
            WHERE wl.id = ${BigInt(id)}
              AND ${
                  options.anyStatus
                      ? Prisma.sql`TRUE`
                      : genericListStatusClause("water-lines", "wl", "active")
              }
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

}
