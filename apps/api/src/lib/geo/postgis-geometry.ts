import { Prisma, type PrismaClient } from "@prisma/client";

export type GeometryAnalysisRow = {
    allowed_type: boolean;
    is_valid: boolean;
    invalid_reason: string | null;
    area_m2: number | null;
};

export type GeometryKind = "point" | "line" | "polygon" | "multiLine";

export function geojsonSqlParam(geojson: unknown): string {
    return JSON.stringify(geojson);
}

export async function analyzePolygonGeometry(
    prisma: PrismaClient,
    geojsonText: string,
): Promise<GeometryAnalysisRow | null> {
    const rows = await prisma.$queryRaw<GeometryAnalysisRow[]>(Prisma.sql`
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

export async function analyzeLineGeometry(
    prisma: PrismaClient,
    geojsonText: string,
    multiLine = false,
): Promise<{ allowed_type: boolean; is_valid: boolean; invalid_reason: string | null } | null> {
    const rows = await prisma.$queryRaw<
        { allowed_type: boolean; is_valid: boolean; invalid_reason: string | null }[]
    >(Prisma.sql`
        WITH inp AS (
            SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g_raw
        ),
        prep AS (
            SELECT CASE
                WHEN ST_GeometryType(g_raw) = 'ST_LineString' AND ${!multiLine}
                    THEN g_raw::geometry(LineString, 4326)
                WHEN ST_GeometryType(g_raw) = 'ST_LineString' AND ${multiLine}
                    THEN ST_Multi(g_raw)::geometry(MultiLineString, 4326)
                WHEN ST_GeometryType(g_raw) = 'ST_MultiLineString' AND ${multiLine}
                    THEN g_raw::geometry(MultiLineString, 4326)
                ELSE NULL::geometry
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
            END AS invalid_reason
        FROM prep
    `);
    return rows[0] ?? null;
}

export async function analyzePointGeometry(
    prisma: PrismaClient,
    geojsonText: string,
): Promise<{ allowed_type: boolean; is_valid: boolean } | null> {
    const rows = await prisma.$queryRaw<{ allowed_type: boolean; is_valid: boolean }[]>(Prisma.sql`
        WITH inp AS (
            SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g_raw
        )
        SELECT
            ST_GeometryType(g_raw) = 'ST_Point' AS allowed_type,
            ST_IsValid(g_raw) AS is_valid
        FROM inp
    `);
    return rows[0] ?? null;
}

export function polygonGeomExpr(geojsonText: string): Prisma.Sql {
    return Prisma.sql`(
        SELECT CASE
            WHEN ST_GeometryType(g_raw) = 'ST_Polygon'
                THEN ST_Multi(g_raw)::geometry(MultiPolygon, 4326)
            WHEN ST_GeometryType(g_raw) = 'ST_MultiPolygon'
                THEN g_raw::geometry(MultiPolygon, 4326)
            ELSE NULL::geometry(MultiPolygon, 4326)
        END
        FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g_raw) AS inp
    )`;
}

export function lineStringGeomExpr(geojsonText: string): Prisma.Sql {
    return Prisma.sql`ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry(LineString, 4326), 4326)`;
}

export function multiLineStringGeomExpr(geojsonText: string): Prisma.Sql {
    return Prisma.sql`(
        SELECT CASE
            WHEN ST_GeometryType(g_raw) = 'ST_LineString'
                THEN ST_Multi(g_raw)::geometry(MultiLineString, 4326)
            WHEN ST_GeometryType(g_raw) = 'ST_MultiLineString'
                THEN g_raw::geometry(MultiLineString, 4326)
            ELSE NULL::geometry(MultiLineString, 4326)
        END
        FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g_raw) AS inp
    )`;
}

export function pointGeomExpr(geojsonText: string): Prisma.Sql {
    return Prisma.sql`ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry(Point, 4326), 4326)`;
}

export function centroidFromGeomExpr(geomExpr: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`ST_PointOnSurface(${geomExpr}::geometry)::geometry(Point, 4326)`;
}
