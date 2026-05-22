import { Prisma } from "@prisma/client";

import { geomSourceExpr } from "./import-review-promotion-promote-sql.js";

/** Admin area id from review_overrides / normalized_data only (road_candidates has no column). */
export function roadsExplicitAdminAreaIdExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        coalesce(
            CASE WHEN (${a}.review_overrides->>'admin_area_id') ~ '^[0-9]+$'
                THEN (${a}.review_overrides->>'admin_area_id')::bigint END,
            CASE WHEN (${a}.normalized_data->>'admin_area_id') ~ '^[0-9]+$'
                THEN (${a}.normalized_data->>'admin_area_id')::bigint END
        )
    `;
}

/** Effective road centerline for admin-area spatial lookup (override geom when set). */
export function roadCandidateGeomForAdminAreaExpr(alias: string): Prisma.Sql {
    return geomSourceExpr(alias, "geom");
}

/**
 * LEFT JOIN explicit admin area by override/normalized id, then LATERAL smallest
 * intersecting active admin polygon when no explicit id is set.
 */
export function buildRoadAdminAreaJoins(tableAlias: string): Prisma.Sql {
    const explicitId = roadsExplicitAdminAreaIdExpr(tableAlias);
    const roadGeom = roadCandidateGeomForAdminAreaExpr(tableAlias);

    return Prisma.sql`
        LEFT JOIN core.core_admin_areas AS eff_aa_explicit
            ON eff_aa_explicit.id = ${explicitId}
            AND eff_aa_explicit.is_active IS TRUE
            AND eff_aa_explicit.deleted_at IS NULL
        LEFT JOIN LATERAL (
            SELECT
                aa.id AS admin_area_id,
                aa.canonical_name AS admin_area_name
            FROM core.core_admin_areas AS aa
            WHERE ${explicitId} IS NULL
              AND ${roadGeom} IS NOT NULL
              AND aa.geom IS NOT NULL
              AND aa.is_active IS TRUE
              AND aa.deleted_at IS NULL
              AND ST_Intersects(aa.geom, ${roadGeom})
            ORDER BY ST_Area(aa.geom::geography) ASC
            LIMIT 1
        ) AS road_geom_aa ON TRUE
    `;
}

/** Resolved admin area id for road list/detail SELECT. */
export function roadResolvedAdminAreaIdExpr(tableAlias: string): Prisma.Sql {
    const explicitId = roadsExplicitAdminAreaIdExpr(tableAlias);
    return Prisma.sql`coalesce(${explicitId}, road_geom_aa.admin_area_id)`;
}

/** Resolved admin area display name for road list/detail SELECT. */
export function roadResolvedAdminAreaNameExpr(): Prisma.Sql {
    return Prisma.sql`coalesce(eff_aa_explicit.canonical_name, road_geom_aa.admin_area_name)`;
}
