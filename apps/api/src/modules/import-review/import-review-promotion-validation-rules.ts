import { Prisma, type PrismaClient } from "@prisma/client";

import {
    ImportReviewCandidateColumnRegistry,
    effectiveAdminAreaIdExpr,
    landuseClassCodeEffectiveExpr,
    landuseClassIdExpr,
    landuseEffectiveClassIdRawExpr,
} from "./import-review-candidate-column-registry.js";
import {
    ImportReviewSchemaCapabilityRegistry,
    type ImportReviewEntityColumnCapabilities,
    type ImportReviewTargetColumnCapabilities,
} from "./import-review-schema-capabilities.js";
import {
    busStopEffectiveAdminAreaIdRawExpr,
    busStopNameLocalExpr,
    busStopPrimaryRealNameExpr,
    busStopStopCodeExpr,
} from "./import-review-effective-values.js";
import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import { getImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import {
    assertPoiCategoriesTableExists,
    placeClassCodeExpr,
    placeExplicitCategoryIdExpr,
    placeResolvedCategoryIdExpr,
} from "./import-review-promotion-place-category.js";
import type {
    ImportReviewPublishItemValidationStageKey,
    ImportReviewPublishValidationIssueRow,
} from "./import-review-promotion-validation.types.js";

export const MIN_AREA_M2 = 1;
export const MAX_AREA_M2 = 500_000;
export const MAX_LANDUSE_AREA_M2 = 50_000_000;
export const SPATIAL_OVERLAP_RATIO = 0.85;
export const SPATIAL_DWITHIN_M = 2;
export const NEARBY_NAME_DWITHIN_M = 50;
export const NEAR_ROAD_DWITHIN_M = 30;

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

function activeCoreRowSql(alias: string): Prisma.Sql {
    return Prisma.sql`
        coalesce(${col(alias, "is_active")}, true)
        AND ${col(alias, "deleted_at")} IS NULL
    `;
}

function activeCorePlaceRowSql(alias: string): Prisma.Sql {
    return Prisma.sql`${col(alias, "deleted_at")} IS NULL`;
}

function activeCoreRowForFamily(entityFamily: string, alias: string): Prisma.Sql {
    if (entityFamily === "places") {
        return activeCorePlaceRowSql(alias);
    }
    if (entityFamily === "bus_stops") {
        return Prisma.sql`coalesce(${col(alias, "is_active")}, true)`;
    }
    return activeCoreRowSql(alias);
}

function hasValidationErrorsSql(alias: string): Prisma.Sql {
    const errors = col(alias, "validation_errors");
    return Prisma.sql`(
        ${errors} IS NOT NULL
        AND jsonb_typeof(${errors}) = 'array'
        AND jsonb_array_length(${errors}) > 0
    )`;
}

function itemsJoinSql(config: ImportReviewPublishFamilyConfig): Prisma.Sql {
    const a = config.tableAlias;
    return Prisma.sql`
        FROM system.system_publish_items AS spi
        LEFT JOIN ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
            ON ${col(a, "id")} = spi.review_candidate_id
           AND spi.review_candidate_table = ${config.candidateTable}
    `;
}

function lineageExpr(alias: string): Prisma.Sql {
    return Prisma.sql`(
        (${col(alias, "external_id")} IS NOT NULL AND trim(${col(alias, "external_id")}) <> '')
        OR ${col(alias, "local_staging_id")} IS NOT NULL
        OR (
            jsonb_typeof(${col(alias, "source_refs")}) = 'object'
            AND ${col(alias, "source_refs")} <> '{}'::jsonb
        )
    )`;
}

function optionalColumnExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: string,
    typeSql: string
): Prisma.Sql {
    if (!caps.hasColumn(column)) {
        return Prisma.raw(`NULL::${typeSql}`);
    }
    return col(alias, column);
}

function optionalJsonTextExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    jsonColumn: "review_overrides" | "normalized_data" | "source_refs",
    key: string
): Prisma.Sql {
    if (!caps.hasColumn(jsonColumn)) {
        return Prisma.sql`NULL::text`;
    }
    return Prisma.sql`${col(alias, jsonColumn)}->>${key}`;
}

function adminAreaTextExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: "canonical_name" | "slug" | "external_id" | "class_code"
): Prisma.Sql {
    const sourceColumn = optionalColumnExpr(alias, caps, column, "text");
    return Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "review_overrides", column)},
            ${sourceColumn},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", column)},
            ''
        )), '')
    `;
}

function adminAreaNameExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    const canonical = optionalColumnExpr(alias, caps, "canonical_name", "text");
    return Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "review_overrides", "name")},
            ${optionalJsonTextExpr(alias, caps, "review_overrides", "canonical_name")},
            ${canonical},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "canonical_name")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "name")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "name:my")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "name:en")},
            ''
        )), '')
    `;
}

function busRouteTextExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: "route_code" | "public_name" | "operator_name" | "route_type" | "directionality" | "canonical_name" | "external_id"
): Prisma.Sql {
    const sourceColumn = optionalColumnExpr(alias, caps, column, "text");
    return Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "review_overrides", column)},
            ${sourceColumn},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", column)},
            ''
        )), '')
    `;
}

function busRoutePublicNameExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "review_overrides", "name")},
            ${optionalJsonTextExpr(alias, caps, "review_overrides", "public_name")},
            ${optionalColumnExpr(alias, caps, "public_name", "text")},
            ${optionalColumnExpr(alias, caps, "canonical_name", "text")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "public_name")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "name")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "name:my")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "name:en")},
            ''
        )), '')
    `;
}

function busRouteRouteCodeExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "review_overrides", "route_code")},
            ${optionalColumnExpr(alias, caps, "route_code", "text")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "route_code")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "ref")},
            ''
        )), '')
    `;
}

function busRouteVariantTextExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column:
        | "route_code"
        | "variant_code"
        | "direction_name"
        | "origin_name"
        | "destination_name"
        | "external_id"
        | "canonical_name"
): Prisma.Sql {
    return Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "review_overrides", column)},
            ${optionalColumnExpr(alias, caps, column, "text")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", column)},
            ''
        )), '')
    `;
}

function busRouteVariantRouteCodeExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "review_overrides", "route_code")},
            ${optionalColumnExpr(alias, caps, "route_code", "text")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "route_code")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "ref")},
            ${optionalJsonTextExpr(alias, caps, "source_refs", "route_code")},
            ''
        )), '')
    `;
}

function busRouteVariantVariantCodeExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "review_overrides", "variant_code")},
            ${optionalColumnExpr(alias, caps, "variant_code", "text")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "variant_code")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "direction")},
            ''
        )), '')
    `;
}

function busRouteVariantRouteIdRawExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`
        coalesce(
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "review_overrides", "route_id")} ~ '^[0-9]+$'
                THEN ${optionalJsonTextExpr(alias, caps, "review_overrides", "route_id")}::bigint END,
            ${optionalColumnExpr(alias, caps, "route_id", "bigint")},
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "normalized_data", "route_id")} ~ '^[0-9]+$'
                THEN ${optionalJsonTextExpr(alias, caps, "normalized_data", "route_id")}::bigint END,
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "source_refs", "route_id")} ~ '^[0-9]+$'
                THEN ${optionalJsonTextExpr(alias, caps, "source_refs", "route_id")}::bigint END
        )
    `;
}

function busRouteVariantResolvedRouteIdExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    publishItemAlias = "spi"
): Prisma.Sql {
    const routeIdRaw = busRouteVariantRouteIdRawExpr(alias, caps);
    const routeCode = busRouteVariantRouteCodeExpr(alias, caps);
    const externalRouteRef = Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "review_overrides", "route_external_id")},
            ${optionalJsonTextExpr(alias, caps, "source_refs", "route_external_id")},
            ${optionalJsonTextExpr(alias, caps, "source_refs", "bus_route_external_id")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "route_external_id")},
            ''
        )), '')
    `;
    return Prisma.sql`
        coalesce(
            (
                SELECT br.id
                FROM core.core_bus_routes AS br
                WHERE br.id = ${routeIdRaw}
                  AND coalesce(br.is_active, true)
                  AND br.deleted_at IS NULL
                LIMIT 1
            ),
            (
                SELECT coalesce(route_item.target_id, route_candidate.promoted_core_id, route_candidate.matched_core_id)
                FROM system.system_publish_items AS route_item
                INNER JOIN import_review.bus_route_candidates AS route_candidate
                    ON route_candidate.id = route_item.review_candidate_id
                   AND route_item.review_candidate_table = 'import_review.bus_route_candidates'
                WHERE route_item.publish_batch_id = ${Prisma.raw(publishItemAlias)}.publish_batch_id
                  AND route_item.entity_family = 'bus_routes'
                  AND coalesce(route_item.publish_status, '') IN ('success', 'pending')
                  AND coalesce(route_item.target_id, route_candidate.promoted_core_id, route_candidate.matched_core_id) IS NOT NULL
                  AND (
                      (${routeCode} IS NOT NULL AND route_candidate.route_code = ${routeCode})
                      OR (
                          ${optionalJsonTextExpr(alias, caps, "source_refs", "route_local_staging_id")} ~ '^[0-9]+$'
                          AND route_candidate.local_staging_id = ${optionalJsonTextExpr(alias, caps, "source_refs", "route_local_staging_id")}::bigint
                      )
                  )
                LIMIT 1
            ),
            (
                SELECT br.id
                FROM core.core_bus_routes AS br
                WHERE coalesce(br.is_active, true)
                  AND br.deleted_at IS NULL
                  AND (
                      (${routeCode} IS NOT NULL AND br.route_code = ${routeCode})
                      OR (${externalRouteRef} IS NOT NULL AND br.external_id = ${externalRouteRef})
                  )
                ORDER BY br.id
                LIMIT 1
            )
        )
    `;
}

function busRouteStopBigintRawExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: "route_variant_id" | "stop_id"
): Prisma.Sql {
    return Prisma.sql`
        coalesce(
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "review_overrides", column)} ~ '^[0-9]+$'
                THEN ${optionalJsonTextExpr(alias, caps, "review_overrides", column)}::bigint END,
            ${optionalColumnExpr(alias, caps, column, "bigint")},
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "normalized_data", column)} ~ '^[0-9]+$'
                THEN ${optionalJsonTextExpr(alias, caps, "normalized_data", column)}::bigint END,
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "source_refs", column)} ~ '^[0-9]+$'
                THEN ${optionalJsonTextExpr(alias, caps, "source_refs", column)}::bigint END
        )
    `;
}

function busRouteStopIntExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: "stop_sequence"
): Prisma.Sql {
    return Prisma.sql`
        coalesce(
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "review_overrides", column)} ~ '^[0-9]+$'
                THEN ${optionalJsonTextExpr(alias, caps, "review_overrides", column)}::integer END,
            ${optionalColumnExpr(alias, caps, column, "integer")},
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "normalized_data", column)} ~ '^[0-9]+$'
                THEN ${optionalJsonTextExpr(alias, caps, "normalized_data", column)}::integer END
        )
    `;
}

function busRouteStopDistanceExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`
        coalesce(
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "review_overrides", "distance_from_start_m")} ~ '^[0-9]+(\\.[0-9]+)?$'
                THEN ${optionalJsonTextExpr(alias, caps, "review_overrides", "distance_from_start_m")}::numeric END,
            ${optionalColumnExpr(alias, caps, "distance_from_start_m", "numeric")},
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "normalized_data", "distance_from_start_m")} ~ '^[0-9]+(\\.[0-9]+)?$'
                THEN ${optionalJsonTextExpr(alias, caps, "normalized_data", "distance_from_start_m")}::numeric END
        )
    `;
}

function busRouteStopResolvedVariantIdExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    publishItemAlias = "spi"
): Prisma.Sql {
    const rawVariantId = busRouteStopBigintRawExpr(alias, caps, "route_variant_id");
    const externalVariantRef = Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "source_refs", "route_variant_external_id")},
            ${optionalJsonTextExpr(alias, caps, "source_refs", "variant_external_id")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "route_variant_external_id")},
            ''
        )), '')
    `;
    const variantCode = Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "source_refs", "variant_code")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "variant_code")},
            ''
        )), '')
    `;
    return Prisma.sql`
        coalesce(
            (
                SELECT v.id
                FROM core.core_bus_route_variants AS v
                WHERE v.id = ${rawVariantId}
                  AND coalesce(v.is_active, true)
                  AND v.deleted_at IS NULL
                LIMIT 1
            ),
            (
                SELECT coalesce(variant_item.target_id, variant_candidate.promoted_core_id, variant_candidate.matched_core_id)
                FROM system.system_publish_items AS variant_item
                INNER JOIN import_review.bus_route_variant_candidates AS variant_candidate
                    ON variant_candidate.id = variant_item.review_candidate_id
                   AND variant_item.review_candidate_table = 'import_review.bus_route_variant_candidates'
                WHERE variant_item.publish_batch_id = ${Prisma.raw(publishItemAlias)}.publish_batch_id
                  AND variant_item.entity_family = 'bus_route_variants'
                  AND coalesce(variant_item.target_id, variant_candidate.promoted_core_id, variant_candidate.matched_core_id) IS NOT NULL
                  AND (
                      (${variantCode} IS NOT NULL AND variant_candidate.variant_code = ${variantCode})
                      OR (
                          ${optionalJsonTextExpr(alias, caps, "source_refs", "route_variant_local_staging_id")} ~ '^[0-9]+$'
                          AND variant_candidate.local_staging_id = ${optionalJsonTextExpr(alias, caps, "source_refs", "route_variant_local_staging_id")}::bigint
                      )
                  )
                LIMIT 1
            ),
            (
                SELECT v.id
                FROM core.core_bus_route_variants AS v
                WHERE coalesce(v.is_active, true)
                  AND v.deleted_at IS NULL
                  AND (
                      (${variantCode} IS NOT NULL AND v.variant_code = ${variantCode})
                      OR (${externalVariantRef} IS NOT NULL AND v.id::text = ${externalVariantRef})
                  )
                ORDER BY v.id
                LIMIT 1
            )
        )
    `;
}

function busRouteStopResolvedStopIdExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    publishItemAlias = "spi"
): Prisma.Sql {
    const rawStopId = busRouteStopBigintRawExpr(alias, caps, "stop_id");
    const externalStopRef = Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "source_refs", "stop_external_id")},
            ${optionalJsonTextExpr(alias, caps, "source_refs", "bus_stop_external_id")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "stop_external_id")},
            ''
        )), '')
    `;
    const stopCode = Prisma.sql`
        nullif(trim(coalesce(
            ${optionalJsonTextExpr(alias, caps, "source_refs", "stop_code")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "stop_code")},
            ''
        )), '')
    `;
    return Prisma.sql`
        coalesce(
            (
                SELECT s.id
                FROM core.core_bus_stops AS s
                WHERE s.id = ${rawStopId}
                  AND coalesce(s.is_active, true)
                  AND s.deleted_at IS NULL
                LIMIT 1
            ),
            (
                SELECT coalesce(stop_item.target_id, stop_candidate.promoted_core_id, stop_candidate.matched_core_id)
                FROM system.system_publish_items AS stop_item
                INNER JOIN import_review.bus_stop_candidates AS stop_candidate
                    ON stop_candidate.id = stop_item.review_candidate_id
                   AND stop_item.review_candidate_table = 'import_review.bus_stop_candidates'
                WHERE stop_item.publish_batch_id = ${Prisma.raw(publishItemAlias)}.publish_batch_id
                  AND stop_item.entity_family = 'bus_stops'
                  AND coalesce(stop_item.target_id, stop_candidate.promoted_core_id, stop_candidate.matched_core_id) IS NOT NULL
                  AND (
                      (${stopCode} IS NOT NULL AND stop_candidate.stop_code = ${stopCode})
                      OR (
                          ${optionalJsonTextExpr(alias, caps, "source_refs", "stop_local_staging_id")} ~ '^[0-9]+$'
                          AND stop_candidate.local_staging_id = ${optionalJsonTextExpr(alias, caps, "source_refs", "stop_local_staging_id")}::bigint
                      )
                  )
                LIMIT 1
            ),
            (
                SELECT s.id
                FROM core.core_bus_stops AS s
                WHERE coalesce(s.is_active, true)
                  AND s.deleted_at IS NULL
                  AND (
                      (${externalStopRef} IS NOT NULL AND s.external_id = ${externalStopRef})
                      OR (${stopCode} IS NOT NULL AND s.stop_code = ${stopCode})
                  )
                ORDER BY s.id
                LIMIT 1
            )
        )
    `;
}

function adminAreaBigintExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: "admin_level_id" | "parent_id"
): Prisma.Sql {
    const sourceColumn = optionalColumnExpr(alias, caps, column, "bigint");
    const numericExpr = Prisma.sql`
        coalesce(
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "review_overrides", column)} ~ '^[0-9]+$'
                THEN ${optionalJsonTextExpr(alias, caps, "review_overrides", column)}::bigint END,
            ${sourceColumn},
            CASE WHEN ${optionalJsonTextExpr(alias, caps, "normalized_data", column)} ~ '^[0-9]+$'
                THEN ${optionalJsonTextExpr(alias, caps, "normalized_data", column)}::bigint END
        )
    `;
    if (column !== "admin_level_id") {
        return numericExpr;
    }
    return Prisma.sql`
        coalesce(
            ${numericExpr},
            (
                SELECT al.id
                FROM ref.ref_admin_levels AS al
                WHERE al.code = lower(trim(coalesce(
                    ${optionalJsonTextExpr(alias, caps, "review_overrides", "admin_level_code")},
                    ${optionalJsonTextExpr(alias, caps, "normalized_data", "admin_level_code")},
                    ${optionalJsonTextExpr(alias, caps, "normalized_data", "admin_level")},
                    ${optionalJsonTextExpr(alias, caps, "review_overrides", "class_code")},
                    ${optionalColumnExpr(alias, caps, "class_code", "text")},
                    ${optionalJsonTextExpr(alias, caps, "normalized_data", "class_code")}
                )))
                LIMIT 1
            )
        )
    `;
}

function adminAreaSourceTypeIdExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`(
        SELECT st.id
        FROM ref.ref_source_types AS st
        WHERE st.code = coalesce(
            nullif(trim(${optionalJsonTextExpr(alias, caps, "review_overrides", "source_type_code")}), ''),
            nullif(trim(${optionalJsonTextExpr(alias, caps, "source_refs", "source_type_code")}), ''),
            nullif(trim(${optionalJsonTextExpr(alias, caps, "source_refs", "source")}), ''),
            nullif(trim(${optionalJsonTextExpr(alias, caps, "normalized_data", "source_type_code")}), ''),
            nullif(trim(${optionalJsonTextExpr(alias, caps, "normalized_data", "source")}), ''),
            'osm'
        )
        LIMIT 1
    )`;
}

function adminAreaGeomExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    const geomColumn = optionalColumnExpr(alias, caps, "geom", "geometry");
    if (!caps.hasReviewOverrides) {
        return geomColumn;
    }
    return Prisma.sql`
        CASE
            WHEN ${col(alias, "review_overrides")} ? 'geom'
                 AND ${col(alias, "review_overrides")}->'geom' IS NOT NULL
                 AND jsonb_typeof(${col(alias, "review_overrides")}->'geom') = 'object'
            THEN ST_SetSRID(ST_GeomFromGeoJSON(${col(alias, "review_overrides")}->'geom'), 4326)
            ELSE ${geomColumn}
        END
    `;
}

function adminAreaMultiPolygonExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    const geom = adminAreaGeomExpr(alias, caps);
    return Prisma.sql`
        CASE
            WHEN ${geom} IS NULL THEN NULL::geometry(MultiPolygon, 4326)
            WHEN ST_GeometryType(${geom}) = 'ST_Polygon' THEN ST_Multi(${geom})::geometry(MultiPolygon, 4326)
            WHEN ST_GeometryType(${geom}) = 'ST_MultiPolygon' THEN ${geom}::geometry(MultiPolygon, 4326)
            ELSE NULL::geometry(MultiPolygon, 4326)
        END
    `;
}

function adminAreaCentroidExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    const centroidColumn = optionalColumnExpr(alias, caps, "centroid", "geometry(Point,4326)");
    const geom = adminAreaMultiPolygonExpr(alias, caps);
    return Prisma.sql`
        coalesce(
            CASE WHEN ${centroidColumn} IS NOT NULL
                      AND ST_GeometryType(${centroidColumn}) = 'ST_Point'
                 THEN ${centroidColumn}::geometry(Point, 4326)
            END,
            CASE WHEN ${geom} IS NOT NULL THEN ST_PointOnSurface(${geom})::geometry(Point, 4326) END
        )
    `;
}

function missingTargetColumnIssueSql(
    itemIds: bigint[],
    code: string,
    message: string
): Prisma.Sql {
    if (itemIds.length === 0) {
        return Prisma.empty;
    }
    return Prisma.sql`
        SELECT spi.id AS publish_item_id, ${code}::text AS code, ${message}::text AS message, 'error'::text AS severity
        FROM system.system_publish_items AS spi
        WHERE spi.id IN (${Prisma.join(itemIds)})
    `;
}

export class ImportReviewPromotionValidationRules {
    private readonly columnRegistry: ImportReviewCandidateColumnRegistry;
    private readonly schemaRegistry: ImportReviewSchemaCapabilityRegistry;

    constructor(private readonly prisma: PrismaClient) {
        this.columnRegistry = new ImportReviewCandidateColumnRegistry(prisma);
        this.schemaRegistry = new ImportReviewSchemaCapabilityRegistry(prisma);
    }

    async validateStage(
        stage: ImportReviewPublishItemValidationStageKey,
        entityFamily: string,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        if (itemIds.length === 0) {
            return [];
        }
        const config = getImportReviewPublishFamilyConfig(entityFamily);
        if (!config) {
            return [];
        }
        switch (stage) {
            case "validate_candidate_state":
                return this.validateCandidateState(config, itemIds);
            case "validate_geometry":
                return this.validateGeometry(config, itemIds);
            case "validate_required_fields":
                return this.validateRequiredFields(config, itemIds);
            case "validate_references":
                if (entityFamily === "places") {
                    await assertPoiCategoriesTableExists(this.prisma);
                }
                return this.validateReferences(config, itemIds);
            case "validate_duplicates":
                return this.validateDuplicates(config, itemIds);
            case "validate_entity_specific_rules":
                return this.validateEntitySpecificRules(config, itemIds);
            default:
                return [];
        }
    }

    private async validateCandidateState(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity
            FROM (
                SELECT spi.id AS publish_item_id, 'missing_candidate'::text AS code,
                    'Candidate row not found for publish item.'::text AS message, 'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)}) AND ${col(a, "id")} IS NULL

                UNION ALL

                SELECT spi.id, 'review_not_approved',
                    'Candidate must have review_decision=approved and review_status=approved.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "id")} IS NOT NULL
                  AND (
                      ${col(a, "review_decision")} IS DISTINCT FROM 'approved'
                      OR ${col(a, "review_status")} IS DISTINCT FROM 'approved'
                  )

                UNION ALL

                SELECT spi.id, 'already_promoted', 'Candidate promotion_status must not be promoted.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)}) AND ${col(a, "promotion_status")} = 'promoted'

                UNION ALL

                SELECT spi.id, 'candidate_validation_errors',
                    'Candidate validation_errors must be empty.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)}) AND ${hasValidationErrorsSql(a)}

                UNION ALL

                SELECT spi.id, 'manual_protected',
                    'manual_protected or protect_manual candidates cannot be published.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND (
                      coalesce(${col(a, "match_status")}, '') = 'manual_protected'
                      OR coalesce(${col(a, "auto_action")}, '') = 'protect_manual'
                  )

                UNION ALL

                SELECT spi.id, 'unsupported_publish_action',
                    'publish_action skip or protect_manual is not allowed.', 'error'
                FROM system.system_publish_items AS spi
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action IN ('skip', 'protect_manual')

                UNION ALL

                SELECT spi.id, 'unsupported_merge_action',
                    'merge publish_action is not supported for promotion yet.', 'warning'
                FROM system.system_publish_items AS spi
                WHERE spi.id IN (${Prisma.join(itemIds)}) AND spi.publish_action = 'merge'
            ) AS issues
        `;
    }

    private async validateGeometry(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const family = config.entityFamily;
        if (family === "buildings" || family === "landuse" || family === "water_polygons") {
            return this.validatePolygonGeometry(config, itemIds, family === "buildings");
        }
        if (family === "water_lines") {
            return this.validateLineGeometry(config, itemIds);
        }
        if (family === "bus_route_variants") {
            return this.validateBusRouteVariantGeometry(config, itemIds);
        }
        if (family === "places") {
            return this.validatePlaceGeometry(config, itemIds);
        }
        if (family === "bus_stops") {
            return this.validatePointGeometry(config, itemIds, "geom", true);
        }
        if (family === "admin_areas") {
            return this.validateAdminAreaGeometry(config, itemIds);
        }
        if (family === "routing_barriers") {
            return this.validateRoutingBarrierGeometry(config, itemIds);
        }
        return [];
    }

    private async validateBusRouteVariantGeometry(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_route_variants");
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(config.coreTargetTable);
        const geom = optionalColumnExpr(a, caps, "geom", "geometry");
        const mergedGeom = Prisma.sql`
            CASE
                WHEN ${geom} IS NULL THEN NULL::geometry(LineString, 4326)
                WHEN ST_GeometryType(${geom}) = 'ST_LineString' THEN ${geom}::geometry(LineString, 4326)
                WHEN ST_GeometryType(${geom}) = 'ST_MultiLineString'
                     AND ST_GeometryType(ST_LineMerge(${geom})) = 'ST_LineString'
                    THEN ST_LineMerge(${geom})::geometry(LineString, 4326)
                ELSE NULL::geometry(LineString, 4326)
            END
        `;
        const missingGeomSeverity = targetCaps.isRequired("geom") ? "error" : "warning";
        const missingGeomColumn = !caps.hasGeom && targetCaps.isRequired("geom")
            ? Prisma.sql`
                SELECT spi.id AS publish_item_id, 'SCHEMA_MISSING_BUS_ROUTE_VARIANT_GEOM_COLUMN'::text AS code,
                    'Schema error: import_review.bus_route_variant_candidates has no geom column, but core.core_bus_route_variants.geom is required.'::text AS message,
                    'error'::text AS severity
                FROM system.system_publish_items AS spi
                WHERE spi.id IN (${Prisma.join(itemIds)})
                UNION ALL
            `
            : Prisma.empty;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                ${missingGeomColumn}
                SELECT spi.id AS publish_item_id, 'missing_geom'::text AS code,
                    'Bus route variant geometry is required by core.core_bus_route_variants.geom.'::text AS message,
                    ${missingGeomSeverity}::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${geom} IS NULL

                UNION ALL
                SELECT spi.id, 'invalid_geom', 'Bus route variant geometry must pass ST_IsValid.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${geom} IS NOT NULL
                  AND (NOT ST_IsValid(${geom}) OR ST_IsEmpty(${geom}))

                UNION ALL
                SELECT spi.id, 'invalid_srid', 'Bus route variant geometry SRID must be 4326.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${geom} IS NOT NULL
                  AND ST_SRID(${geom}) <> 4326

                UNION ALL
                SELECT spi.id, 'invalid_geom_type',
                    'Bus route variant geometry must be LineString or mergeable MultiLineString.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${geom} IS NOT NULL
                  AND ST_GeometryType(${geom}) NOT IN ('ST_LineString', 'ST_MultiLineString')

                UNION ALL
                SELECT spi.id, 'multipart_variant_not_mergeable',
                    'Bus route variant MultiLineString must merge to one LineString for core.core_bus_route_variants.geom.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${geom} IS NOT NULL
                  AND ST_GeometryType(${geom}) = 'ST_MultiLineString'
                  AND ${mergedGeom} IS NULL
            ) AS issues
        `;
    }

    private async validateRoutingBarrierGeometry(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("routing_barriers");
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(config.coreTargetTable);
        const g = optionalColumnExpr(a, caps, "point_geom", "geometry(Point,4326)");
        const includeMissingSourceGeomColumn = !caps.hasPointGeom && targetCaps.isRequired("geom");
        const missingSourceGeomColumn = includeMissingSourceGeomColumn
            ? Prisma.sql`
                SELECT spi.id AS publish_item_id, 'SCHEMA_MISSING_ROUTING_BARRIER_POINT_GEOM_COLUMN'::text AS code,
                    'Schema error: import_review.routing_barrier_candidates has no point_geom column, but routing.routing_barriers.geom is required.'::text AS message,
                    'error'::text AS severity
                FROM system.system_publish_items AS spi
                WHERE spi.id IN (${Prisma.join(itemIds)})
            `
            : Prisma.empty;
        const unionAfterSchema = includeMissingSourceGeomColumn ? Prisma.sql`UNION ALL` : Prisma.empty;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                ${missingSourceGeomColumn}
                ${unionAfterSchema}
                SELECT spi.id AS publish_item_id, 'missing_geom'::text AS code,
                    'Routing barrier point geometry is required by routing.routing_barriers.geom.'::text AS message,
                    'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${g} IS NULL

                UNION ALL
                SELECT spi.id, 'invalid_point_geom', 'Routing barrier point geometry must pass ST_IsValid.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${g} IS NOT NULL
                  AND (NOT ST_IsValid(${g}) OR ST_IsEmpty(${g}))

                UNION ALL
                SELECT spi.id, 'invalid_srid', 'Routing barrier point geometry SRID must be 4326.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${g} IS NOT NULL
                  AND ST_SRID(${g}) <> 4326

                UNION ALL
                SELECT spi.id, 'invalid_geom_type', 'Routing barrier geometry must be Point.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${g} IS NOT NULL
                  AND ST_GeometryType(${g}) <> 'ST_Point'
            ) AS issues
        `;
    }

    private async validateAdminAreaGeometry(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("admin_areas");
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(config.coreTargetTable);
        const geom = adminAreaGeomExpr(a, caps);
        const coreGeom = adminAreaMultiPolygonExpr(a, caps);
        const centroid = adminAreaCentroidExpr(a, caps);
        const missingGeomSeverity = targetCaps.isRequired("geom") ? "error" : "warning";
        const missingCentroidSeverity = targetCaps.isRequired("centroid") ? "warning" : "info";
        const includeMissingGeomColumn = !caps.hasGeom && targetCaps.isRequired("geom");
        const missingGeomColumn = includeMissingGeomColumn
            ? Prisma.sql`
                SELECT spi.id AS publish_item_id, 'SCHEMA_MISSING_ADMIN_AREA_GEOM_COLUMN'::text AS code,
                    'Schema error: import_review.admin_area_candidates has no geom column, but core.core_admin_areas.geom is required.'::text AS message,
                    'error'::text AS severity
                FROM system.system_publish_items AS spi
                WHERE spi.id IN (${Prisma.join(itemIds)})
            `
            : Prisma.empty;
        const unionAfterMissingGeomColumn = includeMissingGeomColumn ? Prisma.sql`UNION ALL` : Prisma.empty;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                ${missingGeomColumn}
                ${unionAfterMissingGeomColumn}
                SELECT spi.id AS publish_item_id, 'missing_geom'::text AS code,
                    'Admin area polygon geometry is required by core.core_admin_areas.geom.'::text AS message,
                    ${missingGeomSeverity}::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${geom} IS NULL

                UNION ALL
                SELECT spi.id, 'invalid_geom', 'Admin area geometry must pass ST_IsValid.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${geom} IS NOT NULL
                  AND (NOT ST_IsValid(${geom}) OR ST_IsEmpty(${geom}))

                UNION ALL
                SELECT spi.id, 'invalid_srid', 'Admin area geometry SRID must be 4326.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${geom} IS NOT NULL
                  AND ST_SRID(${geom}) <> 4326

                UNION ALL
                SELECT spi.id, 'invalid_geom_type',
                    'Admin area geometry must be Polygon or MultiPolygon.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${geom} IS NOT NULL
                  AND ST_GeometryType(${geom}) NOT IN ('ST_Polygon', 'ST_MultiPolygon')

                UNION ALL
                SELECT spi.id, 'missing_centroid',
                    'Centroid is missing on candidate; promotion will derive it from polygon geometry.', ${missingCentroidSeverity}::text
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${optionalColumnExpr(a, caps, "centroid", "geometry(Point,4326)")} IS NULL
                  AND ${coreGeom} IS NOT NULL
                  AND ${centroid} IS NOT NULL

                UNION ALL
                SELECT spi.id, 'centroid_outside_polygon',
                    'Centroid is outside the admin area polygon; promotion will use point-on-surface when needed.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${optionalColumnExpr(a, caps, "centroid", "geometry(Point,4326)")} IS NOT NULL
                  AND ${coreGeom} IS NOT NULL
                  AND NOT ST_Covers(${coreGeom}, ${optionalColumnExpr(a, caps, "centroid", "geometry(Point,4326)")})
            ) AS issues
        `;
    }

    private async validatePolygonGeometry(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[],
        requireCentroid: boolean
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const maxArea = config.entityFamily === "landuse" ? MAX_LANDUSE_AREA_M2 : MAX_AREA_M2;
        const useMakeValidFix = config.entityFamily === "landuse";
        const geomExpr = useMakeValidFix
            ? Prisma.sql`ST_MakeValid(${col(a, "geom")})`
            : col(a, "geom");
        const centroidClause = requireCentroid
            ? Prisma.sql`
                UNION ALL
                SELECT spi.id, 'missing_centroid',
                    'Centroid must exist on candidate or be derivable from geometry.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "geom")} IS NOT NULL
                  AND ${col(a, "centroid")} IS NULL
                  AND ST_Centroid(${col(a, "geom")}) IS NULL
            `
            : Prisma.empty;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'missing_geom'::text AS code,
                    'Polygon geometry (geom) is required.'::text AS message, 'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)}) AND ${col(a, "geom")} IS NULL

                UNION ALL
                SELECT spi.id, 'invalid_geom', 'Geometry must pass ST_IsValid.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "geom")} IS NOT NULL
                  AND (
                      NOT ST_IsValid(${geomExpr})
                      OR ST_IsEmpty(${geomExpr})
                  )

                UNION ALL
                SELECT spi.id, 'invalid_srid', 'Geometry SRID must be 4326.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "geom")} IS NOT NULL AND ST_SRID(${col(a, "geom")}) <> 4326

                UNION ALL
                SELECT spi.id, 'invalid_geom_type',
                    'Geometry must be Polygon, MultiPolygon, or polygonal GeometryCollection.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "geom")} IS NOT NULL
                  AND upper(GeometryType(${geomExpr})) NOT IN ('POLYGON', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION')

                UNION ALL
                SELECT spi.id, 'area_out_of_range',
                    ${`Geometry area must be between ${MIN_AREA_M2} m² and ${maxArea} m².`},
                    'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "geom")} IS NOT NULL
                  AND (
                      ST_Area(${geomExpr}::geography) < ${MIN_AREA_M2}
                      OR ST_Area(${geomExpr}::geography) > ${maxArea}
                  )
                ${centroidClause}
            ) AS issues
        `;
    }

    private async validateLineGeometry(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'missing_geom'::text AS code,
                    'Line geometry (geom) is required.'::text AS message, 'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)}) AND ${col(a, "geom")} IS NULL

                UNION ALL
                SELECT spi.id, 'invalid_geom', 'Geometry must pass ST_IsValid.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "geom")} IS NOT NULL AND NOT ST_IsValid(${col(a, "geom")})

                UNION ALL
                SELECT spi.id, 'invalid_srid', 'Geometry SRID must be 4326.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "geom")} IS NOT NULL AND ST_SRID(${col(a, "geom")}) <> 4326

                UNION ALL
                SELECT spi.id, 'invalid_geom_type',
                    'Geometry must be LineString or MultiLineString.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "geom")} IS NOT NULL
                  AND upper(GeometryType(${col(a, "geom")})) NOT IN ('LINESTRING', 'MULTILINESTRING')
            ) AS issues
        `;
    }

    private async validatePlaceGeometry(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'missing_point_geom'::text AS code,
                    'Place point_geom is required when no lat/lng fallback exists.'::text AS message,
                    'warning'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "point_geom")} IS NULL
                  AND (${col(a, "lat")} IS NULL OR ${col(a, "lng")} IS NULL)

                UNION ALL
                SELECT spi.id, 'invalid_point_geom', 'point_geom must pass ST_IsValid.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "point_geom")} IS NOT NULL
                  AND NOT ST_IsValid(${col(a, "point_geom")})

                UNION ALL
                SELECT spi.id, 'invalid_srid', 'point_geom SRID must be 4326.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "point_geom")} IS NOT NULL
                  AND ST_SRID(${col(a, "point_geom")}) <> 4326
            ) AS issues
        `;
    }

    private async validatePointGeometry(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[],
        geomCol: string,
        required: boolean
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const g = col(a, geomCol);
        const missingSeverity = required ? "error" : "warning";
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'missing_geom'::text AS code,
                    'Point geometry is required.'::text AS message, ${missingSeverity}::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)}) AND ${g} IS NULL

                UNION ALL
                SELECT spi.id, 'invalid_geom', 'Geometry must pass ST_IsValid.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)}) AND ${g} IS NOT NULL AND NOT ST_IsValid(${g})

                UNION ALL
                SELECT spi.id, 'invalid_srid', 'Geometry SRID must be 4326.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)}) AND ${g} IS NOT NULL AND ST_SRID(${g}) <> 4326

                UNION ALL
                SELECT spi.id, 'invalid_geom_type', 'Geometry must be Point.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${g} IS NOT NULL
                  AND upper(GeometryType(${g})) <> 'POINT'
            ) AS issues
        `;
    }

    private async validateRequiredFields(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const family = config.entityFamily;

        if (family === "admin_areas") {
            return this.validateAdminAreaRequiredFields(config, itemIds);
        }
        if (family === "bus_routes") {
            return this.validateBusRouteRequiredFields(config, itemIds);
        }
        if (family === "bus_route_variants") {
            return this.validateBusRouteVariantRequiredFields(config, itemIds);
        }
        if (family === "bus_route_stops") {
            return this.validateBusRouteStopRequiredFields(config, itemIds);
        }
        if (family === "routing_barriers") {
            return this.validateRoutingBarrierRequiredFields(config, itemIds);
        }

        const familySpecific =
            family === "buildings"
                ? Prisma.sql`
                    UNION ALL
                    SELECT spi.id, 'missing_building_type',
                        'class_code or building_type is recommended before promotion.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${col(a, "id")} IS NOT NULL
                      AND nullif(trim(coalesce(
                          ${col(a, "class_code")}, ${col(a, "building_type")},
                          ${col(a, "normalized_data")}->>'building_type', ''
                      )), '') IS NULL
                  `
                : family === "places"
                  ? Prisma.sql`
                    UNION ALL
                    SELECT spi.id, 'missing_place_name',
                        'primary_name, display_name, or canonical_name is required.', 'error'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${col(a, "id")} IS NOT NULL
                      AND nullif(trim(coalesce(
                          ${col(a, "primary_name")}, ${col(a, "display_name")},
                          ${col(a, "canonical_name")}, ${col(a, "normalized_data")}->>'name', ''
                      )), '') IS NULL
                  `
                  : family === "landuse"
                    ? Prisma.sql`
                    UNION ALL
                    SELECT spi.id, 'CLASS_CODE_MISSING',
                        'class_code is recommended for landuse features.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${col(a, "id")} IS NOT NULL
                      AND ${landuseClassCodeEffectiveExpr(a)} IS NULL
                  `
                    : family === "water_polygons" || family === "water_lines"
                      ? Prisma.sql`
                    UNION ALL
                    SELECT spi.id, 'missing_class_code',
                        'class_code is recommended for water features.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${col(a, "id")} IS NOT NULL
                      AND nullif(trim(coalesce(${col(a, "class_code")}, '')), '') IS NULL
                  `
                      : family === "bus_stops"
                        ? Prisma.sql`
                    UNION ALL
                    SELECT spi.id, 'missing_stop_identity',
                        'name or stop_code is recommended for bus stops.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${col(a, "id")} IS NOT NULL
                      AND ${busStopPrimaryRealNameExpr(a)} IS NULL
                      AND ${busStopStopCodeExpr(a)} IS NULL
                  `
                        : Prisma.empty;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'missing_lineage'::text AS code,
                    'external_id or local_staging_id or source_refs lineage is required.'::text AS message,
                    'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "id")} IS NOT NULL AND NOT (${lineageExpr(a)})

                UNION ALL
                SELECT spi.id, 'invalid_confidence',
                    'confidence_score must be between 0 and 100 when set.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "confidence_score")} IS NOT NULL
                  AND (${col(a, "confidence_score")} < 0 OR ${col(a, "confidence_score")} > 100)

                UNION ALL
                SELECT spi.id, 'empty_source_refs', 'source_refs must not be an empty object.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND (
                      ${col(a, "source_refs")} IS NULL
                      OR jsonb_typeof(${col(a, "source_refs")}) <> 'object'
                      OR ${col(a, "source_refs")} = '{}'::jsonb
                  )

                UNION ALL
                SELECT spi.id, 'empty_normalized_data', 'normalized_data must not be an empty object.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND (
                      ${col(a, "normalized_data")} IS NULL
                      OR jsonb_typeof(${col(a, "normalized_data")}) <> 'object'
                      OR ${col(a, "normalized_data")} = '{}'::jsonb
                  )
                ${familySpecific}
            ) AS issues
        `;
    }

    private async validateBusRouteRequiredFields(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_routes");
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(config.coreTargetTable);
        const routeCode = busRouteRouteCodeExpr(a, caps);
        const publicName = busRoutePublicNameExpr(a, caps);
        const sourceRefs = optionalColumnExpr(a, caps, "source_refs", "jsonb");
        const confidenceScore = optionalColumnExpr(a, caps, "confidence_score", "numeric");
        const requiredColumnChecks: Prisma.Sql[] = [];

        if (targetCaps.isRequired("route_code") && !caps.hasRouteCode && !caps.hasReviewOverrides && !caps.hasNormalizedData) {
            requiredColumnChecks.push(missingTargetColumnIssueSql(
                itemIds,
                "SCHEMA_MISSING_BUS_ROUTE_CODE_SOURCE",
                "Schema error: core.core_bus_routes.route_code is required, but no route_code source column or JSON source exists."
            ));
        }
        if (targetCaps.isRequired("public_name") && !caps.hasPublicName && !caps.hasCanonicalName && !caps.hasReviewOverrides && !caps.hasNormalizedData) {
            requiredColumnChecks.push(missingTargetColumnIssueSql(
                itemIds,
                "SCHEMA_MISSING_BUS_ROUTE_PUBLIC_NAME_SOURCE",
                "Schema error: core.core_bus_routes.public_name is required, but no public_name/canonical_name source column or JSON source exists."
            ));
        }
        if (targetCaps.isRequired("source_refs") && !caps.hasSourceRefs) {
            requiredColumnChecks.push(missingTargetColumnIssueSql(
                itemIds,
                "SCHEMA_MISSING_BUS_ROUTE_SOURCE_REFS",
                "Schema error: core.core_bus_routes.source_refs is required, but bus_route_candidates has no source_refs column."
            ));
        }

        const requiredColumnSql = requiredColumnChecks.length > 0
            ? Prisma.sql`${Prisma.join(requiredColumnChecks, " UNION ALL ")} UNION ALL`
            : Prisma.empty;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                ${requiredColumnSql}
                SELECT spi.id AS publish_item_id, 'empty_source_refs'::text AS code,
                    'source_refs must not be empty before bus route promotion.'::text AS message,
                    'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND (
                      ${sourceRefs} IS NULL
                      OR jsonb_typeof(${sourceRefs}) <> 'object'
                      OR ${sourceRefs} = '{}'::jsonb
                  )

                UNION ALL
                SELECT spi.id, 'invalid_confidence',
                    'confidence_score must be between 0 and 100 when set.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${confidenceScore} IS NOT NULL
                  AND (${confidenceScore} < 0 OR ${confidenceScore} > 100)

                UNION ALL
                SELECT spi.id, 'missing_route_code',
                    'route_code is required by core.core_bus_routes.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.isRequired("route_code")}
                  AND ${routeCode} IS NULL

                UNION ALL
                SELECT spi.id, 'missing_public_name',
                    'public_name is required by core.core_bus_routes.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.isRequired("public_name")}
                  AND ${publicName} IS NULL
            ) AS issues
        `;
    }

    private async validateBusRouteVariantRequiredFields(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_route_variants");
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(config.coreTargetTable);
        const routeId = busRouteVariantResolvedRouteIdExpr(a, caps);
        const rawRouteId = busRouteVariantRouteIdRawExpr(a, caps);
        const variantCode = busRouteVariantVariantCodeExpr(a, caps);
        const sourceRefs = optionalColumnExpr(a, caps, "source_refs", "jsonb");
        const confidenceScore = optionalColumnExpr(a, caps, "confidence_score", "numeric");
        const requiredColumnChecks: Prisma.Sql[] = [];

        if (targetCaps.isRequired("route_id") && !caps.hasRouteId && !caps.hasReviewOverrides && !caps.hasNormalizedData && !caps.hasSourceRefs) {
            requiredColumnChecks.push(missingTargetColumnIssueSql(
                itemIds,
                "SCHEMA_MISSING_BUS_ROUTE_VARIANT_ROUTE_SOURCE",
                "Schema error: core.core_bus_route_variants.route_id is required, but no route_id/route_code source column or JSON source exists."
            ));
        }
        if (targetCaps.isRequired("variant_code") && !caps.hasVariantCode && !caps.hasReviewOverrides && !caps.hasNormalizedData) {
            requiredColumnChecks.push(missingTargetColumnIssueSql(
                itemIds,
                "SCHEMA_MISSING_BUS_ROUTE_VARIANT_CODE_SOURCE",
                "Schema error: core.core_bus_route_variants.variant_code is required, but no variant_code source column or JSON source exists."
            ));
        }
        if (targetCaps.isRequired("geom") && !caps.hasGeom) {
            requiredColumnChecks.push(missingTargetColumnIssueSql(
                itemIds,
                "SCHEMA_MISSING_BUS_ROUTE_VARIANT_GEOM_SOURCE",
                "Schema error: core.core_bus_route_variants.geom is required, but bus_route_variant_candidates has no geom column."
            ));
        }
        if (!caps.hasSourceRefs) {
            requiredColumnChecks.push(missingTargetColumnIssueSql(
                itemIds,
                "SCHEMA_MISSING_BUS_ROUTE_VARIANT_SOURCE_REFS",
                "Schema error: bus_route_variant_candidates has no source_refs column."
            ));
        }

        const requiredColumnSql = requiredColumnChecks.length > 0
            ? Prisma.sql`${Prisma.join(requiredColumnChecks, " UNION ALL ")} UNION ALL`
            : Prisma.empty;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                ${requiredColumnSql}
                SELECT spi.id AS publish_item_id, 'DEPENDENCY_ROUTE_MISSING'::text AS code,
                    'Bus route variant requires an existing core bus route before promotion.'::text AS message,
                    'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${routeId} IS NULL

                UNION ALL
                SELECT spi.id, 'invalid_route_id',
                    'Explicit route_id does not reference an active core bus route.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${rawRouteId} IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM core.core_bus_routes AS br
                      WHERE br.id = ${rawRouteId}
                        AND coalesce(br.is_active, true)
                        AND br.deleted_at IS NULL
                  )

                UNION ALL
                SELECT spi.id, 'missing_variant_code',
                    'variant_code is required by core.core_bus_route_variants.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.isRequired("variant_code")}
                  AND ${variantCode} IS NULL

                UNION ALL
                SELECT spi.id, 'empty_source_refs',
                    'source_refs must not be empty before bus route variant promotion.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND (
                      ${sourceRefs} IS NULL
                      OR jsonb_typeof(${sourceRefs}) <> 'object'
                      OR ${sourceRefs} = '{}'::jsonb
                  )

                UNION ALL
                SELECT spi.id, 'invalid_confidence',
                    'confidence_score must be between 0 and 100 when set.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${confidenceScore} IS NOT NULL
                  AND (${confidenceScore} < 0 OR ${confidenceScore} > 100)
            ) AS issues
        `;
    }

    private async validateBusRouteStopRequiredFields(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_route_stops");
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(config.coreTargetTable);
        const rawVariantId = busRouteStopBigintRawExpr(a, caps, "route_variant_id");
        const rawStopId = busRouteStopBigintRawExpr(a, caps, "stop_id");
        const routeVariantId = busRouteStopResolvedVariantIdExpr(a, caps);
        const stopId = busRouteStopResolvedStopIdExpr(a, caps);
        const stopSequence = busRouteStopIntExpr(a, caps, "stop_sequence");
        const sourceRefs = optionalColumnExpr(a, caps, "source_refs", "jsonb");
        const confidenceScore = optionalColumnExpr(a, caps, "confidence_score", "numeric");
        const requiredColumnChecks: Prisma.Sql[] = [];

        if (targetCaps.isRequired("route_variant_id") && !caps.hasRouteVariantId && !caps.hasReviewOverrides && !caps.hasNormalizedData && !caps.hasSourceRefs) {
            requiredColumnChecks.push(missingTargetColumnIssueSql(
                itemIds,
                "SCHEMA_MISSING_BUS_ROUTE_STOP_VARIANT_SOURCE",
                "Schema error: core.core_bus_route_stops.route_variant_id is required, but no route_variant_id source column or JSON source exists."
            ));
        }
        if (targetCaps.isRequired("stop_id") && !caps.hasStopId && !caps.hasReviewOverrides && !caps.hasNormalizedData && !caps.hasSourceRefs) {
            requiredColumnChecks.push(missingTargetColumnIssueSql(
                itemIds,
                "SCHEMA_MISSING_BUS_ROUTE_STOP_STOP_SOURCE",
                "Schema error: core.core_bus_route_stops.stop_id is required, but no stop_id source column or JSON source exists."
            ));
        }
        if (targetCaps.isRequired("stop_sequence") && !caps.hasStopSequence && !caps.hasReviewOverrides && !caps.hasNormalizedData) {
            requiredColumnChecks.push(missingTargetColumnIssueSql(
                itemIds,
                "SCHEMA_MISSING_BUS_ROUTE_STOP_SEQUENCE_SOURCE",
                "Schema error: core.core_bus_route_stops.stop_sequence is required, but no stop_sequence source column or JSON source exists."
            ));
        }
        const requiredColumnSql = requiredColumnChecks.length > 0
            ? Prisma.sql`${Prisma.join(requiredColumnChecks, " UNION ALL ")} UNION ALL`
            : Prisma.empty;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                ${requiredColumnSql}
                SELECT spi.id AS publish_item_id, 'DEPENDENCY_VARIANT_MISSING'::text AS code,
                    'Bus route stop requires an existing core bus route variant before promotion.'::text AS message,
                    'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${routeVariantId} IS NULL

                UNION ALL
                SELECT spi.id, 'DEPENDENCY_STOP_MISSING',
                    'Bus route stop requires an existing core bus stop before promotion.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${stopId} IS NULL

                UNION ALL
                SELECT spi.id, 'invalid_route_variant_id',
                    'Explicit route_variant_id does not reference an active core bus route variant.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${rawVariantId} IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM core.core_bus_route_variants AS v
                      WHERE v.id = ${rawVariantId}
                        AND coalesce(v.is_active, true)
                        AND v.deleted_at IS NULL
                  )

                UNION ALL
                SELECT spi.id, 'invalid_stop_id',
                    'Explicit stop_id does not reference an active core bus stop.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${rawStopId} IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM core.core_bus_stops AS s
                      WHERE s.id = ${rawStopId}
                        AND coalesce(s.is_active, true)
                        AND s.deleted_at IS NULL
                  )

                UNION ALL
                SELECT spi.id, 'missing_stop_sequence',
                    'stop_sequence is required by core.core_bus_route_stops.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.isRequired("stop_sequence")}
                  AND ${stopSequence} IS NULL

                UNION ALL
                SELECT spi.id, 'invalid_stop_sequence',
                    'stop_sequence must be greater than 0.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${stopSequence} IS NOT NULL
                  AND ${stopSequence} <= 0

                UNION ALL
                SELECT spi.id, 'empty_source_refs',
                    'source_refs must not be empty before bus route-stop promotion.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND (
                      ${sourceRefs} IS NULL
                      OR jsonb_typeof(${sourceRefs}) <> 'object'
                      OR ${sourceRefs} = '{}'::jsonb
                  )

                UNION ALL
                SELECT spi.id, 'invalid_confidence',
                    'confidence_score must be between 0 and 100 when set.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${confidenceScore} IS NOT NULL
                  AND (${confidenceScore} < 0 OR ${confidenceScore} > 100)
            ) AS issues
        `;
    }

    private async validateRoutingBarrierRequiredFields(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("routing_barriers");
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(config.coreTargetTable);
        const targetMissing = !targetCaps.hasColumn("id");
        const barrierType = Prisma.sql`nullif(trim(coalesce(
            ${optionalColumnExpr(a, caps, "barrier_type", "text")},
            ${optionalJsonTextExpr(a, caps, "normalized_data", "barrier_type")},
            ${optionalJsonTextExpr(a, caps, "normalized_data", "barrier")},
            ${optionalColumnExpr(a, caps, "class_code", "text")},
            ''
        )), '')`;
        const targetMissingSql = targetMissing
            ? Prisma.sql`
                SELECT spi.id AS publish_item_id, 'SCHEMA_MISSING_ROUTING_BARRIERS_TARGET_TABLE'::text AS code,
                    'Schema error: routing.routing_barriers is missing. Apply the routing barriers migration before promotion.'::text AS message,
                    'error'::text AS severity
                FROM system.system_publish_items AS spi
                WHERE spi.id IN (${Prisma.join(itemIds)})
                UNION ALL
              `
            : Prisma.empty;
        const barrierTypeRequiredSql = targetCaps.isRequired("barrier_type")
            ? Prisma.sql`
                UNION ALL
                SELECT spi.id, 'missing_barrier_type',
                    'barrier_type is required by routing.routing_barriers.barrier_type.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${barrierType} IS NULL
              `
            : Prisma.sql`
                UNION ALL
                SELECT spi.id, 'missing_barrier_type',
                    'barrier_type is missing; routing impact will need review.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${barrierType} IS NULL
              `;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                ${targetMissingSql}
                SELECT spi.id AS publish_item_id, 'empty_source_refs'::text AS code,
                    'source_refs must be non-empty before routing barrier promotion.'::text AS message,
                    'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND (
                      ${optionalColumnExpr(a, caps, "source_refs", "jsonb")} IS NULL
                      OR ${optionalColumnExpr(a, caps, "source_refs", "jsonb")} = '{}'::jsonb
                  )
                ${barrierTypeRequiredSql}
            ) AS issues
        `;
    }

    private async validateAdminAreaRequiredFields(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("admin_areas");
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(config.coreTargetTable);
        const adminLevelId = adminAreaBigintExpr(a, caps, "admin_level_id");
        const canonicalName = adminAreaNameExpr(a, caps);
        const slug = adminAreaTextExpr(a, caps, "slug");
        const centroid = adminAreaCentroidExpr(a, caps);
        const sourceTypeId = adminAreaSourceTypeIdExpr(a, caps);
        const sourceRefs = optionalColumnExpr(a, caps, "source_refs", "jsonb");
        const normalizedData = optionalColumnExpr(a, caps, "normalized_data", "jsonb");
        const confidenceScore = optionalColumnExpr(a, caps, "confidence_score", "numeric");

        const requiredColumnChecks: Prisma.Sql[] = [];
        if (targetCaps.isRequired("admin_level_id") && !caps.hasAdminLevelId && !caps.hasReviewOverrides && !caps.hasNormalizedData) {
            requiredColumnChecks.push(
                missingTargetColumnIssueSql(
                    itemIds,
                    "SCHEMA_MISSING_ADMIN_LEVEL_SOURCE",
                    "Schema error: core.core_admin_areas.admin_level_id is required, but no admin_level_id source column or JSON source exists."
                )
            );
        }
        if (targetCaps.isRequired("canonical_name") && !caps.hasCanonicalName && !caps.hasReviewOverrides && !caps.hasNormalizedData) {
            requiredColumnChecks.push(
                missingTargetColumnIssueSql(
                    itemIds,
                    "SCHEMA_MISSING_CANONICAL_NAME_SOURCE",
                    "Schema error: core.core_admin_areas.canonical_name is required, but no canonical_name source column or JSON source exists."
                )
            );
        }
        if (targetCaps.isRequired("slug") && !caps.hasSlug && !caps.hasReviewOverrides && !caps.hasNormalizedData) {
            requiredColumnChecks.push(
                missingTargetColumnIssueSql(
                    itemIds,
                    "SCHEMA_MISSING_SLUG_SOURCE",
                    "Schema error: core.core_admin_areas.slug is required, but no slug source column or JSON source exists."
                )
            );
        }
        if (targetCaps.isRequired("source_refs") && !caps.hasSourceRefs) {
            requiredColumnChecks.push(
                missingTargetColumnIssueSql(
                    itemIds,
                    "SCHEMA_MISSING_SOURCE_REFS",
                    "Schema error: core.core_admin_areas.source_refs is required, but admin_area_candidates has no source_refs column."
                )
            );
        }
        if (targetCaps.isRequired("normalized_data") && !caps.hasNormalizedData) {
            requiredColumnChecks.push(
                missingTargetColumnIssueSql(
                    itemIds,
                    "SCHEMA_MISSING_NORMALIZED_DATA",
                    "Schema error: core.core_admin_areas.normalized_data is required, but admin_area_candidates has no normalized_data column."
                )
            );
        }

        const requiredColumnSql =
            requiredColumnChecks.length > 0
                ? Prisma.sql`${Prisma.join(requiredColumnChecks, " UNION ALL ")} UNION ALL`
                : Prisma.empty;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                ${requiredColumnSql}
                SELECT spi.id AS publish_item_id, 'missing_lineage'::text AS code,
                    'external_id or local_staging_id or source_refs lineage is required.'::text AS message,
                    'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "id")} IS NOT NULL
                  AND NOT (
                      (${optionalColumnExpr(a, caps, "external_id", "text")} IS NOT NULL AND trim(${optionalColumnExpr(a, caps, "external_id", "text")}) <> '')
                      OR ${optionalColumnExpr(a, caps, "local_staging_id", "bigint")} IS NOT NULL
                      OR (
                          jsonb_typeof(${sourceRefs}) = 'object'
                          AND ${sourceRefs} <> '{}'::jsonb
                      )
                  )

                UNION ALL
                SELECT spi.id, 'invalid_confidence',
                    'confidence_score must be between 0 and 100 when set.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${confidenceScore} IS NOT NULL
                  AND (${confidenceScore} < 0 OR ${confidenceScore} > 100)

                UNION ALL
                SELECT spi.id, 'empty_source_refs', 'source_refs must not be an empty object.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.hasSourceRefs}
                  AND (
                      ${sourceRefs} IS NULL
                      OR jsonb_typeof(${sourceRefs}) <> 'object'
                      OR ${sourceRefs} = '{}'::jsonb
                  )

                UNION ALL
                SELECT spi.id, 'empty_normalized_data', 'normalized_data must not be an empty object.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.hasNormalizedData}
                  AND (
                      ${normalizedData} IS NULL
                      OR jsonb_typeof(${normalizedData}) <> 'object'
                      OR ${normalizedData} = '{}'::jsonb
                  )

                UNION ALL
                SELECT spi.id, 'missing_admin_level_id',
                    'admin_level_id is required by core.core_admin_areas.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.isRequired("admin_level_id")}
                  AND ${adminLevelId} IS NULL

                UNION ALL
                SELECT spi.id, 'missing_canonical_name',
                    'canonical_name or real name is required by core.core_admin_areas.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.isRequired("canonical_name")}
                  AND ${canonicalName} IS NULL

                UNION ALL
                SELECT spi.id, 'missing_slug',
                    'slug is required by core.core_admin_areas.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.isRequired("slug")}
                  AND ${slug} IS NULL

                UNION ALL
                SELECT spi.id, 'missing_centroid',
                    'centroid is required by core.core_admin_areas and could not be derived from geom.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.isRequired("centroid")}
                  AND ${centroid} IS NULL

                UNION ALL
                SELECT spi.id, 'missing_source_type_id',
                    'source_type_id is required by core.core_admin_areas and could not be resolved.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.isRequired("source_type_id")}
                  AND ${sourceTypeId} IS NULL
            ) AS issues
        `;
    }

    private async validateReferences(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const family = config.entityFamily;
        const caps = await this.columnRegistry.getCapabilities(config.candidateTable);
        const adminExpr = effectiveAdminAreaIdExpr(a, { hasAdminAreaColumn: caps.hasAdminAreaIdColumn });

        if (family === "buildings") {
            const buildingTypeCheck = caps.hasBuildingTypeIdColumn
                ? Prisma.sql`
                    SELECT spi.id AS publish_item_id, 'INVALID_BUILDING_TYPE_ID'::text AS code,
                        'building_type_id does not exist in ref.ref_building_types.'::text AS message, 'error'::text AS severity
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${col(a, "building_type_id")} IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM ref.ref_building_types AS r
                          WHERE r.id = ${col(a, "building_type_id")}
                            AND r.is_active IS TRUE
                      )

                    UNION ALL
                  `
                : Prisma.empty;

            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    ${buildingTypeCheck}
                    SELECT spi.id AS publish_item_id, 'INVALID_ADMIN_AREA_ID'::text AS code,
                        'admin_area_id does not exist in core.core_admin_areas.'::text AS message, 'error'::text AS severity
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${adminExpr} IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_admin_areas AS ca
                          WHERE ca.id = ${adminExpr}
                            AND ca.is_active IS TRUE
                      )

                    UNION ALL
                    SELECT spi.id, 'ADMIN_AREA_MISSING',
                        'admin_area_id is not set; confirm admin assignment before promotion.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${adminExpr} IS NULL
                ) AS issues
            `;
        }

        if (family === "places") {
            const explicitCategoryId = placeExplicitCategoryIdExpr(a);
            const classCode = placeClassCodeExpr(a);
            const resolvedCategoryId = placeResolvedCategoryIdExpr(a);

            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    SELECT spi.id AS publish_item_id, 'INVALID_POI_CATEGORY_ID'::text AS code,
                        'category_id does not exist in ref.ref_poi_categories.'::text AS message, 'error'::text AS severity
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${explicitCategoryId} IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM ref.ref_poi_categories AS c WHERE c.id = ${explicitCategoryId}
                      )

                    UNION ALL
                    SELECT spi.id, 'CATEGORY_UNMAPPED'::text,
                        'class_code or category_code does not match any ref.ref_poi_categories.code.'::text,
                        'warning'::text AS severity
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${resolvedCategoryId} IS NULL
                      AND ${classCode} IS NOT NULL

                    UNION ALL
                    SELECT spi.id, 'CATEGORY_MISSING'::text,
                        'No category_id or mappable class_code; category is recommended for core.core_places.'::text,
                        'warning'::text AS severity
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${resolvedCategoryId} IS NULL
                      AND ${classCode} IS NULL

                    UNION ALL
                    SELECT spi.id, 'INVALID_ADMIN_AREA_ID',
                        'admin_area_id does not exist in core.core_admin_areas.', 'error'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${adminExpr} IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_admin_areas AS ca
                          WHERE ca.id = ${adminExpr}
                            AND coalesce(ca.is_active, true)
                      )

                    UNION ALL
                    SELECT spi.id, 'ADMIN_AREA_MISSING',
                        'admin_area_id is not set; confirm admin assignment before promotion.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${adminExpr} IS NULL
                ) AS issues
            `;
        }

        if (family === "bus_stops") {
            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    SELECT spi.id AS publish_item_id, 'INVALID_ADMIN_AREA_ID'::text AS code,
                        'admin_area_id does not exist in core.core_admin_areas.'::text AS message, 'error'::text AS severity
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${busStopEffectiveAdminAreaIdRawExpr(a)} IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_admin_areas AS ca
                          WHERE ca.id = ${busStopEffectiveAdminAreaIdRawExpr(a)}
                            AND ca.is_active IS TRUE
                      )

                    UNION ALL
                    SELECT spi.id, 'ADMIN_AREA_MISSING',
                        'admin_area_id is not set on the bus stop candidate.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${busStopEffectiveAdminAreaIdRawExpr(a)} IS NULL
                ) AS issues
            `;
        }

        if (family === "bus_route_stops") {
            const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_route_stops");
            const routeVariantId = busRouteStopResolvedVariantIdExpr(a, caps);
            const stopId = busRouteStopResolvedStopIdExpr(a, caps);
            const stopSequence = busRouteStopIntExpr(a, caps, "stop_sequence");
            const distance = busRouteStopDistanceExpr(a, caps);
            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    SELECT spi.id, 'distance_from_start_m_missing',
                        'distance_from_start_m is missing for this route stop.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${distance} IS NULL

                    UNION ALL
                    SELECT spi.id, 'distance_from_start_m_not_increasing',
                        'distance_from_start_m is lower than an earlier stop on the same variant.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${routeVariantId} IS NOT NULL
                      AND ${stopSequence} IS NOT NULL
                      AND ${distance} IS NOT NULL
                      AND EXISTS (
                          SELECT 1 FROM core.core_bus_route_stops AS prev
                          WHERE prev.route_variant_id = ${routeVariantId}
                            AND prev.stop_sequence < ${stopSequence}
                            AND prev.distance_from_start_m IS NOT NULL
                            AND prev.distance_from_start_m > ${distance}
                      )

                    UNION ALL
                    SELECT spi.id, 'stop_sequence_gap',
                        'stop_sequence leaves a gap from existing stops on this variant.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${routeVariantId} IS NOT NULL
                      AND ${stopSequence} IS NOT NULL
                      AND ${stopSequence} > 1
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_bus_route_stops AS prev
                          WHERE prev.route_variant_id = ${routeVariantId}
                            AND prev.stop_sequence = ${stopSequence} - 1
                      )

                    UNION ALL
                    SELECT spi.id, 'stop_point_far_from_variant_geometry',
                        'Resolved stop point is far from the route variant geometry.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${routeVariantId} IS NOT NULL
                      AND ${stopId} IS NOT NULL
                      AND EXISTS (
                          SELECT 1
                          FROM core.core_bus_route_variants AS v
                          INNER JOIN core.core_bus_stops AS s ON s.id = ${stopId}
                          WHERE v.id = ${routeVariantId}
                            AND v.geom IS NOT NULL
                            AND s.geom IS NOT NULL
                            AND NOT ST_DWithin(v.geom::geography, s.geom::geography, 100)
                      )

                    UNION ALL
                    SELECT spi.id, 'stop_duplicated_nearby',
                        'Another stop on this variant is very near the resolved stop.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${routeVariantId} IS NOT NULL
                      AND ${stopId} IS NOT NULL
                      AND EXISTS (
                          SELECT 1
                          FROM core.core_bus_route_stops AS rs
                          INNER JOIN core.core_bus_stops AS other_stop ON other_stop.id = rs.stop_id
                          INNER JOIN core.core_bus_stops AS this_stop ON this_stop.id = ${stopId}
                          WHERE rs.route_variant_id = ${routeVariantId}
                            AND rs.stop_id <> ${stopId}
                            AND other_stop.geom IS NOT NULL
                            AND this_stop.geom IS NOT NULL
                            AND ST_DWithin(other_stop.geom::geography, this_stop.geom::geography, 20)
                      )

                    UNION ALL
                    SELECT spi.id, 'route_variant_unverified',
                        'Resolved route variant exists but is not core-verified yet.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${routeVariantId} IS NOT NULL
                      AND EXISTS (
                          SELECT 1 FROM core.core_bus_route_variants AS v
                          WHERE v.id = ${routeVariantId}
                            AND (
                                coalesce(v.is_verified, false) IS FALSE
                                OR coalesce(v.verification_status, 'unverified') <> 'verified'
                            )
                      )

                    UNION ALL
                    SELECT spi.id, 'stop_unverified',
                        'Resolved bus stop exists but is not core-verified yet.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${stopId} IS NOT NULL
                      AND EXISTS (
                          SELECT 1 FROM core.core_bus_stops AS s
                          WHERE s.id = ${stopId}
                            AND (
                                coalesce(s.is_verified, false) IS FALSE
                                OR coalesce(s.verification_status, 'unverified') <> 'verified'
                            )
                      )
                ) AS issues
            `;
        }

        if (family === "bus_routes") {
            const routeCaps = await this.schemaRegistry.getEntityColumnCapabilities("bus_routes");
            const explicitSourceTypeCode = Prisma.sql`nullif(trim(coalesce(
                ${optionalJsonTextExpr(a, routeCaps, "review_overrides", "source_type_code")},
                ${optionalJsonTextExpr(a, routeCaps, "review_overrides", "source")},
                ${optionalJsonTextExpr(a, routeCaps, "source_refs", "source_type_code")},
                ${optionalJsonTextExpr(a, routeCaps, "source_refs", "source")},
                ${optionalJsonTextExpr(a, routeCaps, "normalized_data", "source_type_code")},
                ${optionalJsonTextExpr(a, routeCaps, "normalized_data", "source")},
                ''
            )), '')`;
            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    SELECT spi.id AS publish_item_id, 'INVALID_SOURCE_TYPE'::text AS code,
                        'Explicit source_type_code/source does not exist in ref.ref_source_types.'::text AS message,
                        'error'::text AS severity
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${explicitSourceTypeCode} IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM ref.ref_source_types AS st
                          WHERE st.code = ${explicitSourceTypeCode}
                      )
                ) AS issues
            `;
        }

        if (family === "admin_areas") {
            return this.validateAdminAreaReferences(config, itemIds);
        }

        if (family === "landuse") {
            const rawClassId = landuseEffectiveClassIdRawExpr(a, {
                hasLanduseClassIdColumn: caps.hasLanduseClassIdColumn,
            });
            const validClassId = landuseClassIdExpr(a, {
                hasLanduseClassIdColumn: caps.hasLanduseClassIdColumn,
            });
            const optionalColumnNotice = this.optionalAdminAreaColumnNoticeSql(
                config,
                itemIds,
                caps.hasAdminAreaIdColumn,
                "Landuse validation uses review_overrides/normalized_data for admin_area_id; landuse_candidates has no admin_area_id column. This reference is optional for landuse."
            );

            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    SELECT spi.id AS publish_item_id, 'INVALID_LANDUSE_CLASS_ID'::text AS code,
                        'landuse_class_id does not exist in ref.ref_landuse_classes.'::text AS message,
                        'error'::text AS severity
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${rawClassId} IS NOT NULL
                      AND ${validClassId} IS NULL

                    UNION ALL
                    SELECT spi.id, 'INVALID_ADMIN_AREA_ID',
                        'admin_area_id does not exist in core.core_admin_areas.', 'error'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${adminExpr} IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_admin_areas AS ca
                          WHERE ca.id = ${adminExpr}
                            AND coalesce(ca.is_active, true)
                      )

                    UNION ALL
                    SELECT spi.id, 'ADMIN_AREA_MISSING',
                        'admin_area_id is not set; confirm admin assignment before promotion.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${adminExpr} IS NULL
                    ${optionalColumnNotice}
                ) AS issues
            `;
        }

        if (family === "water_lines" || family === "water_polygons") {
            const entityLabel = family === "water_lines" ? "Water line" : "Water polygon";
            const optionalColumnNotice = this.optionalAdminAreaColumnNoticeSql(
                config,
                itemIds,
                caps.hasAdminAreaIdColumn,
                `${entityLabel} validation uses review_overrides/normalized_data for admin_area_id; ${config.candidateTable.split(".").pop()} has no admin_area_id column. This reference is optional.`
            );

            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    SELECT spi.id AS publish_item_id, 'INVALID_ADMIN_AREA_ID'::text AS code,
                        'admin_area_id does not exist in core.core_admin_areas.'::text AS message, 'error'::text AS severity
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${adminExpr} IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_admin_areas AS ca
                          WHERE ca.id = ${adminExpr}
                            AND coalesce(ca.is_active, true)
                      )

                    UNION ALL
                    SELECT spi.id, 'ADMIN_AREA_MISSING',
                        'admin_area_id is not set; confirm admin assignment before promotion.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${adminExpr} IS NULL
                    ${optionalColumnNotice}
                ) AS issues
            `;
        }

        return [];
    }

    private async validateAdminAreaReferences(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("admin_areas");
        const adminLevelId = adminAreaBigintExpr(a, caps, "admin_level_id");
        const parentId = adminAreaBigintExpr(a, caps, "parent_id");
        const sourceTypeId = adminAreaSourceTypeIdExpr(a, caps);
        const rawAdminLevelId = Prisma.sql`
            coalesce(
                CASE WHEN ${optionalJsonTextExpr(a, caps, "review_overrides", "admin_level_id")} ~ '^[0-9]+$'
                    THEN ${optionalJsonTextExpr(a, caps, "review_overrides", "admin_level_id")}::bigint END,
                ${optionalColumnExpr(a, caps, "admin_level_id", "bigint")},
                CASE WHEN ${optionalJsonTextExpr(a, caps, "normalized_data", "admin_level_id")} ~ '^[0-9]+$'
                    THEN ${optionalJsonTextExpr(a, caps, "normalized_data", "admin_level_id")}::bigint END
            )
        `;
        const explicitSourceTypeCode = Prisma.sql`
            nullif(trim(coalesce(
                ${optionalJsonTextExpr(a, caps, "review_overrides", "source_type_code")},
                ${optionalJsonTextExpr(a, caps, "source_refs", "source_type_code")},
                ${optionalJsonTextExpr(a, caps, "source_refs", "source")},
                ${optionalJsonTextExpr(a, caps, "normalized_data", "source_type_code")},
                ${optionalJsonTextExpr(a, caps, "normalized_data", "source")}
            )), '')
        `;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'INVALID_ADMIN_LEVEL_ID'::text AS code,
                    'admin_level_id does not exist in ref.ref_admin_levels.'::text AS message,
                    'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${rawAdminLevelId} IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM ref.ref_admin_levels AS al
                      WHERE al.id = ${rawAdminLevelId}
                  )

                UNION ALL
                SELECT spi.id, 'ADMIN_LEVEL_INFERRED',
                    'admin_level_id was inferred from class_code or normalized admin level code; confirm hierarchy before promotion.',
                    'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${rawAdminLevelId} IS NULL
                  AND ${adminLevelId} IS NOT NULL

                UNION ALL
                SELECT spi.id, 'INVALID_PARENT_ID',
                    'parent_id does not exist in active core.core_admin_areas.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${parentId} IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM core.core_admin_areas AS parent
                      WHERE parent.id = ${parentId}
                        AND coalesce(parent.is_active, true)
                        AND parent.deleted_at IS NULL
                  )

                UNION ALL
                SELECT spi.id, 'PARENT_ID_MISSING',
                    'parent_id is not set; confirm this admin area is top-level or intentionally parentless.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${parentId} IS NULL

                UNION ALL
                SELECT spi.id, 'INVALID_SOURCE_TYPE',
                    'Explicit source_type_code/source does not exist in ref.ref_source_types.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${explicitSourceTypeCode} IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM ref.ref_source_types AS st
                      WHERE st.code = ${explicitSourceTypeCode}
                  )

                UNION ALL
                SELECT spi.id, 'MISSING_SOURCE_TYPE_ID',
                    'source_type_id could not be resolved from source refs or osm fallback.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)}
                )
                  AND ${sourceTypeId} IS NULL
            ) AS issues
        `;
    }

    private optionalAdminAreaColumnNoticeSql(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[],
        hasAdminAreaIdColumn: boolean,
        message: string
    ): Prisma.Sql {
        if (itemIds.length === 0 || hasAdminAreaIdColumn) {
            return Prisma.empty;
        }
        const join = itemsJoinSql(config);
        return Prisma.sql`
            UNION ALL
            SELECT spi.id, 'OPTIONAL_COLUMN_NOT_AVAILABLE',
                ${message}, 'info'
            ${join}
            WHERE spi.id IN (${Prisma.join(itemIds)})
              AND spi.id = (SELECT min(v) FROM unnest(ARRAY[${Prisma.join(itemIds)}]::bigint[]) AS v)
        `;
    }

    private async validateDuplicates(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const family = config.entityFamily;
        if (family === "buildings") {
            return this.validateBuildingDuplicates(config, itemIds);
        }
        if (family === "places") {
            return this.validatePlaceDuplicates(config, itemIds);
        }
        if (family === "landuse") {
            return this.validateExternalIdDuplicate(config, itemIds, "core.core_map_landuse");
        }
        if (family === "water_polygons") {
            return this.validateExternalIdDuplicate(config, itemIds, "core.core_map_water_polygons");
        }
        if (family === "water_lines") {
            return this.validateExternalIdDuplicate(config, itemIds, "core.core_map_water_lines");
        }
        if (family === "bus_stops") {
            return this.validateBusStopDuplicates(config, itemIds);
        }
        if (family === "bus_routes") {
            return this.validateBusRouteDuplicates(config, itemIds);
        }
        if (family === "bus_route_variants") {
            return this.validateBusRouteVariantDuplicates(config, itemIds);
        }
        if (family === "bus_route_stops") {
            return this.validateBusRouteStopDuplicates(config, itemIds);
        }
        if (family === "admin_areas") {
            return this.validateAdminAreaDuplicates(config, itemIds);
        }
        return [];
    }

    private async validateBusRouteStopDuplicates(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_route_stops");
        const routeVariantId = busRouteStopResolvedVariantIdExpr(a, caps);
        const stopId = busRouteStopResolvedStopIdExpr(a, caps);
        const stopSequence = busRouteStopIntExpr(a, caps, "stop_sequence");

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'duplicate_stop_sequence'::text AS code,
                    'Another core bus route stop already uses this stop_sequence for the same variant.'::text AS message,
                    'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'insert'
                  AND ${routeVariantId} IS NOT NULL
                  AND ${stopSequence} IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_bus_route_stops AS rs
                      WHERE rs.route_variant_id = ${routeVariantId}
                        AND rs.stop_sequence = ${stopSequence}
                        AND (${stopId} IS NULL OR rs.stop_id <> ${stopId})
                  )

                UNION ALL
                SELECT spi.id, 'duplicate_stop_id_for_variant',
                    'This stop already exists on the resolved route variant.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'insert'
                  AND ${routeVariantId} IS NOT NULL
                  AND ${stopId} IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_bus_route_stops AS rs
                      WHERE rs.route_variant_id = ${routeVariantId}
                        AND rs.stop_id = ${stopId}
                        AND (${stopSequence} IS NULL OR rs.stop_sequence <> ${stopSequence})
                  )
            ) AS issues
        `;
    }

    private async validateBusRouteVariantDuplicates(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_route_variants");
        const routeId = busRouteVariantResolvedRouteIdExpr(a, caps);
        const variantCode = busRouteVariantVariantCodeExpr(a, caps);
        const matchedCoreId = optionalColumnExpr(a, caps, "matched_core_id", "bigint");

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'duplicate_variant_code_risk'::text AS code,
                    'Another active core bus route variant has this route_id and variant_code; review idempotent update target.', 'warning'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${routeId} IS NOT NULL
                  AND ${variantCode} IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_bus_route_variants AS v
                      WHERE v.route_id = ${routeId}
                        AND v.variant_code = ${variantCode}
                        AND coalesce(v.is_active, true)
                        AND v.deleted_at IS NULL
                        AND (${matchedCoreId} IS NULL OR v.id <> ${matchedCoreId})
                  )
            ) AS issues
        `;
    }

    private async validateBusRouteDuplicates(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_routes");
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(config.coreTargetTable);
        const routeCode = busRouteRouteCodeExpr(a, caps);
        const publicName = busRoutePublicNameExpr(a, caps);
        const matchedCoreId = optionalColumnExpr(a, caps, "matched_core_id", "bigint");

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'duplicate_route_code'::text AS code,
                    'Active core bus route already exists with this route_code.'::text AS message,
                    'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.hasRouteCode}
                  AND ${targetCaps.isUnique("route_code")}
                  AND spi.publish_action = 'insert'
                  AND ${routeCode} IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_bus_routes AS c
                      WHERE c.route_code = ${routeCode}
                        AND coalesce(c.is_active, true)
                        AND c.deleted_at IS NULL
                        AND (${matchedCoreId} IS NULL OR c.id <> ${matchedCoreId})
                  )

                UNION ALL
                SELECT spi.id, 'duplicate_public_name_risk',
                    'Another active core bus route has this public_name; review before promotion.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${publicName} IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_bus_routes AS c
                      WHERE lower(trim(c.public_name)) = lower(trim(${publicName}))
                        AND coalesce(c.is_active, true)
                        AND c.deleted_at IS NULL
                        AND (${matchedCoreId} IS NULL OR c.id <> ${matchedCoreId})
                  )
            ) AS issues
        `;
    }

    private async validateAdminAreaDuplicates(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("admin_areas");
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(config.coreTargetTable);
        const slug = adminAreaTextExpr(a, caps, "slug");
        const externalId = adminAreaTextExpr(a, caps, "external_id");

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'duplicate_slug'::text AS code,
                    'Active core admin area already exists with this slug.', 'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${targetCaps.hasSlug}
                  AND ${targetCaps.isUnique("slug")}
                  AND spi.publish_action = 'insert'
                  AND ${slug} IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_admin_areas AS c
                      WHERE c.slug = ${slug}
                        AND coalesce(c.is_active, true)
                        AND c.deleted_at IS NULL
                  )

                UNION ALL
                SELECT spi.id, 'external_id_duplicate_risk',
                    'Another active core admin area has this external_id; review before promotion.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${externalId} IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_admin_areas AS c
                      WHERE c.external_id = ${externalId}
                        AND coalesce(c.is_active, true)
                        AND c.deleted_at IS NULL
                        AND (${optionalColumnExpr(a, caps, "matched_core_id", "bigint")} IS NULL OR c.id <> ${optionalColumnExpr(a, caps, "matched_core_id", "bigint")})
                  )
            ) AS issues
        `;
    }

    private async validateBuildingDuplicates(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'duplicate_external_id'::text AS code,
                    'Active core building already exists with the same external_id.'::text AS message, 'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'insert'
                  AND ${col(a, "external_id")} IS NOT NULL AND trim(${col(a, "external_id")}) <> ''
                  AND EXISTS (
                      SELECT 1 FROM core.core_map_buildings AS c
                      WHERE c.external_id = ${col(a, "external_id")} AND ${activeCoreRowSql("c")}
                  )

                UNION ALL
                SELECT spi.id, 'duplicate_source_staging_id',
                    'Active core building already exists with the same source_staging_id.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'insert'
                  AND ${col(a, "local_staging_id")} IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_map_buildings AS c
                      WHERE c.source_staging_id = ${col(a, "local_staging_id")} AND ${activeCoreRowSql("c")}
                  )

                UNION ALL
                SELECT spi.id, 'spatial_overlap_insert',
                    'High geometry overlap with an existing active core building.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'insert'
                  AND ${col(a, "geom")} IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_map_buildings AS c
                      WHERE ${activeCoreRowSql("c")} AND c.geom IS NOT NULL
                        AND c.geom && ${col(a, "geom")}
                        AND ST_DWithin(c.geom::geography, ${col(a, "geom")}::geography, ${SPATIAL_DWITHIN_M})
                        AND ST_Area(ST_Intersection(c.geom, ${col(a, "geom")})::geography)
                            / NULLIF(ST_Area(${col(a, "geom")}::geography), 0) > ${SPATIAL_OVERLAP_RATIO}
                  )

                UNION ALL
                SELECT spi.id, 'spatial_overlap_update_other',
                    'Update candidate overlaps another active core building.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'update'
                  AND ${col(a, "geom")} IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_map_buildings AS c
                      WHERE ${activeCoreRowSql("c")} AND c.geom IS NOT NULL
                        AND c.geom && ${col(a, "geom")}
                        AND (${col(a, "matched_core_id")} IS NULL OR c.id <> ${col(a, "matched_core_id")})
                        AND ST_DWithin(c.geom::geography, ${col(a, "geom")}::geography, ${SPATIAL_DWITHIN_M})
                        AND ST_Area(ST_Intersection(c.geom, ${col(a, "geom")})::geography)
                            / NULLIF(ST_Area(${col(a, "geom")}::geography), 0) > ${SPATIAL_OVERLAP_RATIO}
                  )
            ) AS issues
        `;
    }

    private async validatePlaceDuplicates(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'duplicate_external_id'::text AS code,
                    'Active core place already exists with the same external_id.'::text AS message, 'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'insert'
                  AND ${col(a, "external_id")} IS NOT NULL AND trim(${col(a, "external_id")}) <> ''
                  AND EXISTS (
                      SELECT 1 FROM core.core_places AS c
                      WHERE c.external_id = ${col(a, "external_id")} AND ${activeCorePlaceRowSql("c")}
                  )

                UNION ALL
                SELECT spi.id, 'duplicate_nearby_name',
                    'Another place with a similar name exists nearby.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "point_geom")} IS NOT NULL
                  AND nullif(trim(coalesce(${col(a, "primary_name")}, ${col(a, "display_name")}, '')), '') IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_places AS c
                      WHERE ${activeCorePlaceRowSql("c")} AND c.point_geom IS NOT NULL
                        AND c.point_geom && ST_Expand(${col(a, "point_geom")}, 0.0005)
                        AND ST_DWithin(c.point_geom::geography, ${col(a, "point_geom")}::geography, ${NEARBY_NAME_DWITHIN_M})
                        AND lower(trim(coalesce(c.primary_name, c.display_name, '')))
                            = lower(trim(coalesce(${col(a, "primary_name")}, ${col(a, "display_name")}, '')))
                  )
            ) AS issues
        `;
    }

    private async validateExternalIdDuplicate(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[],
        coreTable: string
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT spi.id AS publish_item_id, 'duplicate_external_id'::text AS code,
                ${`Active core row already exists with the same external_id (${coreTable}).`}::text AS message,
                'error'::text AS severity
            ${join}
            WHERE spi.id IN (${Prisma.join(itemIds)})
              AND spi.publish_action = 'insert'
              AND ${col(a, "external_id")} IS NOT NULL AND trim(${col(a, "external_id")}) <> ''
              AND EXISTS (
                  SELECT 1 FROM ${Prisma.raw(coreTable)} AS c
                  WHERE c.external_id = ${col(a, "external_id")} AND ${activeCoreRowSql("c")}
              )
        `;
    }

    private async validateBusStopDuplicates(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'duplicate_external_id'::text AS code,
                    'Active core bus stop already exists with the same external_id.'::text AS message, 'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'insert'
                  AND ${col(a, "external_id")} IS NOT NULL AND trim(${col(a, "external_id")}) <> ''
                  AND EXISTS (
                      SELECT 1 FROM core.core_bus_stops AS c
                      WHERE c.external_id = ${col(a, "external_id")} AND ${activeCoreRowSql("c")}
                  )

                UNION ALL
                SELECT spi.id, 'duplicate_nearby_stop',
                    'Another bus stop exists very close to this location.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "geom")} IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_bus_stops AS c
                      WHERE ${activeCoreRowSql("c")} AND c.geom IS NOT NULL
                        AND c.geom && ST_Expand(${col(a, "geom")}, 0.0002)
                        AND ST_DWithin(c.geom::geography, ${col(a, "geom")}::geography, 15)
                        AND (${col(a, "matched_core_id")} IS NULL OR c.id <> ${col(a, "matched_core_id")})
                  )
            ) AS issues
        `;
    }

    private async validateEntitySpecificRules(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const family = config.entityFamily;
        const hasMatchedCoreExpr = Prisma.sql`
            ${col(a, "matched_core_id")} IS NOT NULL
            OR (
                ${col(a, "matched_core_data")} IS NOT NULL
                AND jsonb_typeof(${col(a, "matched_core_data")}) = 'object'
                AND ${col(a, "matched_core_data")} <> '{}'::jsonb
            )
        `;

        const actionChecks = Prisma.sql`
            SELECT spi.id AS publish_item_id, 'insert_core_exists_external_id'::text AS code,
                'insert action must not target an existing active core row by external_id.'::text AS message,
                'error'::text AS severity
            ${join}
            WHERE spi.id IN (${Prisma.join(itemIds)})
              AND spi.publish_action = 'insert'
              AND ${col(a, "external_id")} IS NOT NULL AND trim(${col(a, "external_id")}) <> ''
              AND EXISTS (
                  SELECT 1 FROM ${Prisma.raw(config.coreTargetTable)} AS c
                  WHERE c.external_id = ${col(a, "external_id")} AND ${activeCoreRowForFamily(family, "c")}
              )

            UNION ALL
            SELECT spi.id, 'update_missing_target',
                'update action requires matched_core_id or matched_core_data target info.', 'error'
            ${join}
            WHERE spi.id IN (${Prisma.join(itemIds)})
              AND spi.publish_action = 'update'
              AND NOT (${hasMatchedCoreExpr})
        `;

        if (family === "water_lines") {
            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    ${actionChecks}
                    UNION ALL
                    SELECT spi.id, 'line_too_short',
                        'Water line geometry is very short (< 1 m).', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${col(a, "geom")} IS NOT NULL
                      AND ST_Length(${col(a, "geom")}::geography) < 1
                ) AS issues
            `;
        }

        if (family === "bus_stops") {
            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    ${actionChecks}
                    UNION ALL
                    SELECT spi.id, 'far_from_road',
                        'Bus stop is not within 30 m of a core street segment.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${col(a, "geom")} IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_streets AS s
                          WHERE ${activeCoreRowSql("s")} AND s.geom IS NOT NULL
                            AND s.geom && ST_Expand(${col(a, "geom")}, 0.0003)
                            AND ST_DWithin(s.geom::geography, ${col(a, "geom")}::geography, ${NEAR_ROAD_DWITHIN_M})
                      )
                    UNION ALL
                    SELECT spi.id, 'missing_name',
                        'stop_code is present but no real name is available.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${busStopStopCodeExpr(a)} IS NOT NULL
                      AND ${busStopPrimaryRealNameExpr(a)} IS NULL
                    UNION ALL
                    SELECT spi.id, 'missing_stop_code',
                        'name is present but stop_code is missing.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${busStopPrimaryRealNameExpr(a)} IS NOT NULL
                      AND ${busStopStopCodeExpr(a)} IS NULL
                    UNION ALL
                    SELECT spi.id, 'missing_admin_area',
                        'admin_area_id is not set on the bus stop candidate.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${busStopEffectiveAdminAreaIdRawExpr(a)} IS NULL
                    UNION ALL
                    SELECT spi.id, 'missing_local_name',
                        'No name_local or local entry in normalized_data.names.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${busStopNameLocalExpr(a)} IS NULL
                      AND NOT EXISTS (
                          SELECT 1
                          FROM jsonb_array_elements(
                              CASE
                                  WHEN jsonb_typeof(${col(a, "normalized_data")}->'names') = 'array'
                                  THEN ${col(a, "normalized_data")}->'names'
                                  ELSE '[]'::jsonb
                              END
                          ) AS entry(value)
                          WHERE coalesce(entry.value->>'name_type', entry.value->>'type', '') = 'local'
                             OR coalesce(entry.value->>'language_code', entry.value->>'lang', '') <> ''
                      )
                ) AS issues
            `;
        }

        if (family === "admin_areas") {
            const caps = await this.schemaRegistry.getEntityColumnCapabilities("admin_areas");
            const geom = adminAreaMultiPolygonExpr(a, caps);
            const centroid = adminAreaCentroidExpr(a, caps);
            const adminLevelId = adminAreaBigintExpr(a, caps, "admin_level_id");
            const parentId = adminAreaBigintExpr(a, caps, "parent_id");
            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    ${actionChecks}
                    UNION ALL
                    SELECT spi.id, 'parent_does_not_contain_child',
                        'Parent admin area does not spatially contain this child boundary.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${parentId} IS NOT NULL
                      AND ${geom} IS NOT NULL
                      AND EXISTS (
                          SELECT 1 FROM core.core_admin_areas AS parent
                          WHERE parent.id = ${parentId}
                            AND parent.geom IS NOT NULL
                            AND coalesce(parent.is_active, true)
                            AND parent.deleted_at IS NULL
                            AND NOT ST_Covers(parent.geom, ${geom})
                      )
                    UNION ALL
                    SELECT spi.id, 'same_level_boundary_overlap',
                        'Boundary overlaps another active admin area at the same admin level.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${geom} IS NOT NULL
                      AND ${adminLevelId} IS NOT NULL
                      AND EXISTS (
                          SELECT 1 FROM core.core_admin_areas AS c
                          WHERE c.admin_level_id = ${adminLevelId}
                            AND coalesce(c.is_active, true)
                            AND c.deleted_at IS NULL
                            AND (${optionalColumnExpr(a, caps, "matched_core_id", "bigint")} IS NULL OR c.id <> ${optionalColumnExpr(a, caps, "matched_core_id", "bigint")})
                            AND c.geom && ${geom}
                            AND ST_Area(ST_Intersection(c.geom, ${geom})::geography)
                                / NULLIF(ST_Area(${geom}::geography), 0) > 0.05
                      )
                    UNION ALL
                    SELECT spi.id, 'no_myanmar_name',
                        'No Myanmar name found in overrides or normalized names.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND nullif(trim(coalesce(
                          ${optionalJsonTextExpr(a, caps, "review_overrides", "name_mm")},
                          ${optionalJsonTextExpr(a, caps, "review_overrides", "name:my")},
                          ${optionalJsonTextExpr(a, caps, "normalized_data", "name_mm")},
                          ${optionalJsonTextExpr(a, caps, "normalized_data", "name:my")},
                          ${optionalJsonTextExpr(a, caps, "normalized_data", "name:mm")}
                      )), '') IS NULL
                    UNION ALL
                    SELECT spi.id, 'no_english_name',
                        'No English name found in overrides or normalized names.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND nullif(trim(coalesce(
                          ${optionalJsonTextExpr(a, caps, "review_overrides", "name_en")},
                          ${optionalJsonTextExpr(a, caps, "review_overrides", "name:en")},
                          ${optionalJsonTextExpr(a, caps, "normalized_data", "name_en")},
                          ${optionalJsonTextExpr(a, caps, "normalized_data", "name:en")}
                      )), '') IS NULL
                    UNION ALL
                    SELECT spi.id, 'geometry_area_unusual_for_admin_level',
                        'Admin area geometry area is unusually small or large for its admin level.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${geom} IS NOT NULL
                      AND (
                          ST_Area(${geom}::geography) < 100
                          OR ST_Area(${geom}::geography) > 100000000000
                      )
                    UNION ALL
                    SELECT spi.id, 'centroid_outside_polygon',
                        'Resolved centroid is outside polygon; review geometry before promotion.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${geom} IS NOT NULL
                      AND ${centroid} IS NOT NULL
                      AND NOT ST_Covers(${geom}, ${centroid})
                ) AS issues
            `;
        }

        if (family === "bus_routes") {
            const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_routes");
            const operatorName = busRouteTextExpr(a, caps, "operator_name");
            const routeType = busRouteTextExpr(a, caps, "route_type");
            const directionality = busRouteTextExpr(a, caps, "directionality");
            const routeCode = busRouteRouteCodeExpr(a, caps);
            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    ${actionChecks}
                    UNION ALL
                    SELECT spi.id, 'operator_name_missing',
                        'operator_name is missing for this bus route.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${operatorName} IS NULL
                    UNION ALL
                    SELECT spi.id, 'route_type_missing',
                        'route_type is missing for this bus route.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${routeType} IS NULL
                    UNION ALL
                    SELECT spi.id, 'directionality_missing',
                        'directionality is missing for this bus route.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${directionality} IS NULL
                    UNION ALL
                    SELECT spi.id, 'no_myanmar_name',
                        'No Myanmar bus route name found in overrides or normalized names.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND nullif(trim(coalesce(
                          ${optionalJsonTextExpr(a, caps, "review_overrides", "name_mm")},
                          ${optionalJsonTextExpr(a, caps, "review_overrides", "name:my")},
                          ${optionalJsonTextExpr(a, caps, "normalized_data", "name_mm")},
                          ${optionalJsonTextExpr(a, caps, "normalized_data", "name:my")},
                          ${optionalJsonTextExpr(a, caps, "normalized_data", "name:mm")}
                      )), '') IS NULL
                    UNION ALL
                    SELECT spi.id, 'no_english_name',
                        'No English bus route name found in overrides or normalized names.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND nullif(trim(coalesce(
                          ${optionalJsonTextExpr(a, caps, "review_overrides", "name_en")},
                          ${optionalJsonTextExpr(a, caps, "review_overrides", "name:en")},
                          ${optionalJsonTextExpr(a, caps, "normalized_data", "name_en")},
                          ${optionalJsonTextExpr(a, caps, "normalized_data", "name:en")}
                      )), '') IS NULL
                    UNION ALL
                    SELECT spi.id, 'route_code_inferred_from_normalized_data',
                        'route_code is inferred from normalized_data; review before promotion.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${routeCode} IS NOT NULL
                      AND ${optionalColumnExpr(a, caps, "route_code", "text")} IS NULL
                ) AS issues
            `;
        }

        if (family === "bus_route_variants") {
            const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_route_variants");
            const routeId = busRouteVariantResolvedRouteIdExpr(a, caps);
            const directionName = busRouteVariantTextExpr(a, caps, "direction_name");
            const originName = busRouteVariantTextExpr(a, caps, "origin_name");
            const destinationName = busRouteVariantTextExpr(a, caps, "destination_name");
            const distanceM = Prisma.sql`
                coalesce(
                    CASE WHEN ${optionalJsonTextExpr(a, caps, "review_overrides", "distance_m")} ~ '^[0-9]+(\\.[0-9]+)?$'
                        THEN ${optionalJsonTextExpr(a, caps, "review_overrides", "distance_m")}::numeric END,
                    ${optionalColumnExpr(a, caps, "distance_m", "numeric")},
                    CASE WHEN ${optionalJsonTextExpr(a, caps, "normalized_data", "distance_m")} ~ '^[0-9]+(\\.[0-9]+)?$'
                        THEN ${optionalJsonTextExpr(a, caps, "normalized_data", "distance_m")}::numeric END
                )
            `;
            const geom = optionalColumnExpr(a, caps, "geom", "geometry");
            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    ${actionChecks}
                    UNION ALL
                    SELECT spi.id, 'direction_name_missing',
                        'direction_name is missing for this bus route variant.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${directionName} IS NULL
                    UNION ALL
                    SELECT spi.id, 'origin_name_missing',
                        'origin_name is missing for this bus route variant.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${originName} IS NULL
                    UNION ALL
                    SELECT spi.id, 'destination_name_missing',
                        'destination_name is missing for this bus route variant.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${destinationName} IS NULL
                    UNION ALL
                    SELECT spi.id, 'distance_m_missing',
                        'distance_m is missing; promotion will compute it from geometry when possible.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${distanceM} IS NULL
                    UNION ALL
                    SELECT spi.id, 'route_unverified',
                        'Resolved bus route exists but is not core-verified yet.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${routeId} IS NOT NULL
                      AND EXISTS (
                          SELECT 1 FROM core.core_bus_routes AS br
                          WHERE br.id = ${routeId}
                            AND (
                                coalesce(br.is_verified, false) IS FALSE
                                OR coalesce(br.verification_status, 'unverified') <> 'verified'
                            )
                      )
                    UNION ALL
                    SELECT spi.id, 'geometry_not_near_known_bus_stops',
                        'Variant geometry is not near any active core bus stops.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${geom} IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_bus_stops AS bs
                          WHERE bs.geom IS NOT NULL
                            AND coalesce(bs.is_active, true)
                            AND bs.deleted_at IS NULL
                            AND ST_DWithin(bs.geom::geography, ${geom}::geography, 75)
                      )
                    UNION ALL
                    SELECT spi.id, 'routing_graph_alignment_pending',
                        'Variant geometry is not checked against the routing graph in Phase 12B.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                ) AS issues
            `;
        }

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (${actionChecks}) AS issues
        `;
    }
}
