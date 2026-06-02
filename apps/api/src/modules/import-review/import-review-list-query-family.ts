import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";
import {
    buildLightweightTypedNameColumns,
    colRef,
    effectiveBuildingTypeIdExpr,
    effectiveLanduseClassIdExpr,
    optionalTypedCandidateColumn,
    shapeColumn,
} from "./import-review-candidate-sql.js";
import { effectiveAdminAreaIdExpr } from "./import-review-effective-values.js";
import { roadsExplicitAdminAreaIdExpr } from "./import-review-road-admin-area-sql.js";

function tableAlias(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    return Prisma.raw(config.tableAlias);
}

function geometryPresenceExpr(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const geomCol = config.geometryColumns.primary;
    return geomCol !== undefined
        ? Prisma.sql`(${colRef(config, geomCol)} IS NOT NULL)`
        : Prisma.sql`false`;
}

/** Default shaped columns for families without a dedicated list extension module. */
export function buildGenericLightweightListExtensionSelect(
    config: ImportReviewEntityFamilyConfig
): Prisma.Sql {
    const parts: Prisma.Sql[] = [
        Prisma.sql`
            , ${shapeColumn(config, "building_type", "text")} AS building_type
            , ${effectiveBuildingTypeIdExpr(config)} AS building_type_id
            , ${effectiveLanduseClassIdExpr(config)} AS landuse_class_id
            , ${shapeColumn(config, "admin_area_id", "bigint")} AS admin_area_id
            , ${shapeColumn(config, "levels", "int")} AS levels
            , ${shapeColumn(config, "height_m", "numeric")} AS height_m
            , ${shapeColumn(config, "area_m2", "numeric")} AS area_m2
        `,
    ];

    if (config.roadClassJoin) {
        parts.push(Prisma.sql`
            , ${colRef(config, "road_class_id")} AS road_candidate_road_class_id
            , ${colRef(config, "surface")} AS road_candidate_surface
            , ${colRef(config, "is_oneway")} AS road_candidate_is_oneway
            , COALESCE(rc.code, ${colRef(config, "road_class")}) AS road_candidate_class_label
            , ${colRef(config, "length_m")} AS length_m
        `);
    } else {
        parts.push(Prisma.sql`
            , NULL::bigint AS road_candidate_road_class_id
            , NULL::text AS road_candidate_surface
            , NULL::boolean AS road_candidate_is_oneway
            , NULL::text AS road_candidate_class_label
            , NULL::numeric AS length_m
        `);
    }

    if (config.buildingTypeJoin) {
        parts.push(Prisma.sql`, bt.code AS building_type_code, bt.name AS building_type_name`);
    }

    if (config.landuseClassJoin) {
        parts.push(Prisma.sql`
            , lc.code AS landuse_class_code
            , lc.name_en AS landuse_class_name
            , lc.name_mm AS landuse_class_name_mm
        `);
    }

    if (config.routeFamily === "bus_stops") {
        parts.push(
            Prisma.sql`
            ${buildLightweightTypedNameColumns(config)}
            , ${colRef(config, "stop_code")} AS stop_code
        `
        );
    } else {
        parts.push(buildLightweightTypedNameColumns(config));
    }

    if (config.routeFamily === "places") {
        parts.push(Prisma.sql`
            , ${optionalTypedCandidateColumn(config, "primary_name", "text")} AS primary_name
            , ${optionalTypedCandidateColumn(config, "display_name", "text")} AS display_name
            , ${optionalTypedCandidateColumn(config, "category_id", "bigint")} AS category_id
        `);
    }

    if (config.routeFamily === "addresses") {
        parts.push(Prisma.sql`
            , ${colRef(config, "validation_status")} AS validation_status
            , ${colRef(config, "source_entity_type")} AS source_entity_type
            , ${colRef(config, "source_classification")} AS source_classification
            , ${colRef(config, "address_strength")} AS address_strength
            , ${colRef(config, "place_candidate_status")} AS place_candidate_status
            , ${colRef(config, "linked_place_candidate_id")} AS linked_place_candidate_id
            , ${colRef(config, "matched_core_place_id")} AS matched_core_place_id
        `);
    }

    if (config.effectiveAdminAreaJoin && config.routeFamily !== "roads") {
        parts.push(Prisma.sql`, eff_aa.canonical_name AS effective_admin_area_name`);
    }

    if (config.routeFamily === "roads" && config.effectiveAdminAreaJoin) {
        parts.push(Prisma.sql`
            , ${roadsExplicitAdminAreaIdExpr(config.tableAlias)} AS admin_area_id
            , eff_aa_explicit.canonical_name AS admin_area_name
            , eff_aa_explicit.canonical_name AS effective_admin_area_name
        `);
    }

    parts.push(Prisma.sql`, ${geometryPresenceExpr(config)} AS has_geometry`);

    return Prisma.join(parts, "");
}

export function buildGenericLightweightListFromClause(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const base = Prisma.sql`${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${tableAlias(config)}`;

    if (config.routeFamily === "roads" && config.roadClassJoin) {
        const alias = config.tableAlias;
        const explicitId = roadsExplicitAdminAreaIdExpr(alias);
        return Prisma.sql`
            ${base}
            LEFT JOIN ref.ref_road_classes AS rc ON rc.id = ${colRef(config, "road_class_id")}
            LEFT JOIN core.core_admin_areas AS eff_aa_explicit
                ON eff_aa_explicit.id = ${explicitId}
                AND eff_aa_explicit.is_active IS TRUE
                AND eff_aa_explicit.deleted_at IS NULL
        `;
    }

    if (config.roadClassJoin && config.buildingTypeJoin) {
        return Prisma.sql`
            ${base}
            LEFT JOIN ref.ref_road_classes AS rc ON rc.id = ${colRef(config, "road_class_id")}
            LEFT JOIN ref.ref_building_types AS bt ON bt.id = ${effectiveBuildingTypeIdExpr(config)}
        `;
    }
    if (config.roadClassJoin) {
        return Prisma.sql`
            ${base}
            LEFT JOIN ref.ref_road_classes AS rc ON rc.id = ${colRef(config, "road_class_id")}
        `;
    }
    if (config.buildingTypeJoin) {
        return Prisma.sql`
            ${base}
            LEFT JOIN ref.ref_building_types AS bt ON bt.id = ${effectiveBuildingTypeIdExpr(config)}
            LEFT JOIN core.core_admin_areas AS eff_aa
                ON eff_aa.id = ${effectiveAdminAreaIdExpr(config.tableAlias)}
                AND eff_aa.is_active IS TRUE
                AND eff_aa.deleted_at IS NULL
        `;
    }
    if (config.landuseClassJoin) {
        return Prisma.sql`
            ${base}
            LEFT JOIN ref.ref_landuse_classes AS lc ON lc.id = ${effectiveLanduseClassIdExpr(config)}
        `;
    }
    if (config.effectiveAdminAreaJoin) {
        return Prisma.sql`
            ${base}
            LEFT JOIN core.core_admin_areas AS eff_aa
                ON eff_aa.id = ${effectiveAdminAreaIdExpr(config.tableAlias)}
                AND eff_aa.is_active IS TRUE
                AND eff_aa.deleted_at IS NULL
        `;
    }

    return base;
}
