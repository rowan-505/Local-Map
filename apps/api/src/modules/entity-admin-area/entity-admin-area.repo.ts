import { Prisma, type PrismaClient } from "@prisma/client";

import {
    ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES,
    ENTITY_ADMIN_AREA_TARGET_LEVEL,
} from "./entity-admin-area.constants.js";

export type EntityAdminAreaKind = "place" | "street" | "building";

export type EntityAdminAreaSummaryRow = {
    id: bigint;
    canonical_name: string;
    admin_level_code: string;
    admin_level_name: string | null;
};

/** SQL: active admin area row matches township target (same rules as repair pipeline). */
const townshipLevelMatchSql = Prisma.sql`
    (
        lower(btrim(al.code)) IN ('township', 'town')
        OR lower(btrim(al.name)) IN ('township', 'town')
        OR lower(btrim(al.code)) = ${ENTITY_ADMIN_AREA_TARGET_LEVEL}
        OR lower(btrim(al.name)) = ${ENTITY_ADMIN_AREA_TARGET_LEVEL}
    )
`;

export class EntityAdminAreaRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async getActiveAdminAreaSummary(adminAreaId: bigint): Promise<EntityAdminAreaSummaryRow | null> {
        const rows = await this.prisma.$queryRaw<EntityAdminAreaSummaryRow[]>`
            SELECT
                a.id,
                a.canonical_name,
                al.code AS admin_level_code,
                al.name AS admin_level_name
            FROM core.core_admin_areas AS a
            INNER JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
            WHERE a.id = ${adminAreaId}
              AND a.is_active IS TRUE
              AND a.deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async isTownshipAdminArea(adminAreaId: bigint): Promise<boolean> {
        const row = await this.getActiveAdminAreaSummary(adminAreaId);
        if (!row) {
            return false;
        }
        const code = row.admin_level_code.trim().toLowerCase();
        if (ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES.has(code)) {
            return false;
        }
        const levelName = row.admin_level_name?.trim().toLowerCase() ?? "";
        return (
            code === ENTITY_ADMIN_AREA_TARGET_LEVEL ||
            code === "town" ||
            levelName === ENTITY_ADMIN_AREA_TARGET_LEVEL
        );
    }

    async inferAdminAreaIdForPoint(lng: number, lat: number): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ admin_area_id: bigint | null }[]>`
            WITH pt AS (
                SELECT ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geometry(Point, 4326) AS g
            )
            SELECT (
                SELECT aa.id
                FROM core.core_admin_areas AS aa
                INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
                CROSS JOIN pt
                WHERE aa.is_active IS TRUE
                  AND aa.deleted_at IS NULL
                  AND aa.geom IS NOT NULL
                  AND NOT ST_IsEmpty(aa.geom)
                  AND ST_IsValid(aa.geom)
                  AND ${townshipLevelMatchSql}
                  AND (
                      ST_Covers(aa.geom, pt.g)
                      OR ST_Contains(aa.geom, pt.g)
                      OR ST_Intersects(aa.geom, pt.g)
                  )
                ORDER BY ST_Area(aa.geom::geography) ASC NULLS LAST, aa.id ASC
                LIMIT 1
            ) AS admin_area_id
        `;
        return rows[0]?.admin_area_id ?? null;
    }

    async inferAdminAreaIdForLineGeoJson(geojsonText: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ admin_area_id: bigint | null }[]>`
            WITH raw AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g
            ),
            line AS (
                SELECT CASE
                    WHEN ST_GeometryType(g) IN ('ST_LineString', 'ST_MultiLineString')
                        THEN ST_LineMerge(ST_MakeValid(g))
                    ELSE NULL::geometry
                END AS g
                FROM raw
            )
            SELECT (
                SELECT aa.id
                FROM core.core_admin_areas AS aa
                INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
                CROSS JOIN line
                WHERE line.g IS NOT NULL
                  AND aa.is_active IS TRUE
                  AND aa.deleted_at IS NULL
                  AND aa.geom IS NOT NULL
                  AND NOT ST_IsEmpty(aa.geom)
                  AND ST_IsValid(aa.geom)
                  AND ${townshipLevelMatchSql}
                  AND ST_Intersects(aa.geom, line.g)
                ORDER BY
                    ST_Length(ST_Intersection(aa.geom, line.g)::geography) DESC NULLS LAST,
                    ST_Area(aa.geom::geography) ASC NULLS LAST,
                    aa.id ASC
                LIMIT 1
            ) AS admin_area_id
        `;
        return rows[0]?.admin_area_id ?? null;
    }

    async inferAdminAreaIdForPolygonGeoJson(geojsonText: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ admin_area_id: bigint | null }[]>`
            WITH raw AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g
            ),
            pt AS (
                SELECT ST_PointOnSurface(ST_MakeValid(g))::geometry(Point, 4326) AS g
                FROM raw
                WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)
            )
            SELECT (
                SELECT aa.id
                FROM core.core_admin_areas AS aa
                INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
                CROSS JOIN pt
                WHERE pt.g IS NOT NULL
                  AND aa.is_active IS TRUE
                  AND aa.deleted_at IS NULL
                  AND aa.geom IS NOT NULL
                  AND NOT ST_IsEmpty(aa.geom)
                  AND ST_IsValid(aa.geom)
                  AND ${townshipLevelMatchSql}
                  AND (
                      ST_Covers(aa.geom, pt.g)
                      OR ST_Contains(aa.geom, pt.g)
                      OR ST_Intersects(aa.geom, pt.g)
                  )
                ORDER BY ST_Area(aa.geom::geography) ASC NULLS LAST, aa.id ASC
                LIMIT 1
            ) AS admin_area_id
        `;
        return rows[0]?.admin_area_id ?? null;
    }

    async geometryMatchesTownshipAdminArea(
        adminAreaId: bigint,
        kind: EntityAdminAreaKind,
        args: { lng: number; lat: number } | { geojsonText: string }
    ): Promise<boolean> {
        if (kind === "place" && "lng" in args) {
            const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
                SELECT EXISTS (
                    SELECT 1
                    FROM core.core_admin_areas AS aa
                    CROSS JOIN (
                        SELECT ST_SetSRID(ST_MakePoint(${args.lng}, ${args.lat}), 4326)::geometry(Point, 4326) AS g
                    ) AS pt
                    WHERE aa.id = ${adminAreaId}
                      AND aa.is_active IS TRUE
                      AND aa.deleted_at IS NULL
                      AND aa.geom IS NOT NULL
                      AND (
                          ST_Covers(aa.geom, pt.g)
                          OR ST_Contains(aa.geom, pt.g)
                          OR ST_Intersects(aa.geom, pt.g)
                      )
                ) AS ok
            `;
            return rows[0]?.ok === true;
        }

        if (kind === "street" && "geojsonText" in args) {
            const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
                WITH raw AS (
                    SELECT ST_SetSRID(ST_GeomFromGeoJSON(${args.geojsonText})::geometry, 4326) AS g
                ),
                line AS (
                    SELECT CASE
                        WHEN ST_GeometryType(g) IN ('ST_LineString', 'ST_MultiLineString')
                            THEN ST_LineMerge(ST_MakeValid(g))
                        ELSE NULL::geometry
                    END AS g
                    FROM raw
                )
                SELECT EXISTS (
                    SELECT 1
                    FROM core.core_admin_areas AS aa
                    CROSS JOIN line
                    WHERE aa.id = ${adminAreaId}
                      AND line.g IS NOT NULL
                      AND aa.is_active IS TRUE
                      AND aa.deleted_at IS NULL
                      AND aa.geom IS NOT NULL
                      AND ST_Intersects(aa.geom, line.g)
                ) AS ok
            `;
            return rows[0]?.ok === true;
        }

        if (kind === "building" && "geojsonText" in args) {
            const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
                WITH raw AS (
                    SELECT ST_SetSRID(ST_GeomFromGeoJSON(${args.geojsonText})::geometry, 4326) AS g
                ),
                pt AS (
                    SELECT ST_PointOnSurface(ST_MakeValid(g))::geometry(Point, 4326) AS g
                    FROM raw
                    WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)
                )
                SELECT EXISTS (
                    SELECT 1
                    FROM core.core_admin_areas AS aa
                    CROSS JOIN pt
                    WHERE aa.id = ${adminAreaId}
                      AND pt.g IS NOT NULL
                      AND aa.is_active IS TRUE
                      AND aa.deleted_at IS NULL
                      AND aa.geom IS NOT NULL
                      AND (
                          ST_Covers(aa.geom, pt.g)
                          OR ST_Contains(aa.geom, pt.g)
                          OR ST_Intersects(aa.geom, pt.g)
                      )
                ) AS ok
            `;
            return rows[0]?.ok === true;
        }

        return false;
    }
}
