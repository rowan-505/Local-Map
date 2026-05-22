import { Prisma } from "@prisma/client";

import {
    busStopPrimaryRealNameExpr,
    busStopStopCodeExpr,
} from "./import-review-effective-values.js";

/** EXISTS clause: successful publish item has a verified core row for the entity family. */
export function coreVerificationExistsSql(entityFamily: string): Prisma.Sql {
    switch (entityFamily) {
        case "buildings":
            return Prisma.sql`
                spi.entity_family = 'buildings'
                AND EXISTS (
                    SELECT 1 FROM core.core_map_buildings AS c
                    WHERE c.id = spi.target_id
                      AND coalesce(c.is_active, true)
                      AND c.deleted_at IS NULL
                      AND c.geom IS NOT NULL
                      AND ST_IsValid(c.geom)
                      AND ST_SRID(c.geom) = 4326
                      AND c.source_refs->>'review_candidate_id' IS NOT NULL
                      AND c.source_refs->>'publish_batch_id' IS NOT NULL
                )
            `;
        case "places":
            return Prisma.sql`
                spi.entity_family = 'places'
                AND EXISTS (
                    SELECT 1 FROM core.core_places AS p
                    WHERE p.id = spi.target_id
                      AND p.deleted_at IS NULL
                      AND p.point_geom IS NOT NULL
                      AND ST_IsValid(p.point_geom)
                      AND ST_SRID(p.point_geom) = 4326
                      AND p.source_refs->>'review_candidate_id' IS NOT NULL
                      AND p.source_refs->>'publish_batch_id' IS NOT NULL
                      AND EXISTS (
                          SELECT 1 FROM core.core_place_names AS pn
                          WHERE pn.place_id = p.id
                      )
                )
            `;
        case "landuse":
            return Prisma.sql`
                spi.entity_family = 'landuse'
                AND EXISTS (
                    SELECT 1 FROM core.core_map_landuse AS c
                    WHERE c.id = spi.target_id
                      AND coalesce(c.is_active, true)
                      AND c.geom IS NOT NULL
                      AND ST_IsValid(c.geom)
                      AND ST_SRID(c.geom) = 4326
                      AND c.source_refs->>'review_candidate_id' IS NOT NULL
                      AND c.source_refs->>'publish_batch_id' IS NOT NULL
                )
            `;
        case "water_lines":
            return Prisma.sql`
                spi.entity_family = 'water_lines'
                AND EXISTS (
                    SELECT 1 FROM core.core_map_water_lines AS c
                    WHERE c.id = spi.target_id
                      AND coalesce(c.is_active, true)
                      AND c.geom IS NOT NULL
                      AND ST_IsValid(c.geom)
                      AND ST_SRID(c.geom) = 4326
                      AND c.source_refs->>'review_candidate_id' IS NOT NULL
                      AND c.source_refs->>'publish_batch_id' IS NOT NULL
                )
            `;
        case "water_polygons":
            return Prisma.sql`
                spi.entity_family = 'water_polygons'
                AND EXISTS (
                    SELECT 1 FROM core.core_map_water_polygons AS c
                    WHERE c.id = spi.target_id
                      AND coalesce(c.is_active, true)
                      AND c.geom IS NOT NULL
                      AND ST_IsValid(c.geom)
                      AND ST_SRID(c.geom) = 4326
                      AND c.source_refs->>'review_candidate_id' IS NOT NULL
                      AND c.source_refs->>'publish_batch_id' IS NOT NULL
                )
            `;
        case "bus_stops":
            return Prisma.sql`
                spi.entity_family = 'bus_stops'
                AND EXISTS (
                    SELECT 1 FROM core.core_bus_stops AS s
                    WHERE s.id = spi.target_id
                      AND coalesce(s.is_active, true)
                      AND s.geom IS NOT NULL
                      AND ST_IsValid(s.geom)
                      AND ST_SRID(s.geom) = 4326
                      AND ST_GeometryType(s.geom) = 'ST_Point'
                      AND s.source_refs->>'review_candidate_id' IS NOT NULL
                      AND s.source_refs->>'publish_batch_id' IS NOT NULL
                )
            `;
        case "roads":
            return Prisma.sql`
                spi.entity_family = 'roads'
                AND EXISTS (
                    SELECT 1 FROM core.core_streets AS s
                    WHERE s.id = spi.target_id
                      AND coalesce(s.is_active, true)
                      AND s.deleted_at IS NULL
                      AND s.geom IS NOT NULL
                      AND ST_IsValid(s.geom)
                      AND ST_SRID(s.geom) = 4326
                      AND upper(ST_GeometryType(s.geom)) = 'ST_LINESTRING'
                      AND s.source_refs->>'review_candidate_id' IS NOT NULL
                      AND s.source_refs->>'publish_batch_id' IS NOT NULL
                      AND s.source_refs->>'road_dry_run_status' IS NOT NULL
                )
            `;
        default:
            return Prisma.sql`false`;
    }
}

/** Bus stop candidate has a real display name distinct from stop_code (optional QA in verifyCoreRows). */
export function busStopCandidateMissingCoreNamesSql(bsAlias: string, coreAlias: string): Prisma.Sql {
    const bs = Prisma.raw(bsAlias);
    const core = Prisma.raw(coreAlias);
    return Prisma.sql`
        ${bs}.id IS NOT NULL
        AND ${busStopPrimaryRealNameExpr(bsAlias)} IS NOT NULL
        AND ${busStopPrimaryRealNameExpr(bsAlias)} <> coalesce(${busStopStopCodeExpr(bsAlias)}, '')
        AND NOT EXISTS (
            SELECT 1 FROM core.core_bus_stop_names AS n
            WHERE n.stop_id = ${core}.id
        )
    `;
}

export const CORE_VERIFICATION_ENTITY_FAMILIES = [
    "buildings",
    "places",
    "landuse",
    "water_lines",
    "water_polygons",
    "bus_stops",
    "roads",
] as const;

export function coreVerificationExistsUnionSql(): Prisma.Sql {
    return Prisma.join(
        CORE_VERIFICATION_ENTITY_FAMILIES.map((family) =>
            Prisma.sql`(${coreVerificationExistsSql(family)})`
        ),
        " OR "
    );
}
