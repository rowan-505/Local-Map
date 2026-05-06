import { Prisma, type PrismaClient } from "@prisma/client";

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
    name: string | null;
    class_code: string;
    building_type: string | null;
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
    name: string | null;
    class_code: string;
    building_type_column: string;
    normalized_data: Record<string, unknown>;
    levels: number | null;
    height_m: number | null;
    confidence_score: number;
    is_verified: boolean;
};

export class BuildingsRepository {
    constructor(private readonly prisma: PrismaClient) {}

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

    /** Active, non-deleted buildings (imports + dashboard), no source filter. */
    async listActiveBuildings(params: {
        limit: number;
        offset: number;
        q?: string;
    }): Promise<BuildingDetailRow[]> {
        const searchClause =
            params.q === undefined
                ? Prisma.sql`TRUE`
                : Prisma.sql`(
                    COALESCE(b.name, '') ILIKE ${"%" + params.q + "%"}
                    OR COALESCE(b.building_type, b.class_code, 'yes'::text) ILIKE ${"%" + params.q + "%"}
                    OR COALESCE(b.class_code, '') ILIKE ${"%" + params.q + "%"}
                )`;

        return this.prisma.$queryRaw<BuildingDetailRow[]>(Prisma.sql`
            SELECT
                b.id::text AS id,
                b.public_id::text AS public_id,
                b.source_staging_id::text AS source_staging_id,
                b.external_id,
                b.name,
                b.class_code,
                b.building_type,
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
            WHERE b.deleted_at IS NULL
              AND b.is_active IS TRUE
              AND ${searchClause}
            ORDER BY b.updated_at DESC, b.id DESC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `);
    }

    /** GET /buildings/:id — any active row (imports + dashboard). */
    async getActiveBuildingByPublicId(publicId: string): Promise<BuildingDetailRow | null> {
        const rows = await this.prisma.$queryRaw<BuildingDetailRow[]>(Prisma.sql`
            SELECT
                b.id::text AS id,
                b.public_id::text AS public_id,
                b.source_staging_id::text AS source_staging_id,
                b.external_id,
                b.name,
                b.class_code,
                b.building_type,
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
            WHERE b.public_id = CAST(${publicId} AS uuid)
              AND b.deleted_at IS NULL
              AND b.is_active IS TRUE
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    async getDashboardBuildingByPublicId(publicId: string): Promise<BuildingDetailRow | null> {
        const rows = await this.prisma.$queryRaw<BuildingDetailRow[]>(Prisma.sql`
            SELECT
                b.id::text AS id,
                b.public_id::text AS public_id,
                b.source_staging_id::text AS source_staging_id,
                b.external_id,
                b.name,
                b.class_code,
                b.building_type,
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
        const normalizedJson = JSON.stringify(snapshot.normalized_data);

        const rows = await this.prisma.$queryRaw<BuildingDetailRow[]>(Prisma.sql`
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
                class_code,
                normalized_data,
                source_refs,
                geom,
                building_type,
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
                lbl.resolved_label,
                ${normalizedJson}::jsonb,
                '{"source":"dashboard"}'::jsonb,
                ready.geom,
                lbl.resolved_label,
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
                public_id::text AS public_id,
                source_staging_id::text AS source_staging_id,
                external_id,
                name,
                class_code,
                building_type,
                normalized_data,
                source_refs,
                levels,
                height_m::double precision AS height_m,
                area_m2::double precision AS area_m2,
                confidence_score::double precision AS confidence_score,
                is_verified,
                is_active,
                created_at,
                updated_at,
                deleted_at,
                ST_AsGeoJSON(geom)::json AS geometry
        `);

        return rows[0] ?? null;
    }

    async updateDashboardBuildingGeometry(
        publicId: string,
        geojsonText: string,
        snapshot: BuildingPersistSnapshot
    ): Promise<BuildingDetailRow | null> {
        const normalizedJson = JSON.stringify(snapshot.normalized_data);

        const rows = await this.prisma.$queryRaw<BuildingDetailRow[]>(Prisma.sql`
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
                    class_code = lbl.resolved_label,
                    building_type = lbl.resolved_label,
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
                    b.public_id::text AS public_id,
                    b.source_staging_id::text AS source_staging_id,
                    b.external_id,
                    b.name,
                    b.class_code,
                    b.building_type,
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
            )
            SELECT * FROM updated
        `);

        return rows[0] ?? null;
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
                class_code = COALESCE(
                    NULLIF(btrim(${snapshot.building_type_column}::text), ''),
                    NULLIF(btrim(${snapshot.class_code}::text), ''),
                    'yes'
                ),
                building_type = COALESCE(
                    NULLIF(btrim(${snapshot.building_type_column}::text), ''),
                    NULLIF(btrim(${snapshot.class_code}::text), ''),
                    'yes'
                ),
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
                b.name,
                b.class_code,
                b.building_type,
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
                b.name,
                b.class_code,
                b.building_type,
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
}
