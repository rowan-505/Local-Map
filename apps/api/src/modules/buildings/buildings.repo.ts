import { Prisma, type PrismaClient } from "@prisma/client";

import {
    buildingClassCodeCoalesceSql,
    buildingClassCodeSelectSql,
    buildingNameLabelSelectSql,
} from "../../lib/entity-names/building-detail-select-sql.js";
import { syncBuildingPrimaryNames, type PrimaryNameSlots } from "../../lib/entity-names/sync-primary-names.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

const AREA_MIN_EXCLUSIVE = 3;
const AREA_MAX_EXCLUSIVE = 200_000;

/** Matches dashboard-created buildings (`source_refs @> {"source":"dashboard"}`). */
const dashboardBuildingClause = Prisma.sql`b.source_refs @> '{"source":"dashboard"}'::jsonb`;

export type BuildingGeometryAnalysisRow = {
    allowed_type: boolean;
    is_valid: boolean;
    invalid_reason: string | null;
    area_m2: number | null;
};

export type BuildingDetailRow = {
    id: string;
    public_id: string;
    source_staging_id: string | null;
    external_id: string | null;
    name_mm: string | null;
    name_en: string | null;
    fallback_name: string | null;
    class_code: string;
    building_type_id: string | null;
    ref_bt_id: string | null;
    ref_bt_code: string | null;
    ref_bt_name: string | null;
    ref_bt_name_mm: string | null;
    ref_bt_parent_id: string | null;
    /** Duplicate of ref_bt_* for explicit API/tile-oriented naming. */
    building_type_code: string | null;
    building_type_name: string | null;
    building_type_name_mm: string | null;
    admin_area_id: string | null;
    /** Populated when FK joins to core_admin_areas. */
    admin_area_row_id: string | null;
    admin_area_canonical_name: string | null;
    admin_area_slug: string | null;
    normalized_data: unknown;
    source_refs: unknown;
    levels: number | null;
    height_m: number | null;
    area_m2: number | null;
    confidence_score: number | null;
    is_verified: boolean;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
    geometry: unknown;
};

/** Resolved column snapshot after dashboard merge (always explicit — supports clearing nullable fields). */
export type BuildingPersistSnapshot = {
    /** Legacy `core_map_buildings.name` (imported / fallback label). */
    name: string | null;
    /** When set, upserts primary official rows in core_map_building_names. */
    name_mm?: string | null | undefined;
    name_en?: string | null | undefined;
    class_code: string;
    building_type_column: string;
    /** When set, must reference an active row in ref.ref_building_types. */
    building_type_id: bigint | null;
    /** When true, INSERT/geometry UPDATE clears FK before best-effort spatial inference (failure never raises). */
    admin_area_resolve_spatial: boolean;
    admin_area_id: bigint | null;
    normalized_data: Record<string, unknown>;
    levels: number | null;
    height_m: number | null;
    confidence_score: number;
    is_verified: boolean;
};

export type RefBuildingTypeRow = {
    id: string;
    code: string;
    name: string;
    name_mm: string | null;
    parent_id: string | null;
    sort_order: number;
};

function buildingsListOrderBy(
    sortBy: "name" | "building_type" | "admin_area" | "created" | "updated" | "updated_at",
    sortOrder: "asc" | "desc"
): Prisma.Sql {
    const dir = sortOrder === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;

    switch (sortBy) {
        case "name":
            return Prisma.sql`LOWER(COALESCE(
                (
                    SELECT n.name
                    FROM core.core_map_building_names AS n
                    WHERE n.building_id = b.id
                      AND n.is_primary IS TRUE
                      AND n.name_type = 'official'
                      AND (
                          lower(trim(n.language_code)) IN ('my', 'mm')
                          OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
                      )
                    ORDER BY n.search_weight DESC, n.id ASC
                    LIMIT 1
                ),
                (
                    SELECT n.name
                    FROM core.core_map_building_names AS n
                    WHERE n.building_id = b.id
                      AND n.is_primary IS TRUE
                      AND n.name_type = 'official'
                      AND lower(trim(n.language_code)) = 'en'
                    ORDER BY n.search_weight DESC, n.id ASC
                    LIMIT 1
                ),
                b.name,
                ''
            )) ${dir} NULLS LAST, b.public_id ASC`;
        case "building_type":
            return Prisma.sql`LOWER(COALESCE(bt.name, bt.code, ${buildingClassCodeCoalesceSql}, '')) ${dir} NULLS LAST, b.public_id ASC`;
        case "admin_area":
            return Prisma.sql`LOWER(COALESCE(aa.canonical_name, '')) ${dir} NULLS LAST, b.public_id ASC`;
        case "created":
            return Prisma.sql`b.created_at ${dir} NULLS LAST, b.public_id ASC`;
        case "updated":
        case "updated_at":
            return Prisma.sql`b.updated_at ${dir} NULLS LAST, b.public_id ASC`;
        default:
            return Prisma.sql`b.updated_at DESC NULLS LAST, b.public_id ASC`;
    }
}

export type ActiveBuildingsListParams = {
    limit: number;
    offset: number;
    q?: string;
    sortBy: "name" | "building_type" | "admin_area" | "created" | "updated" | "updated_at";
    sortOrder: "asc" | "desc";
    is_verified?: boolean;
    admin_area_id?: bigint;
    building_type_id?: bigint;
};

function activeBuildingsWhereClause(
    params: Pick<ActiveBuildingsListParams, "q" | "is_verified" | "admin_area_id" | "building_type_id">
): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`b.deleted_at IS NULL`, Prisma.sql`b.is_active IS TRUE`];

    if (params.q !== undefined) {
        parts.push(Prisma.sql`(
                    COALESCE(b.name, '') ILIKE ${`%${params.q}%`}
                    OR COALESCE(bt.name, '') ILIKE ${`%${params.q}%`}
                    OR COALESCE(bt.code, '') ILIKE ${`%${params.q}%`}
                    OR COALESCE(${buildingClassCodeCoalesceSql}, '') ILIKE ${`%${params.q}%`}
                    OR COALESCE(aa.canonical_name, '') ILIKE ${`%${params.q}%`}
                    OR COALESCE(b.area_m2::text, '') ILIKE ${`%${params.q}%`}
                    OR COALESCE(b.levels::text, '') ILIKE ${`%${params.q}%`}
                    OR COALESCE(b.confidence_score::text, '') ILIKE ${`%${params.q}%`}
                    OR (CASE WHEN b.is_verified THEN 'Yes' ELSE 'No' END) ILIKE ${`%${params.q}%`}
                    OR b.created_at::text ILIKE ${`%${params.q}%`}
                    OR b.updated_at::text ILIKE ${`%${params.q}%`}
                )`);
    }

    if (params.is_verified !== undefined) {
        parts.push(Prisma.sql`b.is_verified = ${params.is_verified}`);
    }

    if (params.admin_area_id !== undefined) {
        parts.push(Prisma.sql`b.admin_area_id = ${params.admin_area_id}`);
    }

    if (params.building_type_id !== undefined) {
        parts.push(Prisma.sql`b.building_type_id = ${params.building_type_id}`);
    }

    return Prisma.join(parts, " AND ");
}

export class BuildingsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    private async syncDashboardBuildingNamesIfNeeded(
        publicId: string,
        snapshot: BuildingPersistSnapshot,
        db: DbClient = this.prisma
    ): Promise<void> {
        if (snapshot.name_mm === undefined && snapshot.name_en === undefined) {
            return;
        }

        const idRows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT b.id::text AS id
            FROM core.core_map_buildings AS b
            WHERE b.public_id = CAST(${publicId} AS uuid)
            LIMIT 1
        `);

        const internalId = idRows[0]?.id;

        if (!internalId) {
            return;
        }

        const slots: PrimaryNameSlots = {};

        if (snapshot.name_mm !== undefined) {
            slots.name_mm = snapshot.name_mm;
        }

        if (snapshot.name_en !== undefined) {
            slots.name_en = snapshot.name_en;
        }

        await syncBuildingPrimaryNames(db, BigInt(internalId), slots);
    }

    private async refetchDashboardBuildingAfterWrite(
        publicId: string,
        snapshot: BuildingPersistSnapshot,
        db: DbClient = this.prisma
    ): Promise<BuildingDetailRow | null> {
        await this.syncDashboardBuildingNamesIfNeeded(publicId, snapshot, db);
        return this.getDashboardBuildingByPublicId(publicId, db);
    }

    async analyzeBuildingGeometry(
        geojsonText: string,
        db: DbClient = this.prisma
    ): Promise<BuildingGeometryAnalysisRow | null> {
        const rows = await db.$queryRaw<BuildingGeometryAnalysisRow[]>(Prisma.sql`
            WITH inp AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g_raw
            ),
            prep AS (
                SELECT CASE
                    WHEN ST_GeometryType(g_raw) = 'ST_Polygon'
                        THEN ST_Multi(g_raw)::geometry(MultiPolygon, 4326)
                    WHEN ST_GeometryType(g_raw) = 'ST_MultiPolygon'
                        THEN g_raw::geometry(MultiPolygon, 4326)
                    ELSE NULL::geometry(MultiPolygon, 4326)
                END AS geom
                FROM inp
            )
            SELECT
                geom IS NOT NULL AS allowed_type,
                CASE WHEN geom IS NOT NULL THEN ST_IsValid(geom) ELSE FALSE END AS is_valid,
                CASE
                    WHEN geom IS NOT NULL AND NOT ST_IsValid(geom)
                        THEN ST_IsValidReason(geom)
                    ELSE NULL
                END AS invalid_reason,
                CASE
                    WHEN geom IS NOT NULL AND ST_IsValid(geom)
                        THEN ST_Area(geom::geography)::double precision
                    ELSE NULL
                END AS area_m2
            FROM prep
        `);

        return rows[0] ?? null;
    }

    async hasActiveAdminArea(adminAreaId: bigint): Promise<boolean> {
        const adminArea = await this.prisma.coreAdminArea.findFirst({
            where: {
                id: adminAreaId,
                isActive: true,
            },
            select: {
                id: true,
            },
        });

        return Boolean(adminArea);
    }

    /**
     * Best-effort: set admin_area_id from active admin polygons containing ST_PointOnSurface(geom).
     * Tie-break smallest geography area. Exceptions are swallowed.
     */
    async tryInferDashboardBuildingAdminAreaFromGeometry(
        internalBuildingId: bigint,
        db: DbClient = this.prisma
    ): Promise<void> {
        try {
            await db.$executeRaw(Prisma.sql`
                UPDATE core.core_map_buildings AS b
                SET
                    admin_area_id = (
                        SELECT a.id
                        FROM core.core_admin_areas AS a
                        WHERE a.is_active IS TRUE
                          AND a.geom IS NOT NULL
                          AND ST_IsValid(a.geom)
                          AND ST_Contains(a.geom::geometry, ST_PointOnSurface(b.geom))
                        ORDER BY ST_Area(a.geom::geography) ASC NULLS LAST
                        LIMIT 1
                    ),
                    updated_at = NOW()
                WHERE b.id = ${internalBuildingId}
                  AND ${dashboardBuildingClause}
                  AND b.deleted_at IS NULL
                  AND b.is_active IS TRUE
                  AND b.geom IS NOT NULL
                  AND ST_IsValid(b.geom)
            `);
        } catch {
            /* Inference must not fail building workflows. */
        }
    }

    /** Active, non-deleted buildings (imports + dashboard), no source filter. */
    async listActiveBuildings(params: ActiveBuildingsListParams): Promise<BuildingDetailRow[]> {
        const whereClause = activeBuildingsWhereClause(params);
        const orderByClause = buildingsListOrderBy(params.sortBy, params.sortOrder);

        return this.prisma.$queryRaw<BuildingDetailRow[]>(Prisma.sql`
            SELECT
                b.id::text AS id,
                b.public_id::text AS public_id,
                b.source_staging_id::text AS source_staging_id,
                b.external_id,
                ${buildingNameLabelSelectSql},
                ${buildingClassCodeSelectSql},
                b.building_type_id::text AS building_type_id,
                bt.id::text AS ref_bt_id,
                bt.code AS ref_bt_code,
                bt.name AS ref_bt_name,
                bt.name_mm AS ref_bt_name_mm,
                bt.parent_id::text AS ref_bt_parent_id,
                bt.code AS building_type_code,
                bt.name AS building_type_name,
                bt.name_mm AS building_type_name_mm,
                b.admin_area_id::text AS admin_area_id,
                aa.id::text AS admin_area_row_id,
                aa.canonical_name AS admin_area_canonical_name,
                aa.slug AS admin_area_slug,
                b.normalized_data,
                b.source_refs,
                b.levels,
                b.height_m::double precision AS height_m,
                b.area_m2::double precision AS area_m2,
                b.confidence_score::double precision AS confidence_score,
                b.is_verified,
                b.is_active,
                b.created_at,
                b.updated_at,
                b.deleted_at,
                ST_AsGeoJSON(b.geom)::json AS geometry
            FROM core.core_map_buildings AS b
            LEFT JOIN ref.ref_building_types AS bt ON bt.id = b.building_type_id
            LEFT JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
            WHERE ${whereClause}
            ORDER BY ${orderByClause}
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `);
    }

    async countActiveBuildings(
        params: Pick<ActiveBuildingsListParams, "q" | "is_verified" | "admin_area_id" | "building_type_id">
    ): Promise<number> {
        const whereClause = activeBuildingsWhereClause(params);
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM core.core_map_buildings AS b
            LEFT JOIN ref.ref_building_types AS bt ON bt.id = b.building_type_id
            LEFT JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
            WHERE ${whereClause}
        `);
        return Number(rows[0]?.count ?? 0n);
    }

    /** GET /buildings/:id — any active row (imports + dashboard). */
    async getActiveBuildingByPublicId(
        publicId: string,
        db: DbClient = this.prisma
    ): Promise<BuildingDetailRow | null> {
        const rows = await db.$queryRaw<BuildingDetailRow[]>(Prisma.sql`
            SELECT
                b.id::text AS id,
                b.public_id::text AS public_id,
                b.source_staging_id::text AS source_staging_id,
                b.external_id,
                ${buildingNameLabelSelectSql},
                ${buildingClassCodeSelectSql},
                b.building_type_id::text AS building_type_id,
                bt.id::text AS ref_bt_id,
                bt.code AS ref_bt_code,
                bt.name AS ref_bt_name,
                bt.name_mm AS ref_bt_name_mm,
                bt.parent_id::text AS ref_bt_parent_id,
                bt.code AS building_type_code,
                bt.name AS building_type_name,
                bt.name_mm AS building_type_name_mm,
                b.admin_area_id::text AS admin_area_id,
                aa.id::text AS admin_area_row_id,
                aa.canonical_name AS admin_area_canonical_name,
                aa.slug AS admin_area_slug,
                b.normalized_data,
                b.source_refs,
                b.levels,
                b.height_m::double precision AS height_m,
                b.area_m2::double precision AS area_m2,
                b.confidence_score::double precision AS confidence_score,
                b.is_verified,
                b.is_active,
                b.created_at,
                b.updated_at,
                b.deleted_at,
                ST_AsGeoJSON(b.geom)::json AS geometry
            FROM core.core_map_buildings AS b
            LEFT JOIN ref.ref_building_types AS bt ON bt.id = b.building_type_id
            LEFT JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
            WHERE b.public_id = CAST(${publicId} AS uuid)
              AND b.deleted_at IS NULL
              AND b.is_active IS TRUE
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    async getDashboardBuildingByPublicId(
        publicId: string,
        db: DbClient = this.prisma
    ): Promise<BuildingDetailRow | null> {
        const rows = await db.$queryRaw<BuildingDetailRow[]>(Prisma.sql`
            SELECT
                b.id::text AS id,
                b.public_id::text AS public_id,
                b.source_staging_id::text AS source_staging_id,
                b.external_id,
                ${buildingNameLabelSelectSql},
                ${buildingClassCodeSelectSql},
                b.building_type_id::text AS building_type_id,
                bt.id::text AS ref_bt_id,
                bt.code AS ref_bt_code,
                bt.name AS ref_bt_name,
                bt.name_mm AS ref_bt_name_mm,
                bt.parent_id::text AS ref_bt_parent_id,
                bt.code AS building_type_code,
                bt.name AS building_type_name,
                bt.name_mm AS building_type_name_mm,
                b.admin_area_id::text AS admin_area_id,
                aa.id::text AS admin_area_row_id,
                aa.canonical_name AS admin_area_canonical_name,
                aa.slug AS admin_area_slug,
                b.normalized_data,
                b.source_refs,
                b.levels,
                b.height_m::double precision AS height_m,
                b.area_m2::double precision AS area_m2,
                b.confidence_score::double precision AS confidence_score,
                b.is_verified,
                b.is_active,
                b.created_at,
                b.updated_at,
                b.deleted_at,
                ST_AsGeoJSON(b.geom)::json AS geometry
            FROM core.core_map_buildings AS b
            LEFT JOIN ref.ref_building_types AS bt ON bt.id = b.building_type_id
            LEFT JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
            WHERE b.public_id = CAST(${publicId} AS uuid)
              AND ${dashboardBuildingClause}
              AND b.deleted_at IS NULL
              AND b.is_active IS TRUE
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    async createDashboardBuilding(
        geojsonText: string,
        snapshot: BuildingPersistSnapshot
    ): Promise<BuildingDetailRow | null> {
        return this.prisma.$transaction(async (tx) => {
            const normalizedJson = JSON.stringify(snapshot.normalized_data);

            const persistedAdminFk = snapshot.admin_area_resolve_spatial
                ? Prisma.sql`NULL::bigint`
                : Prisma.sql`${snapshot.admin_area_id}`;

            const rows = await tx.$queryRaw<{ public_id: string; id: string }[]>(Prisma.sql`
            WITH inp AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g_raw
            ),
            prep AS (
                SELECT CASE
                    WHEN ST_GeometryType(g_raw) = 'ST_Polygon'
                        THEN ST_Multi(g_raw)::geometry(MultiPolygon, 4326)
                    WHEN ST_GeometryType(g_raw) = 'ST_MultiPolygon'
                        THEN g_raw::geometry(MultiPolygon, 4326)
                    ELSE NULL::geometry(MultiPolygon, 4326)
                END AS geom
                FROM inp
            ),
            ready AS (
                SELECT
                    geom,
                    ST_PointOnSurface(geom)::geometry(Point, 4326) AS centroid,
                    ST_Area(geom::geography)::double precision AS area_m2
                FROM prep
                WHERE geom IS NOT NULL
                  AND ST_IsValid(geom)
                  AND ST_Area(geom::geography) > ${AREA_MIN_EXCLUSIVE}
                  AND ST_Area(geom::geography) < ${AREA_MAX_EXCLUSIVE}
            ),
            lbl AS (
                SELECT COALESCE(
                    (
                        SELECT bt.code
                        FROM ref.ref_building_types AS bt
                        WHERE bt.id = ${snapshot.building_type_id}
                          AND bt.is_active IS TRUE
                        LIMIT 1
                    ),
                    NULLIF(btrim(${snapshot.building_type_column}::text), ''),
                    NULLIF(btrim(${snapshot.class_code}::text), ''),
                    'yes'
                )::text AS resolved_label
                FROM ready
            )
            INSERT INTO core.core_map_buildings (
                source_staging_id,
                external_id,
                name,
                normalized_data,
                source_refs,
                geom,
                building_type_id,
                admin_area_id,
                levels,
                height_m,
                centroid,
                area_m2,
                confidence_score,
                is_verified,
                is_active,
                created_at,
                updated_at,
                deleted_at
            )
            SELECT
                NULL,
                NULL,
                ${snapshot.name},
                ${normalizedJson}::jsonb,
                '{"source":"dashboard"}'::jsonb,
                ready.geom,
                ${snapshot.building_type_id},
                ${persistedAdminFk},
                ${snapshot.levels},
                ${snapshot.height_m},
                ready.centroid,
                ready.area_m2,
                ${snapshot.confidence_score},
                ${snapshot.is_verified},
                TRUE,
                NOW(),
                NOW(),
                NULL::timestamptz
            FROM ready, lbl
            RETURNING
                id::text AS id,
                public_id::text AS public_id
        `);

            const inserted = rows[0] ?? null;

            if (!inserted) {
                return null;
            }

            if (snapshot.admin_area_resolve_spatial) {
                await this.tryInferDashboardBuildingAdminAreaFromGeometry(BigInt(inserted.id), tx);
            }

            return this.refetchDashboardBuildingAfterWrite(inserted.public_id, snapshot, tx);
        });
    }

    async updateDashboardBuildingGeometry(
        publicId: string,
        geojsonText: string,
        snapshot: BuildingPersistSnapshot
    ): Promise<BuildingDetailRow | null> {
        const normalizedJson = JSON.stringify(snapshot.normalized_data);

        const persistedAdminFk = snapshot.admin_area_resolve_spatial
            ? Prisma.sql`NULL::bigint`
            : Prisma.sql`${snapshot.admin_area_id}`;

        const rows = await this.prisma.$queryRaw<{ id: string; public_id: string }[]>(Prisma.sql`
            WITH inp AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g_raw
            ),
            prep AS (
                SELECT CASE
                    WHEN ST_GeometryType(g_raw) = 'ST_Polygon'
                        THEN ST_Multi(g_raw)::geometry(MultiPolygon, 4326)
                    WHEN ST_GeometryType(g_raw) = 'ST_MultiPolygon'
                        THEN g_raw::geometry(MultiPolygon, 4326)
                    ELSE NULL::geometry(MultiPolygon, 4326)
                END AS geom
                FROM inp
            ),
            ready AS (
                SELECT
                    geom,
                    ST_PointOnSurface(geom)::geometry(Point, 4326) AS centroid,
                    ST_Area(geom::geography)::double precision AS area_m2
                FROM prep
                WHERE geom IS NOT NULL
                  AND ST_IsValid(geom)
                  AND ST_Area(geom::geography) > ${AREA_MIN_EXCLUSIVE}
                  AND ST_Area(geom::geography) < ${AREA_MAX_EXCLUSIVE}
            ),
            lbl AS (
                SELECT COALESCE(
                    (
                        SELECT bt.code
                        FROM ref.ref_building_types AS bt
                        WHERE bt.id = ${snapshot.building_type_id}
                          AND bt.is_active IS TRUE
                        LIMIT 1
                    ),
                    NULLIF(btrim(${snapshot.building_type_column}::text), ''),
                    NULLIF(btrim(${snapshot.class_code}::text), ''),
                    'yes'
                )::text AS resolved_label
                FROM ready
            ),
            updated AS (
                UPDATE core.core_map_buildings AS b
                SET
                    geom = ready.geom,
                    centroid = ready.centroid,
                    area_m2 = ready.area_m2,
                    name = ${snapshot.name},
                    building_type_id = ${snapshot.building_type_id},
                    admin_area_id = ${persistedAdminFk},
                    normalized_data = ${normalizedJson}::jsonb,
                    levels = ${snapshot.levels},
                    height_m = ${snapshot.height_m},
                    confidence_score = ${snapshot.confidence_score},
                    is_verified = ${snapshot.is_verified},
                    updated_at = NOW()
                FROM ready, lbl
                WHERE b.public_id = CAST(${publicId} AS uuid)
                  AND ${dashboardBuildingClause}
                  AND b.deleted_at IS NULL
                  AND b.is_active IS TRUE
                RETURNING
                    b.id::text AS id,
                    b.public_id::text AS public_id
            )
            SELECT id, public_id FROM updated
        `);

        const updated = rows[0] ?? null;

        if (!updated) {
            return null;
        }

        if (snapshot.admin_area_resolve_spatial) {
            await this.tryInferDashboardBuildingAdminAreaFromGeometry(BigInt(updated.id));
        }

        return this.refetchDashboardBuildingAfterWrite(publicId, snapshot);
    }

    async updateDashboardBuildingScalars(
        publicId: string,
        snapshot: BuildingPersistSnapshot
    ): Promise<BuildingDetailRow | null> {
        const normalizedJson = JSON.stringify(snapshot.normalized_data);

        const rows = await this.prisma.$queryRaw<BuildingDetailRow[]>(Prisma.sql`
            UPDATE core.core_map_buildings AS b
            SET
                name = ${snapshot.name},
                building_type_id = ${snapshot.building_type_id},
                admin_area_id = ${snapshot.admin_area_id},
                normalized_data = ${normalizedJson}::jsonb,
                levels = ${snapshot.levels},
                height_m = ${snapshot.height_m},
                confidence_score = ${snapshot.confidence_score},
                is_verified = ${snapshot.is_verified},
                centroid = ST_PointOnSurface(b.geom)::geometry(Point, 4326),
                area_m2 = ST_Area(b.geom::geography)::double precision,
                updated_at = NOW()
            WHERE b.public_id = CAST(${publicId} AS uuid)
              AND ${dashboardBuildingClause}
              AND b.deleted_at IS NULL
              AND b.is_active IS TRUE
            RETURNING
                b.id::text AS id,
                b.public_id::text AS public_id,
                b.source_staging_id::text AS source_staging_id,
                b.external_id,
                ${buildingNameLabelSelectSql},
                ${buildingClassCodeSelectSql},
                b.building_type_id::text AS building_type_id,
                (SELECT bt.id::text FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS ref_bt_id,
                (SELECT bt.code FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS ref_bt_code,
                (SELECT bt.name FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS ref_bt_name,
                (SELECT bt.name_mm FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS ref_bt_name_mm,
                (SELECT bt.parent_id::text FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS ref_bt_parent_id,
                (SELECT bt.code FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS building_type_code,
                (SELECT bt.name FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS building_type_name,
                (SELECT bt.name_mm FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS building_type_name_mm,
                b.admin_area_id::text AS admin_area_id,
                (SELECT aa.id::text FROM core.core_admin_areas AS aa WHERE aa.id = b.admin_area_id LIMIT 1)
                    AS admin_area_row_id,
                (SELECT aa.canonical_name FROM core.core_admin_areas AS aa WHERE aa.id = b.admin_area_id LIMIT 1)
                    AS admin_area_canonical_name,
                (SELECT aa.slug FROM core.core_admin_areas AS aa WHERE aa.id = b.admin_area_id LIMIT 1)
                    AS admin_area_slug,
                b.normalized_data,
                b.source_refs,
                b.levels,
                b.height_m::double precision AS height_m,
                b.area_m2::double precision AS area_m2,
                b.confidence_score::double precision AS confidence_score,
                b.is_verified,
                b.is_active,
                b.created_at,
                b.updated_at,
                b.deleted_at,
                ST_AsGeoJSON(b.geom)::json AS geometry
        `);

        if (!rows[0]) {
            return null;
        }

        return this.refetchDashboardBuildingAfterWrite(publicId, snapshot);
    }

    /**
     * Soft-delete any active building (dashboard or import) by public_id.
     * Sets is_active = false, deleted_at = now, updated_at = now (explicit for tile + audit consistency).
     */
    async softDeleteActiveBuildingByPublicId(publicId: string): Promise<BuildingDetailRow | null> {
        const rows = await this.prisma.$queryRaw<BuildingDetailRow[]>(Prisma.sql`
            UPDATE core.core_map_buildings AS b
            SET
                is_active = FALSE,
                deleted_at = NOW(),
                updated_at = NOW()
            WHERE b.public_id = CAST(${publicId} AS uuid)
              AND b.deleted_at IS NULL
              AND b.is_active IS TRUE
            RETURNING
                b.id::text AS id,
                b.public_id::text AS public_id,
                b.source_staging_id::text AS source_staging_id,
                b.external_id,
                ${buildingNameLabelSelectSql},
                ${buildingClassCodeSelectSql},
                b.building_type_id::text AS building_type_id,
                (SELECT bt.id::text FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS ref_bt_id,
                (SELECT bt.code FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS ref_bt_code,
                (SELECT bt.name FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS ref_bt_name,
                (SELECT bt.name_mm FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS ref_bt_name_mm,
                (SELECT bt.parent_id::text FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS ref_bt_parent_id,
                (SELECT bt.code FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS building_type_code,
                (SELECT bt.name FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS building_type_name,
                (SELECT bt.name_mm FROM ref.ref_building_types AS bt WHERE bt.id = b.building_type_id LIMIT 1) AS building_type_name_mm,
                b.admin_area_id::text AS admin_area_id,
                (SELECT aa.id::text FROM core.core_admin_areas AS aa WHERE aa.id = b.admin_area_id LIMIT 1)
                    AS admin_area_row_id,
                (SELECT aa.canonical_name FROM core.core_admin_areas AS aa WHERE aa.id = b.admin_area_id LIMIT 1)
                    AS admin_area_canonical_name,
                (SELECT aa.slug FROM core.core_admin_areas AS aa WHERE aa.id = b.admin_area_id LIMIT 1)
                    AS admin_area_slug,
                b.normalized_data,
                b.source_refs,
                b.levels,
                b.height_m::double precision AS height_m,
                b.area_m2::double precision AS area_m2,
                b.confidence_score::double precision AS confidence_score,
                b.is_verified,
                b.is_active,
                b.created_at,
                b.updated_at,
                b.deleted_at,
                ST_AsGeoJSON(b.geom)::json AS geometry
        `);

        return rows[0] ?? null;
    }

    /** Active taxonomy rows for GET /building-types. */
    async listActiveRefBuildingTypes(): Promise<RefBuildingTypeRow[]> {
        return this.prisma.$queryRaw<RefBuildingTypeRow[]>(Prisma.sql`
            SELECT
                r.id::text AS id,
                r.code,
                r.name,
                r.name_mm,
                r.parent_id::text AS parent_id,
                r.sort_order
            FROM ref.ref_building_types AS r
            LEFT JOIN ref.ref_building_types AS p ON p.id = r.parent_id
            WHERE r.is_active IS TRUE
            ORDER BY COALESCE(p.sort_order, r.sort_order),
                (r.parent_id IS NOT NULL),
                r.sort_order,
                r.name
        `);
    }

    async getActiveBuildingTypeById(id: bigint): Promise<{ id: bigint; code: string } | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint; code: string }[]>(Prisma.sql`
            SELECT id, code
            FROM ref.ref_building_types
            WHERE id = ${id}
              AND is_active IS TRUE
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    async findBuildingTypeByCode(code: string): Promise<{ id: bigint; code: string } | null> {
        const normalized = code.trim().toLowerCase();
        const rows = await this.prisma.$queryRaw<{ id: bigint; code: string }[]>(Prisma.sql`
            SELECT id, code
            FROM ref.ref_building_types
            WHERE lower(code) = ${normalized}
              AND is_active IS TRUE
            LIMIT 1
        `);

        return rows[0] ?? null;
    }
}
