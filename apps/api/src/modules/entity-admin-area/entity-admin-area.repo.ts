import { Prisma, type PrismaClient } from "@prisma/client";

import { roadTownshipAdminLevelWhereSql } from "../admin-areas/admin-areas.road-township-level.js";
import {
    ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES,
    ENTITY_ADMIN_AREA_TARGET_LEVEL,
} from "./entity-admin-area.constants.js";
import {
    emptyRoadTownshipRecommendation,
    getRoadTownshipNearestMaxM,
    type RoadTownshipCommonParentRow,
    type RoadTownshipMatchRow,
    type RoadTownshipRecommendationResult,
} from "./entity-admin-area.road-township-recommend.js";

export type EntityAdminAreaKind = "place" | "street" | "building" | "land_area" | "bus_stop";

export type EntityAdminAreaSummaryRow = {
    id: bigint;
    canonical_name: string;
    admin_level_code: string;
    admin_level_name: string | null;
};

export type RoadTownshipInferRow = {
    id: bigint;
    canonical_name: string;
    admin_level_code: string;
    name_mm: string | null;
    name_en: string | null;
    geometry_intersects: boolean;
};

export type EntityAdminAreaRowStatus = {
    id: bigint;
    canonical_name: string;
    admin_level_code: string;
    admin_level_name: string | null;
    is_active: boolean;
    deleted_at: Date | null;
};

/** Active township rows for road inference (matches picker/search eligibility). */
function activeRoadTownshipBaseSql(adminAreaAlias: string): Prisma.Sql {
    const area = Prisma.raw(adminAreaAlias);
    return Prisma.sql`
        ${area}.is_active IS TRUE
        AND ${area}.deleted_at IS NULL
        AND ${area}.geom IS NOT NULL
        AND NOT ST_IsEmpty(${area}.geom)
        AND ST_IsValid(${area}.geom)
        AND ${roadTownshipAdminLevelWhereSql}
    `;
}

const adminAreaNameMmLateralSql = (adminAreaAlias: string) => Prisma.sql`
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_admin_area_names AS n
        WHERE n.admin_area_id = ${Prisma.raw(adminAreaAlias)}.id
          AND (
              lower(trim(coalesce(n.language_code, ''))) = 'my'
              OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
          )
        ORDER BY
            CASE
                WHEN n.name_type = 'official' AND n.is_primary IS TRUE THEN 1
                WHEN n.is_primary IS TRUE THEN 2
                WHEN n.name_type = 'official' THEN 3
                ELSE 4
            END,
            n.search_weight DESC NULLS LAST,
            n.name ASC
        LIMIT 1
    ) AS an_mm ON true
`;

const adminAreaNameEnLateralSql = (adminAreaAlias: string) => Prisma.sql`
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_admin_area_names AS n
        WHERE n.admin_area_id = ${Prisma.raw(adminAreaAlias)}.id
          AND (
              lower(trim(coalesce(n.language_code, ''))) = 'en'
              OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
          )
        ORDER BY
            CASE
                WHEN n.name_type = 'official' AND n.is_primary IS TRUE THEN 1
                WHEN n.is_primary IS TRUE THEN 2
                WHEN n.name_type = 'official' THEN 3
                ELSE 4
            END,
            n.search_weight DESC NULLS LAST,
            n.name ASC
        LIMIT 1
    ) AS an_en ON true
`;

/** SQL: active admin area row matches township target (places/buildings; unchanged). */
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

    async getAdminAreaSummaryAnyStatus(adminAreaId: bigint): Promise<EntityAdminAreaRowStatus | null> {
        const rows = await this.prisma.$queryRaw<EntityAdminAreaRowStatus[]>`
            SELECT
                a.id,
                a.canonical_name,
                al.code AS admin_level_code,
                al.name AS admin_level_name,
                a.is_active,
                a.deleted_at
            FROM core.core_admin_areas AS a
            INNER JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
            WHERE a.id = ${adminAreaId}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

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
        const row = await this.inferTownshipAdminAreaForRoadGeoJson(geojsonText);
        return row?.id ?? null;
    }

    /**
     * Multi-step road township recommendation: overlap → point fallback → nearest within threshold.
     * Returns no_township_polygons only when zero active township polygons exist globally; roads
     * outside all township envelopes continue to nearest fallback (outside_all_townships).
     */
    async recommendRoadTownshipFromGeoJson(geojsonText: string): Promise<RoadTownshipRecommendationResult> {
        try {
            const prepRows = await this.prisma.$queryRaw<
                {
                    valid: boolean;
                    road_length_m: number | null;
                    has_global_townships: boolean;
                    has_envelope_coverage: boolean;
                }[]
            >`
                WITH raw AS (
                    SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g
                ),
                road AS (
                    SELECT
                        CASE
                            WHEN ST_GeometryType(g) IN ('ST_LineString', 'ST_MultiLineString')
                                THEN ST_LineMerge(ST_MakeValid(g))
                            ELSE NULL::geometry
                        END AS g
                    FROM raw
                ),
                road_stats AS (
                    SELECT
                        g,
                        (
                            g IS NOT NULL
                            AND NOT ST_IsEmpty(g)
                            AND ST_IsValid(g)
                        ) AS valid,
                        CASE
                            WHEN g IS NOT NULL AND NOT ST_IsEmpty(g)
                                THEN ST_Length(g::geography)
                            ELSE NULL
                        END AS road_length_m,
                        CASE
                            WHEN g IS NOT NULL AND NOT ST_IsEmpty(g)
                                THEN ST_Envelope(g)
                            ELSE NULL
                        END AS env
                    FROM road
                ),
                global_townships AS (
                    SELECT EXISTS (
                        SELECT 1
                        FROM core.core_admin_areas AS aa
                        INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
                        WHERE ${activeRoadTownshipBaseSql("aa")}
                        LIMIT 1
                    ) AS has_any
                ),
                envelope_coverage AS (
                    SELECT EXISTS (
                        SELECT 1
                        FROM core.core_admin_areas AS aa
                        INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
                        CROSS JOIN road_stats AS rs
                        WHERE rs.valid
                          AND rs.env IS NOT NULL
                          AND ${activeRoadTownshipBaseSql("aa")}
                          AND aa.geom && rs.env
                        LIMIT 1
                    ) AS has_coverage
                )
                SELECT
                    rs.valid,
                    rs.road_length_m,
                    gt.has_any AS has_global_townships,
                    ec.has_coverage AS has_envelope_coverage
                FROM road_stats AS rs
                CROSS JOIN global_townships AS gt
                CROSS JOIN envelope_coverage AS ec
            `;

            const prep = prepRows[0];
            if (!prep?.valid) {
                return emptyRoadTownshipRecommendation("invalid_geometry");
            }

            const roadLengthM = prep.road_length_m;

            if (!prep.has_global_townships) {
                return emptyRoadTownshipRecommendation("no_township_polygons", {
                    road_length_m: roadLengthM,
                });
            }

            if (!prep.has_envelope_coverage) {
                const nearest = await this.findNearestRoadTownshipForGeoJson(geojsonText, roadLengthM);
                return emptyRoadTownshipRecommendation("outside_all_townships", {
                    road_length_m: roadLengthM,
                    nearest_unfiltered_distance_m: nearest?.distance_m ?? null,
                });
            }

            const overlapRows = await this.prisma.$queryRaw<
                {
                    id: bigint;
                    canonical_name: string;
                    admin_level_code: string;
                    name_mm: string | null;
                    name_en: string | null;
                    overlap_m: number;
                }[]
            >`
                WITH raw AS (
                    SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g
                ),
                road AS (
                    SELECT ST_LineMerge(ST_MakeValid(g)) AS g FROM raw
                ),
                road_len AS (
                    SELECT ST_Length(road.g::geography) AS len_m FROM road
                ),
                candidates AS (
                    SELECT
                        aa.id,
                        ST_Length(ST_Intersection(aa.geom, road.g)::geography) AS overlap_m
                    FROM core.core_admin_areas AS aa
                    INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
                    CROSS JOIN road
                    WHERE road.g IS NOT NULL
                      AND ${activeRoadTownshipBaseSql("aa")}
                      AND aa.geom && road.g
                      AND ST_Intersects(aa.geom, road.g)
                )
                SELECT
                    a.id,
                    a.canonical_name,
                    al.code AS admin_level_code,
                    an_mm.name AS name_mm,
                    an_en.name AS name_en,
                    c.overlap_m
                FROM candidates AS c
                INNER JOIN core.core_admin_areas AS a ON a.id = c.id
                INNER JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
                ${adminAreaNameMmLateralSql("a")}
                ${adminAreaNameEnLateralSql("a")}
                CROSS JOIN road_len
                WHERE c.overlap_m > 0
                ORDER BY
                    c.overlap_m DESC NULLS LAST,
                    (c.overlap_m / NULLIF(road_len.len_m, 0)) DESC NULLS LAST,
                    ST_Area(a.geom::geography) ASC NULLS LAST,
                    a.id ASC
                LIMIT 25
            `;

            if (overlapRows.length > 0) {
                const matches = this.mapOverlapRows(overlapRows, roadLengthM);
                const commonParent =
                    matches.length >= 2
                        ? await this.findCommonParentForTownshipIds(matches.map((m) => m.id))
                        : null;
                return {
                    recommended: matches[0] ?? null,
                    matches,
                    commonParent,
                    fallback_reason: null,
                    distance_m: null,
                    nearest_unfiltered_distance_m: null,
                    debugReason: null,
                    road_length_m: roadLengthM,
                    geometry_intersects: true,
                };
            }

            return this.recommendRoadTownshipFallbackFromGeoJson(geojsonText, roadLengthM);
        } catch {
            return emptyRoadTownshipRecommendation("query_error");
        }
    }

    private async recommendRoadTownshipFallbackFromGeoJson(
        geojsonText: string,
        roadLengthM: number | null,
    ): Promise<RoadTownshipRecommendationResult> {
        const pointRows = await this.prisma.$queryRaw<
            {
                id: bigint;
                canonical_name: string;
                admin_level_code: string;
                name_mm: string | null;
                name_en: string | null;
            }[]
        >`
            WITH raw AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g
            ),
            road AS (
                SELECT ST_LineMerge(ST_MakeValid(g)) AS g FROM raw
            ),
            rep_pt AS (
                SELECT COALESCE(
                    ST_PointOnSurface(road.g),
                    ST_Centroid(road.g)
                )::geometry(Point, 4326) AS g
                FROM road
                WHERE road.g IS NOT NULL AND NOT ST_IsEmpty(road.g)
            )
            SELECT
                a.id,
                a.canonical_name,
                al.code AS admin_level_code,
                an_mm.name AS name_mm,
                an_en.name AS name_en
            FROM core.core_admin_areas AS a
            INNER JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
            CROSS JOIN rep_pt AS pt
            ${adminAreaNameMmLateralSql("a")}
            ${adminAreaNameEnLateralSql("a")}
            WHERE pt.g IS NOT NULL
              AND ${activeRoadTownshipBaseSql("a")}
              AND a.geom && pt.g
              AND (
                  ST_Covers(a.geom, pt.g)
                  OR ST_Contains(a.geom, pt.g)
                  OR ST_Intersects(a.geom, pt.g)
              )
            ORDER BY ST_Area(a.geom::geography) ASC NULLS LAST, a.id ASC
            LIMIT 1
        `;

        if (pointRows[0]) {
            const match = this.mapPointFallbackRow(pointRows[0]);
            return {
                recommended: match,
                matches: [match],
                commonParent: null,
                fallback_reason: "point_fallback",
                distance_m: null,
                nearest_unfiltered_distance_m: null,
                debugReason: null,
                road_length_m: roadLengthM,
                geometry_intersects: false,
            };
        }

        const nearestThresholdM = getRoadTownshipNearestMaxM();
        const nearest = await this.findNearestRoadTownshipForGeoJson(geojsonText, roadLengthM);
        if (nearest && nearest.distance_m <= nearestThresholdM) {
            const match = this.mapNearestRow(nearest, roadLengthM);
            return {
                recommended: match,
                matches: [match],
                commonParent: null,
                fallback_reason: "nearest_township",
                distance_m: nearest.distance_m,
                nearest_unfiltered_distance_m: nearest.distance_m,
                debugReason: null,
                road_length_m: roadLengthM,
                geometry_intersects: false,
            };
        }

        return emptyRoadTownshipRecommendation("outside_all_townships", {
            road_length_m: roadLengthM,
            nearest_unfiltered_distance_m: nearest?.distance_m ?? null,
        });
    }

    private async findNearestRoadTownshipForGeoJson(
        geojsonText: string,
        _roadLengthM: number | null,
    ): Promise<{
        id: bigint;
        canonical_name: string;
        admin_level_code: string;
        name_mm: string | null;
        name_en: string | null;
        distance_m: number;
    } | null> {
        const nearestThresholdM = getRoadTownshipNearestMaxM();
        const expandDegrees = nearestThresholdM / 111_320;

        const nearestRows = await this.prisma.$queryRaw<
            {
                id: bigint;
                canonical_name: string;
                admin_level_code: string;
                name_mm: string | null;
                name_en: string | null;
                distance_m: number;
            }[]
        >`
            WITH raw AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g
            ),
            road AS (
                SELECT ST_LineMerge(ST_MakeValid(g)) AS g FROM raw
            )
            SELECT
                a.id,
                a.canonical_name,
                al.code AS admin_level_code,
                an_mm.name AS name_mm,
                an_en.name AS name_en,
                ST_Distance(a.geom::geography, road.g::geography) AS distance_m
            FROM core.core_admin_areas AS a
            INNER JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
            CROSS JOIN road
            ${adminAreaNameMmLateralSql("a")}
            ${adminAreaNameEnLateralSql("a")}
            WHERE road.g IS NOT NULL
              AND ${activeRoadTownshipBaseSql("a")}
              AND a.geom && ST_Expand(road.g, ${expandDegrees}::double precision)
            ORDER BY a.geom <-> road.g ASC NULLS LAST, a.id ASC
            LIMIT 1
        `;

        return nearestRows[0] ?? null;
    }

    /**
     * Road/street-only township inference (write path compatibility).
     */
    async inferTownshipAdminAreaForRoadGeoJson(geojsonText: string): Promise<RoadTownshipInferRow | null> {
        const result = await this.recommendRoadTownshipFromGeoJson(geojsonText);
        if (!result.recommended) {
            return null;
        }
        return {
            id: result.recommended.id,
            canonical_name: result.recommended.canonical_name,
            admin_level_code: result.recommended.admin_level_code,
            name_mm: result.recommended.name_mm,
            name_en: result.recommended.name_en,
            geometry_intersects: result.geometry_intersects,
        };
    }

    private mapOverlapRows(
        rows: {
            id: bigint;
            canonical_name: string;
            admin_level_code: string;
            name_mm: string | null;
            name_en: string | null;
            overlap_m: number;
        }[],
        roadLengthM: number | null,
    ): RoadTownshipMatchRow[] {
        return rows.map((row) => ({
            id: row.id,
            canonical_name: row.canonical_name,
            name_mm: row.name_mm,
            name_en: row.name_en,
            admin_level_code: row.admin_level_code,
            overlap_m: Number(row.overlap_m),
            overlap_pct:
                roadLengthM && roadLengthM > 0
                    ? Number(row.overlap_m) / roadLengthM
                    : null,
        }));
    }

    private mapPointFallbackRow(row: {
        id: bigint;
        canonical_name: string;
        admin_level_code: string;
        name_mm: string | null;
        name_en: string | null;
    }): RoadTownshipMatchRow {
        return {
            id: row.id,
            canonical_name: row.canonical_name,
            name_mm: row.name_mm,
            name_en: row.name_en,
            admin_level_code: row.admin_level_code,
            overlap_m: 0,
            overlap_pct: null,
        };
    }

    private mapNearestRow(
        row: {
            id: bigint;
            canonical_name: string;
            admin_level_code: string;
            name_mm: string | null;
            name_en: string | null;
            distance_m: number;
        },
        roadLengthM: number | null,
    ): RoadTownshipMatchRow {
        return {
            id: row.id,
            canonical_name: row.canonical_name,
            name_mm: row.name_mm,
            name_en: row.name_en,
            admin_level_code: row.admin_level_code,
            overlap_m: 0,
            overlap_pct: roadLengthM && roadLengthM > 0 ? 0 : null,
        };
    }

    private async findCommonParentForTownshipIds(
        townshipIds: bigint[],
    ): Promise<RoadTownshipCommonParentRow | null> {
        if (townshipIds.length < 2) {
            return null;
        }

        const uniqueIds = [...new Set(townshipIds.map((id) => id.toString()))].map((id) => BigInt(id));
        const seedIdSql = Prisma.join(uniqueIds);
        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                canonical_name: string;
                admin_level_code: string;
                name_mm: string | null;
                name_en: string | null;
                depth: number;
            }[]
        >`
            WITH RECURSIVE
            seeds AS (
                SELECT id AS township_id
                FROM core.core_admin_areas
                WHERE id IN (${seedIdSql})
            ),
            ancestors AS (
                SELECT
                    s.township_id AS seed_id,
                    a.id,
                    a.parent_id,
                    a.canonical_name,
                    al.code AS admin_level_code,
                    0 AS depth
                FROM seeds AS s
                INNER JOIN core.core_admin_areas AS a ON a.id = s.township_id
                INNER JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
                UNION ALL
                SELECT
                    anc.seed_id,
                    p.id,
                    p.parent_id,
                    p.canonical_name,
                    al.code AS admin_level_code,
                    anc.depth + 1
                FROM ancestors AS anc
                INNER JOIN core.core_admin_areas AS p ON p.id = anc.parent_id
                INNER JOIN ref.ref_admin_levels AS al ON al.id = p.admin_level_id
                WHERE anc.parent_id IS NOT NULL
                  AND anc.depth < 12
            ),
            context_levels AS (
                SELECT *
                FROM ancestors
                WHERE lower(btrim(admin_level_code)) IN (
                    'district',
                    'state_region',
                    'division',
                    'state',
                    'region'
                )
            ),
            shared AS (
                SELECT id, canonical_name, admin_level_code, MAX(depth) AS max_depth
                FROM context_levels
                GROUP BY id, canonical_name, admin_level_code
                HAVING COUNT(DISTINCT seed_id) = (SELECT COUNT(*) FROM seeds)
            )
            SELECT
                s.id,
                s.canonical_name,
                s.admin_level_code,
                an_mm.name AS name_mm,
                an_en.name AS name_en,
                s.max_depth AS depth
            FROM shared AS s
            INNER JOIN core.core_admin_areas AS a ON a.id = s.id
            ${adminAreaNameMmLateralSql("a")}
            ${adminAreaNameEnLateralSql("a")}
            ORDER BY s.max_depth DESC, s.id ASC
            LIMIT 1
        `;

        const row = rows[0];
        if (!row) {
            return null;
        }
        return {
            id: row.id,
            canonical_name: row.canonical_name,
            admin_level_code: row.admin_level_code,
            name_mm: row.name_mm,
            name_en: row.name_en,
        };
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

        if ((kind === "building" || kind === "land_area") && "geojsonText" in args) {
            const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
                WITH raw AS (
                    SELECT ST_SetSRID(ST_GeomFromGeoJSON(${args.geojsonText})::geometry, 4326) AS g
                ),
                poly AS (
                    SELECT ST_MakeValid(g)::geometry AS g
                    FROM raw
                    WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)
                ),
                pt AS (
                    SELECT ST_PointOnSurface(g)::geometry(Point, 4326) AS g
                    FROM poly
                )
                SELECT EXISTS (
                    SELECT 1
                    FROM core.core_admin_areas AS aa
                    CROSS JOIN poly
                    CROSS JOIN pt
                    WHERE aa.id = ${adminAreaId}
                      AND poly.g IS NOT NULL
                      AND pt.g IS NOT NULL
                      AND aa.is_active IS TRUE
                      AND aa.deleted_at IS NULL
                      AND aa.geom IS NOT NULL
                      AND (
                          ST_Intersects(aa.geom, poly.g)
                          OR ST_Covers(aa.geom, pt.g)
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
