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
import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import { getImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import {
    assertPoiCategoriesTableExists,
    placeClassCodeExpr,
    placeExplicitCategoryIdExpr,
    placeResolvedCategoryIdExpr,
} from "./import-review-promotion-place-category.js";
import { hasRoadPromotionBlockingErrorsSql } from "./import-review-road-promotion-policy.js";
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
    jsonColumn: "normalized_data" | "source_refs",
    key: string
): Prisma.Sql {
    if (!caps.hasColumn(jsonColumn)) {
        return Prisma.sql`NULL::text`;
    }
    return Prisma.sql`${col(alias, jsonColumn)}->>${key}`;
}

function coalesceColumnNormalizedText(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: string,
    normalizedKey?: string
): Prisma.Sql {
    const nk = normalizedKey ?? column;
    return Prisma.sql`nullif(trim(coalesce(
        ${optionalColumnExpr(alias, caps, column, "text")},
        ${optionalJsonTextExpr(alias, caps, "normalized_data", nk)},
        ''
    )), '')`;
}

function adminAreaTextExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: "canonical_name" | "slug" | "external_id" | "class_code"
): Prisma.Sql {
    return coalesceColumnNormalizedText(alias, caps, column);
}

function adminAreaNameExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`
        nullif(trim(coalesce(
            ${coalesceColumnNormalizedText(alias, caps, "canonical_name")},
            ${coalesceColumnNormalizedText(alias, caps, "name")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "name:my")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "name:en")},
            ''
        )), '')
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
                    ${optionalJsonTextExpr(alias, caps, "normalized_data", "admin_level_code")},
                    ${optionalJsonTextExpr(alias, caps, "normalized_data", "admin_level")},
                    ${coalesceColumnNormalizedText(alias, caps, "class_code")},
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
    return optionalColumnExpr(alias, caps, "geom", "geometry");
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
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${
                      config.entityFamily === "roads"
                          ? hasRoadPromotionBlockingErrorsSql(a)
                          : hasValidationErrorsSql(a)
                  }

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
        const family = config.entityFamily as ImportReviewEntityFamilySlug;
        if (family === "buildings" || family === "landuse" || family === "water_polygons") {
            return this.validatePolygonGeometry(config, itemIds, family === "buildings");
        }
        if (family === "water_lines" || family === "roads") {
            return this.validateLineGeometry(config, itemIds);
        }
        if (family === "addresses") {
            return this.validatePointGeometry(config, itemIds, "geom", true);
        }
        if (family === "places") {
            return this.validatePlaceGeometry(config, itemIds);
        }
        if (family === "admin_areas") {
            return this.validateAdminAreaGeometry(config, itemIds);
        }
        if (family === "routing_barriers") {
            return this.validateRoutingBarrierGeometry(config, itemIds);
        }
        return [];
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

    private async validateRoadRequiredFields(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (
                SELECT spi.id AS publish_item_id, 'missing_lineage'::text AS code,
                    'external_id or local_staging_id or source_refs lineage is recommended.', 'warning'::text AS message
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
                SELECT spi.id, 'empty_source_refs',
                    'source_refs is empty; optional for roads but recommended for traceability.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND (
                      ${col(a, "source_refs")} IS NULL
                      OR jsonb_typeof(${col(a, "source_refs")}) <> 'object'
                      OR ${col(a, "source_refs")} = '{}'::jsonb
                  )

                UNION ALL
                SELECT spi.id, 'empty_normalized_data',
                    'normalized_data is empty; optional for roads but recommended.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND (
                      ${col(a, "normalized_data")} IS NULL
                      OR jsonb_typeof(${col(a, "normalized_data")}) <> 'object'
                      OR ${col(a, "normalized_data")} = '{}'::jsonb
                  )

                UNION ALL
                SELECT spi.id, 'NAME_MISSING',
                    'Canonical name / label is missing.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "id")} IS NOT NULL
                  AND nullif(trim(coalesce(${col(a, "canonical_name")}, '')), '') IS NULL

                UNION ALL
                SELECT spi.id, 'SURFACE_MISSING',
                    'Surface tag/field is missing.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "id")} IS NOT NULL
                  AND nullif(trim(coalesce(${col(a, "surface")}, '')), '') IS NULL
                  AND nullif(trim(coalesce(${col(a, "normalized_data")}->>'surface', '')), '') IS NULL

                UNION ALL
                SELECT spi.id, 'SPEED_KPH_MISSING',
                    'Speed limit is missing.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "id")} IS NOT NULL
                  AND ${col(a, "speed_kph")} IS NULL
                  AND nullif(trim(coalesce(${col(a, "normalized_data")}->>'maxspeed', '')), '') IS NULL
                  AND nullif(trim(coalesce(${col(a, "normalized_data")}->>'speed_kph', '')), '') IS NULL

                UNION ALL
                SELECT spi.id, 'low_confidence',
                    'confidence_score is below 40.', 'warning'
                ${join}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND ${col(a, "confidence_score")} IS NOT NULL
                  AND ${col(a, "confidence_score")} < 40
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
        const family = config.entityFamily as ImportReviewEntityFamilySlug;

        if (family === "admin_areas") {
            return this.validateAdminAreaRequiredFields(config, itemIds);
        }
        if (family === "routing_barriers") {
            return this.validateRoutingBarrierRequiredFields(config, itemIds);
        }
        if (family === "roads") {
            return this.validateRoadRequiredFields(config, itemIds);
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
        if (targetCaps.isRequired("admin_level_id") && !caps.hasAdminLevelId && !caps.hasEditableFieldColumns && !caps.hasNormalizedData) {
            requiredColumnChecks.push(
                missingTargetColumnIssueSql(
                    itemIds,
                    "SCHEMA_MISSING_ADMIN_LEVEL_SOURCE",
                    "Schema error: core.core_admin_areas.admin_level_id is required, but no admin_level_id source column or JSON source exists."
                )
            );
        }
        if (targetCaps.isRequired("canonical_name") && !caps.hasCanonicalName && !caps.hasEditableFieldColumns && !caps.hasNormalizedData) {
            requiredColumnChecks.push(
                missingTargetColumnIssueSql(
                    itemIds,
                    "SCHEMA_MISSING_CANONICAL_NAME_SOURCE",
                    "Schema error: core.core_admin_areas.canonical_name is required, but no canonical_name source column or JSON source exists."
                )
            );
        }
        if (targetCaps.isRequired("slug") && !caps.hasSlug && !caps.hasEditableFieldColumns && !caps.hasNormalizedData) {
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
        const family = config.entityFamily as ImportReviewEntityFamilySlug;
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
                "Landuse validation uses normalized_data for admin_area_id; landuse_candidates has no admin_area_id column. This reference is optional for landuse."
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
                `${entityLabel} validation uses normalized_data for admin_area_id; ${config.candidateTable.split(".").pop()} has no admin_area_id column. This reference is optional.`
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
        const rawAdminLevelId = adminAreaBigintExpr(a, caps, "admin_level_id");
        const explicitSourceTypeCode = Prisma.sql`
            nullif(trim(coalesce(
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
        const family = config.entityFamily as ImportReviewEntityFamilySlug;
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
        if (family === "admin_areas") {
            return this.validateAdminAreaDuplicates(config, itemIds);
        }
        if (family === "roads") {
            return this.validateExternalIdDuplicate(config, itemIds, "core.core_streets");
        }
        if (family === "addresses") {
            return this.validateExternalIdDuplicate(config, itemIds, "core.core_addresses");
        }
        return [];
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

    private async validateEntitySpecificRules(
        config: ImportReviewPublishFamilyConfig,
        itemIds: bigint[]
    ): Promise<ImportReviewPublishValidationIssueRow[]> {
        const a = config.tableAlias;
        const join = itemsJoinSql(config);
        const family = config.entityFamily as ImportReviewEntityFamilySlug;
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
                        'No Myanmar name found on candidate columns or normalized names.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND nullif(trim(coalesce(
                          ${coalesceColumnNormalizedText(a, caps, "name_mm")},
                          ${optionalJsonTextExpr(a, caps, "normalized_data", "name:my")},
                          ${optionalJsonTextExpr(a, caps, "normalized_data", "name:mm")}
                      )), '') IS NULL
                    UNION ALL
                    SELECT spi.id, 'no_english_name',
                        'No English name found on candidate columns or normalized names.', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND nullif(trim(coalesce(
                          ${coalesceColumnNormalizedText(a, caps, "name_en")},
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

        if (family === "roads") {
            return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
                SELECT publish_item_id, code, message, severity FROM (
                    ${actionChecks}
                    UNION ALL
                    SELECT spi.id, 'line_too_short',
                        'Road segment geometry is very short (< 1 m).', 'warning'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND ${col(a, "geom")} IS NOT NULL
                      AND ST_Length(${col(a, "geom")}::geography) < 1
                    UNION ALL
                    SELECT spi.id, 'routing_graph_not_checked',
                        'Routing graph connectivity is not validated during publish batch validation.', 'info'
                    ${join}
                    WHERE spi.id IN (${Prisma.join(itemIds)})
                      AND spi.id = (SELECT min(v) FROM unnest(ARRAY[${Prisma.join(itemIds)}]::bigint[]) AS v)
                ) AS issues
            `;
        }

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity FROM (${actionChecks}) AS issues
        `;
    }
}
