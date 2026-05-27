import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";
import {
    colRef,
    effectiveBuildingTypeIdExpr,
    shapeColumn,
} from "./import-review-candidate-sql.js";
import { effectiveAdminAreaIdExpr } from "./import-review-effective-values.js";

function buildingAlias(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    return Prisma.raw(config.tableAlias);
}

export function buildBuildingLightweightListFromClause(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const alias = config.tableAlias;
    return Prisma.sql`
        ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${buildingAlias(config)}
        LEFT JOIN ref.ref_building_types AS bt
            ON bt.id = ${effectiveBuildingTypeIdExpr(config)}
        LEFT JOIN core.core_admin_areas AS eff_aa
            ON eff_aa.id = ${effectiveAdminAreaIdExpr(alias)}
            AND eff_aa.is_active IS TRUE
            AND eff_aa.deleted_at IS NULL
    `;
}

/** Building-specific list columns (type label join, shaped dims). */
export function buildBuildingLightweightListExtensionSelect(
    config: ImportReviewEntityFamilyConfig
): Prisma.Sql {
    const alias = config.tableAlias;
    const a = buildingAlias(config);

    return Prisma.sql`
        , ${shapeColumn(config, "building_type", "text")} AS building_type
        , ${effectiveBuildingTypeIdExpr(config)} AS building_type_id
        , NULL::bigint AS landuse_class_id
        , ${effectiveAdminAreaIdExpr(alias)} AS admin_area_id
        , ${shapeColumn(config, "levels", "int")} AS levels
        , ${shapeColumn(config, "height_m", "numeric")} AS height_m
        , ${shapeColumn(config, "area_m2", "numeric")} AS area_m2
        , bt.code AS building_type_code
        , bt.name AS building_type_name
        , eff_aa.canonical_name AS effective_admin_area_name
        , (${colRef(config, "geom")} IS NOT NULL) AS has_geometry
    `;
}
