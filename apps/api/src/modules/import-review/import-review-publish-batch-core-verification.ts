import { Prisma } from "@prisma/client";

/** EXISTS clause: successful publish item has a verified core row for the entity family. */
export function coreVerificationExistsSql(entityFamily: string): Prisma.Sql {
    switch (entityFamily) {
        case "buildings":
            return Prisma.sql`
                spi.entity_family = 'buildings'
                AND EXISTS (
                    SELECT 1 FROM core.core_buildings AS c
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
        case "land_areas":
            return Prisma.sql`
                spi.entity_family IN ('land_areas', 'landuse')
                AND EXISTS (
                    SELECT 1 FROM core.core_land_areas AS c
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
                    SELECT 1 FROM core.core_water_lines AS c
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
                    SELECT 1 FROM core.core_water_polygons AS c
                    WHERE c.id = spi.target_id
                      AND coalesce(c.is_active, true)
                      AND c.geom IS NOT NULL
                      AND ST_IsValid(c.geom)
                      AND ST_SRID(c.geom) = 4326
                      AND c.source_refs->>'review_candidate_id' IS NOT NULL
                      AND c.source_refs->>'publish_batch_id' IS NOT NULL
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
        case "admin_areas":
            return Prisma.sql`
                spi.entity_family = 'admin_areas'
                AND EXISTS (
                    SELECT 1 FROM core.core_admin_areas AS a
                    WHERE a.id = spi.target_id
                      AND coalesce(a.is_active, true)
                      AND a.deleted_at IS NULL
                      AND a.geom IS NOT NULL
                      AND ST_IsValid(a.geom)
                      AND ST_SRID(a.geom) = 4326
                      AND ST_GeometryType(a.geom) = 'ST_MultiPolygon'
                      AND a.centroid IS NOT NULL
                      AND ST_IsValid(a.centroid)
                      AND ST_SRID(a.centroid) = 4326
                      AND a.admin_level_id IS NOT NULL
                      AND nullif(trim(a.canonical_name), '') IS NOT NULL
                      AND nullif(trim(a.slug), '') IS NOT NULL
                      AND a.source_refs->>'review_candidate_id' IS NOT NULL
                      AND a.source_refs->>'publish_batch_id' IS NOT NULL
                      AND EXISTS (
                          SELECT 1 FROM core.core_admin_area_names AS n
                          WHERE n.admin_area_id = a.id
                      )
                )
            `;
        case "routing_barriers":
            return Prisma.sql`
                spi.entity_family = 'routing_barriers'
                AND EXISTS (
                    SELECT 1 FROM routing.routing_barriers AS rb
                    WHERE rb.id = spi.target_id
                      AND coalesce(rb.is_active, true)
                      AND rb.geom IS NOT NULL
                      AND ST_IsValid(rb.geom)
                      AND ST_SRID(rb.geom) = 4326
                      AND ST_GeometryType(rb.geom) = 'ST_Point'
                      AND rb.source_refs->>'review_candidate_id' IS NOT NULL
                      AND rb.source_refs->>'publish_batch_id' IS NOT NULL
                      AND rb.normalized_data ? 'routing_barrier_dry_run'
                )
            `;
        default:
            return Prisma.sql`false`;
    }
}

export const CORE_VERIFICATION_ENTITY_FAMILIES = [
    "buildings",
    "places",
    "land_areas",
    "water_lines",
    "water_polygons",
    "roads",
    "admin_areas",
    "routing_barriers",
] as const;

export function coreVerificationExistsUnionSql(): Prisma.Sql {
    return Prisma.join(
        CORE_VERIFICATION_ENTITY_FAMILIES.map((family) =>
            Prisma.sql`(${coreVerificationExistsSql(family)})`
        ),
        " OR "
    );
}
