import { Prisma, type PrismaClient } from "@prisma/client";

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

export class ImportReviewPromotionValidationRules {
    constructor(private readonly prisma: PrismaClient) {}

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
        if (family === "places") {
            return this.validatePlaceGeometry(config, itemIds);
        }
        if (family === "bus_stops") {
            return this.validatePointGeometry(config, itemIds, "geom", true);
        }
        return [];
    }

    private async validatePolygonGeometry(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[],
        requireCentroid: boolean
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const maxArea = config.entityFamily === "landuse" ? MAX_LANDUSE_AREA_M2 : MAX_AREA_M2;
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
                  AND ${col(a, "geom")} IS NOT NULL AND NOT ST_IsValid(${col(a, "geom")})

                UNION ALL
                SELECT spi.id, 'empty_geom', 'Geometry must not be empty.', 'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "geom")} IS NOT NULL AND ST_IsEmpty(${col(a, "geom")})

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
                  AND upper(GeometryType(${col(a, "geom")})) NOT IN ('POLYGON', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION')

                UNION ALL
                SELECT spi.id, 'area_out_of_range',
                    ${`Geometry area must be between ${MIN_AREA_M2} m² and ${maxArea} m².`},
                    'error'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "geom")} IS NOT NULL
                  AND (
                      ST_Area(${col(a, "geom")}::geography) < ${MIN_AREA_M2}
                      OR ST_Area(${col(a, "geom")}::geography) > ${maxArea}
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

        const familySpecific =
            family === "buildings"
                ? Prisma.sql`
                    UNION ALL
                    SELECT spi.id, 'missing_building_type',
                        'class_code or building_type must be available.', 'error'
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
                    SELECT spi.id, 'missing_class_code', 'class_code is required for landuse.', 'error'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${col(a, "id")} IS NOT NULL
                      AND nullif(trim(coalesce(${col(a, "class_code")}, '')), '') IS NULL
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
                        'name or stop_code is required for bus stops.', 'error'
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

    private async validateReferences(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const family = config.entityFamily;

        if (family === "buildings") {
            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    SELECT spi.id AS publish_item_id, 'invalid_building_type_id'::text AS code,
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
                    SELECT spi.id, 'invalid_admin_area_id',
                        'admin_area_id does not exist in core.core_admin_areas.', 'error'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${col(a, "admin_area_id")} IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_admin_areas AS ca
                          WHERE ca.id = ${col(a, "admin_area_id")}
                            AND ca.is_active IS TRUE
                      )

                    UNION ALL
                    SELECT spi.id, 'missing_admin_area',
                        'admin_area_id is not set; confirm admin assignment before promotion.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)}) AND ${col(a, "admin_area_id")} IS NULL
                ) AS issues
            `;
        }

        if (family === "places") {
            const explicitCategoryId = placeExplicitCategoryIdExpr(a);
            const classCode = placeClassCodeExpr(a);
            const resolvedCategoryId = placeResolvedCategoryIdExpr(a);

            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    SELECT spi.id AS publish_item_id, 'invalid_category_id'::text AS code,
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
                        'No category_id or mappable class_code; category is required for core.core_places.'::text,
                        'warning'::text AS severity
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${resolvedCategoryId} IS NULL
                      AND ${classCode} IS NULL
                ) AS issues
            `;
        }

        if (family === "bus_stops") {
            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT spi.id AS publish_item_id, 'invalid_admin_area_id'::text AS code,
                    'admin_area_id does not exist in core.core_admin_areas.'::text AS message, 'error'::text AS severity
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${busStopEffectiveAdminAreaIdRawExpr(a)} IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM core.core_admin_areas AS ca
                      WHERE ca.id = ${busStopEffectiveAdminAreaIdRawExpr(a)}
                        AND ca.is_active IS TRUE
                  )
            `;
        }

        return [];
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
        return [];
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

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (${actionChecks}) AS issues
        `;
    }
}
