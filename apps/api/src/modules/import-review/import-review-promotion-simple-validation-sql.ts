/**
 * Scalar-only geometry projections for promotion validation $queryRaw.
 * PostGIS geometry columns must never appear in Prisma raw SELECT lists.
 */

import { Prisma } from "@prisma/client";

import type { PromotionGeometrySpec, PromotionGeometryType } from "./import-review-promotion-simple-config.js";
import type { ImportReviewSimplePromotionFamilyConfig } from "./import-review-promotion-simple-config.js";

/** Candidate columns that are PostGIS geometry and must not be selected raw in $queryRaw. */
export const PROMOTION_VALIDATION_GEOMETRY_COLUMN_NAMES = new Set([
    "geom",
    "point_geom",
    "centroid",
    "entrance_geom",
    "line_geom",
    "polygon_geom",
    "boundary_geom",
]);

export type PromotionValidationGeometryMetricsKind = "point" | "line" | "polygon";

export function isPromotionValidationGeometryColumn(column: string): boolean {
    return PROMOTION_VALIDATION_GEOMETRY_COLUMN_NAMES.has(column);
}

function allowedGeometryTypes(spec: PromotionGeometrySpec): readonly PromotionGeometryType[] {
    return typeof spec.requiredType === "string" ? [spec.requiredType] : spec.requiredType;
}

export function promotionValidationGeometryMetricsKind(
    spec: PromotionGeometrySpec
): PromotionValidationGeometryMetricsKind {
    const allowed = allowedGeometryTypes(spec);
    if (allowed.length === 1 && allowed[0] === "Point") {
        return "point";
    }
    if (allowed.some((t) => t === "LineString" || t === "MultiLineString")) {
        return "line";
    }
    return "polygon";
}

/** Scalar geometry facts for validation (no raw geometry type in result). */
export function buildPromotionValidationGeometryScalarsSql(
    geomColumn: string,
    kind: PromotionValidationGeometryMetricsKind
): Prisma.Sql {
    const col = Prisma.raw(geomColumn);
    const base = Prisma.sql`
        (${col} IS NOT NULL) AS has_geom,
        CASE WHEN ${col} IS NOT NULL THEN ST_IsValid(${col}) END AS geom_is_valid,
        CASE WHEN ${col} IS NOT NULL THEN ST_GeometryType(${col}) END AS geom_type,
        CASE WHEN ${col} IS NOT NULL THEN ST_SRID(${col}) END AS geom_srid,
        CASE WHEN ${col} IS NOT NULL THEN ST_IsEmpty(${col}) END AS geom_is_empty
    `;

    if (kind === "line") {
        return Prisma.sql`
            ${base},
            CASE
                WHEN ${col} IS NOT NULL AND ST_IsValid(${col}) AND NOT ST_IsEmpty(${col})
                THEN ST_Length(${col}::geography)
            END AS geom_length_m,
            NULL::double precision AS geom_area_m2
        `;
    }

    if (kind === "polygon") {
        return Prisma.sql`
            ${base},
            NULL::double precision AS geom_length_m,
            CASE
                WHEN ${col} IS NOT NULL AND ST_IsValid(${col}) AND NOT ST_IsEmpty(${col})
                THEN ST_Area(${col}::geography)
            END AS geom_area_m2
        `;
    }

    return Prisma.sql`
        ${base},
        NULL::double precision AS geom_length_m,
        NULL::double precision AS geom_area_m2
    `;
}

/** Column names selected as scalars for loadCandidateRow (excludes all geometry columns). */
export function listPromotionValidationScalarColumnNames(
    config: ImportReviewSimplePromotionFamilyConfig
): string[] {
    const columnList = new Set<string>([
        "id",
        "review_batch_id",
        "review_status",
        "review_decision",
        "promotion_status",
        "promoted_core_id",
        "match_status",
        "auto_action",
        "review_note",
        "confidence_score",
        "external_id",
        "local_staging_id",
        "source_refs",
        ...config.promotionColumns,
        ...config.requiredFields,
        ...config.fkChecks.map((c) => c.column),
    ]);

    for (const name of [...columnList]) {
        if (isPromotionValidationGeometryColumn(name)) {
            columnList.delete(name);
        }
    }

    return [...columnList].sort();
}

export function buildPromotionValidationGeometrySelectSql(
    config: ImportReviewSimplePromotionFamilyConfig
): Prisma.Sql {
    if (!config.geometry) {
        return Prisma.sql`
            false AS has_geom,
            NULL::boolean AS geom_is_valid,
            NULL::text AS geom_type,
            NULL::integer AS geom_srid,
            NULL::boolean AS geom_is_empty,
            NULL::double precision AS geom_length_m,
            NULL::double precision AS geom_area_m2
        `;
    }

    return buildPromotionValidationGeometryScalarsSql(
        config.geometry.column,
        promotionValidationGeometryMetricsKind(config.geometry)
    );
}
