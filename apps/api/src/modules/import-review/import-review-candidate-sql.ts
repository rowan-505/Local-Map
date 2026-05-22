import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";
import {
    busStopNameEnExpr,
    busStopNameMmExpr,
    effectiveAdminAreaIdExpr,
} from "./import-review-effective-values.js";
import {
    buildRoadAdminAreaJoins,
    roadResolvedAdminAreaIdExpr,
    roadResolvedAdminAreaNameExpr,
} from "./import-review-road-admin-area-sql.js";
import { effectiveRoadLengthMExpr } from "./import-review-promotion-promote-sql.js";
import type { ImportReviewBuildingSort, ImportReviewBulkFilters } from "./import-review.schema.js";

const UNREVIEWED = "__unreviewed__";

export type CandidateListFilters = {
    match_status?: string | undefined;
    auto_action?: string | undefined;
    review_status?: string | undefined;
    review_decision?: string | undefined;
    class_code?: string | undefined;
    promotion_status?: string | undefined;
    include_promoted?: boolean | undefined;
    q?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    sort?: ImportReviewBuildingSort | undefined;
    include_geometry?: boolean | undefined;
};

function colRef(config: ImportReviewEntityFamilyConfig, column: string): Prisma.Sql {
    return Prisma.raw(`${config.tableAlias}.${column}`);
}

function qual(config: ImportReviewEntityFamilyConfig, expr: string): Prisma.Sql {
    return Prisma.raw(`${config.tableAlias}.${expr}`);
}

function tableFrom(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    return Prisma.sql`${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(config.tableAlias)}`;
}

function shapeColumn(
    config: ImportReviewEntityFamilyConfig,
    column: keyof ImportReviewEntityFamilyConfig["listRowShape"],
    sqlType: string
): Prisma.Sql {
    const mapped = config.listRowShape[column];
    if (mapped === null) {
        return Prisma.raw(`NULL::${sqlType}`);
    }
    return colRef(config, mapped);
}

/** Effective FK: review_overrides.building_type_id wins over candidate column. */
export function effectiveBuildingTypeIdExpr(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const ov = Prisma.sql`COALESCE(to_jsonb(${colRef(config, "review_overrides")}), '{}'::jsonb)`;
    return Prisma.sql`
        CASE
            WHEN (${ov}->>'building_type_id') ~ '^[0-9]+$'
            THEN (${ov}->>'building_type_id')::bigint
            ELSE ${shapeColumn(config, "building_type_id", "bigint")}
        END
    `;
}

/** Effective FK: review_overrides.landuse_class_id wins over candidate column. */
export function effectiveLanduseClassIdExpr(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const ov = Prisma.sql`COALESCE(to_jsonb(${colRef(config, "review_overrides")}), '{}'::jsonb)`;
    return Prisma.sql`
        CASE
            WHEN (${ov}->>'landuse_class_id') ~ '^[0-9]+$'
            THEN (${ov}->>'landuse_class_id')::bigint
            ELSE ${shapeColumn(config, "landuse_class_id", "bigint")}
        END
    `;
}

function buildSearchClause(config: ImportReviewEntityFamilyConfig, q: string): Prisma.Sql {
    const pattern = `%${q}%`;
    if (config.routeFamily === "bus_stops") {
        return Prisma.sql`(
            ${colRef(config, "canonical_name")} ILIKE ${pattern}
            OR ${colRef(config, "external_id")} ILIKE ${pattern}
            OR ${colRef(config, "stop_code")} ILIKE ${pattern}
            OR ${colRef(config, "review_overrides")}->>'name_mm' ILIKE ${pattern}
            OR ${colRef(config, "review_overrides")}->>'name_en' ILIKE ${pattern}
            OR ${colRef(config, "normalized_data")}->'tags'->>'name' ILIKE ${pattern}
            OR ${colRef(config, "normalized_data")}->'tags'->>'name:en' ILIKE ${pattern}
        )`;
    }
    const parts = config.searchableFields.map((field) =>
        Prisma.sql`${colRef(config, field)} ILIKE ${pattern}`
    );
    return Prisma.join(parts, " OR ");
}

export function buildCandidateWhereClause(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint,
    filters: CandidateListFilters
): Prisma.Sql {
    const parts: Prisma.Sql[] = [
        Prisma.sql`${colRef(config, "review_batch_id")} = ${reviewBatchId}`,
        Prisma.sql`${colRef(config, "entity_family")} = ${config.entityFamily}`,
    ];

    const supportsPromotionFilter = config.filterFields.includes("promotion_status");
    const supportsClassCode = config.filterFields.includes("class_code");

    if (
        supportsPromotionFilter &&
        !filters.include_promoted &&
        filters.promotion_status === undefined
    ) {
        parts.push(
            Prisma.sql`${colRef(config, "promotion_status")} IS DISTINCT FROM 'promoted'`,
            Prisma.sql`${colRef(config, "review_status")} IS DISTINCT FROM 'promoted'`
        );
    }

    if (filters.match_status !== undefined) {
        parts.push(Prisma.sql`${colRef(config, "match_status")} = ${filters.match_status}`);
    }

    if (filters.auto_action !== undefined) {
        parts.push(Prisma.sql`${colRef(config, "auto_action")} = ${filters.auto_action}`);
    }

    if (filters.review_status !== undefined) {
        if (filters.review_status === UNREVIEWED) {
            parts.push(
                Prisma.sql`(${colRef(config, "review_status")} IS NULL OR trim(${colRef(config, "review_status")}) = '')`
            );
        } else {
            parts.push(Prisma.sql`${colRef(config, "review_status")} = ${filters.review_status}`);
        }
    }

    if (filters.review_decision !== undefined) {
        if (filters.review_decision === UNREVIEWED) {
            parts.push(
                Prisma.sql`(${colRef(config, "review_decision")} IS NULL OR trim(${colRef(config, "review_decision")}) = '')`
            );
        } else {
            parts.push(Prisma.sql`${colRef(config, "review_decision")} = ${filters.review_decision}`);
        }
    }

    if (supportsClassCode && filters.class_code !== undefined) {
        parts.push(Prisma.sql`${colRef(config, "class_code")} = ${filters.class_code}`);
    }

    if (supportsPromotionFilter && filters.promotion_status !== undefined) {
        if (filters.promotion_status === UNREVIEWED) {
            parts.push(
                Prisma.sql`(${colRef(config, "promotion_status")} IS NULL OR trim(${colRef(config, "promotion_status")}) = '')`
            );
        } else {
            parts.push(Prisma.sql`${colRef(config, "promotion_status")} = ${filters.promotion_status}`);
        }
    }

    if (filters.q !== undefined) {
        parts.push(Prisma.sql`(${buildSearchClause(config, filters.q)})`);
    }

    return Prisma.join(parts, " AND ");
}

const SORT_COLUMN_MAP: Record<ImportReviewBuildingSort, string> = {
    updated_at_desc: "updated_at DESC",
    updated_at_asc: "updated_at ASC",
    created_at_desc: "created_at DESC",
    created_at_asc: "created_at ASC",
    id_desc: "id DESC",
    id_asc: "id ASC",
    confidence_score_desc: "confidence_score DESC NULLS LAST",
    confidence_score_asc: "confidence_score ASC NULLS LAST",
    canonical_name_asc: "canonical_name ASC NULLS LAST",
    canonical_name_desc: "canonical_name DESC NULLS LAST",
    external_id_asc: "external_id ASC NULLS LAST",
    external_id_desc: "external_id DESC NULLS LAST",
};

export function buildCandidateOrderBy(
    config: ImportReviewEntityFamilyConfig,
    sort: ImportReviewBuildingSort
): Prisma.Sql {
    const expr = SORT_COLUMN_MAP[sort];
    return Prisma.raw(`${config.tableAlias}.${expr}`);
}

function buildGeometrySelect(
    config: ImportReviewEntityFamilyConfig,
    includeGeometry: boolean,
    column: string,
    alias: "geometry" | "centroid"
): Prisma.Sql {
    const geomCol = colRef(config, column);

    if (config.routeFamily === "roads" && alias === "centroid") {
        return Prisma.sql`
            CASE
                WHEN ${includeGeometry} AND ${geomCol} IS NOT NULL THEN
                    ST_AsGeoJSON(ST_SetSRID(ST_Centroid(${geomCol}), 4326))::json
                ELSE NULL::json
            END AS centroid
        `;
    }

    if (config.routeFamily === "places" && alias === "centroid") {
        return Prisma.sql`
            CASE
                WHEN ${includeGeometry} THEN ST_AsGeoJSON(${geomCol})::json
                ELSE NULL::json
            END AS centroid
        `;
    }

    return Prisma.sql`
        CASE
            WHEN ${includeGeometry} THEN ST_AsGeoJSON(${geomCol})::json
            ELSE NULL::json
        END AS ${Prisma.raw(alias)}
    `;
}

export function buildCandidateCommonSelect(
    config: ImportReviewEntityFamilyConfig,
    includeGeometry: boolean
): Prisma.Sql {
    const selectParts: Prisma.Sql[] = [
        Prisma.sql`${qual(config, "id")},`,
        Prisma.sql`${qual(config, "public_id::text AS public_id")},`,
        Prisma.sql`${qual(config, "review_batch_id")},`,
        Prisma.sql`${qual(config, "source_snapshot_version")},`,
        Prisma.sql`${qual(config, "local_staging_id")},`,
        Prisma.sql`${qual(config, "source_snapshot_id_local")},`,
        Prisma.sql`${qual(config, "external_id")},`,
        Prisma.sql`${qual(config, "canonical_name")},`,
        Prisma.sql`${shapeColumn(config, "name", "text")} AS name,`,
        Prisma.sql`${qual(config, "class_code")},`,
        Prisma.sql`${shapeColumn(config, "building_type", "text")} AS building_type,`,
        config.buildingTypeJoin
            ? Prisma.sql`${effectiveBuildingTypeIdExpr(config)} AS building_type_id,`
            : Prisma.sql`${shapeColumn(config, "building_type_id", "bigint")} AS building_type_id,`,
        config.landuseClassJoin
            ? Prisma.sql`${effectiveLanduseClassIdExpr(config)} AS landuse_class_id,`
            : Prisma.sql`${shapeColumn(config, "landuse_class_id", "bigint")} AS landuse_class_id,`,
        ...(config.routeFamily === "roads" && config.effectiveAdminAreaJoin
            ? []
            : [Prisma.sql`${shapeColumn(config, "admin_area_id", "bigint")} AS admin_area_id,`]),
        Prisma.sql`${shapeColumn(config, "levels", "int")} AS levels,`,
        Prisma.sql`${shapeColumn(config, "height_m", "numeric")} AS height_m,`,
        Prisma.sql`${shapeColumn(config, "area_m2", "numeric")} AS area_m2,`,
        Prisma.sql`${qual(config, "confidence_score")},`,
        Prisma.sql`${qual(config, "match_status")},`,
        Prisma.sql`${qual(config, "auto_action")},`,
        Prisma.sql`${qual(config, "review_status")},`,
        Prisma.sql`${qual(config, "review_decision")},`,
        Prisma.sql`${qual(config, "reviewed_by::text AS reviewed_by")},`,
        Prisma.sql`${qual(config, "reviewed_at")},`,
        Prisma.sql`${qual(config, "review_note")},`,
        Prisma.sql`${qual(config, "normalized_data")},`,
        Prisma.sql`${qual(config, "source_refs")},`,
        Prisma.sql`COALESCE(to_jsonb(${colRef(config, "review_overrides")}), '{}'::jsonb) AS review_overrides,`,
        Prisma.sql`${qual(config, "matched_core_id")},`,
        Prisma.sql`${qual(config, "matched_core_table")},`,
        Prisma.sql`${qual(config, "matched_core_data")},`,
        Prisma.sql`${qual(config, "f2_comparison")},`,
        Prisma.sql`${qual(config, "validation_warnings")},`,
        Prisma.sql`${qual(config, "validation_errors")},`,
        Prisma.sql`${qual(config, "promotion_status")},`,
        Prisma.sql`${qual(config, "promoted_core_id")},`,
        Prisma.sql`${qual(config, "created_at")},`,
        Prisma.sql`${qual(config, "updated_at")},`,
    ];

    const primaryGeom = config.geometryColumns.primary;
    if (primaryGeom !== undefined) {
        selectParts.push(buildGeometrySelect(config, includeGeometry, primaryGeom, "geometry"));
        selectParts.push(Prisma.sql`,`);
    } else {
        selectParts.push(Prisma.sql`NULL::json AS geometry,`);
    }

    const secondaryGeom = config.geometryColumns.secondary;
    if (secondaryGeom !== undefined) {
        selectParts.push(buildGeometrySelect(config, includeGeometry, secondaryGeom, "centroid"));
    } else if (primaryGeom !== undefined && config.routeFamily === "places") {
        selectParts.push(buildGeometrySelect(config, includeGeometry, primaryGeom, "centroid"));
    } else if (primaryGeom !== undefined && config.routeFamily === "roads") {
        selectParts.push(buildGeometrySelect(config, includeGeometry, primaryGeom, "centroid"));
    } else {
        selectParts.push(Prisma.sql`NULL::json AS centroid`);
    }

    if (config.roadClassJoin) {
        selectParts.push(
            Prisma.sql`,`,
            Prisma.sql`${colRef(config, "road_class_id")} AS road_candidate_road_class_id,`,
            Prisma.sql`${colRef(config, "surface")} AS road_candidate_surface,`,
            Prisma.sql`${colRef(config, "is_oneway")} AS road_candidate_is_oneway,`,
            Prisma.sql`COALESCE(rc.code, ${colRef(config, "road_class")}) AS road_candidate_class_label,`,
            Prisma.sql`${effectiveRoadLengthMExpr(config.tableAlias)} AS length_m`
        );
        if (config.effectiveAdminAreaJoin) {
            selectParts.push(
                Prisma.sql`,`,
                Prisma.sql`${roadResolvedAdminAreaIdExpr(config.tableAlias)} AS admin_area_id,`,
                Prisma.sql`${roadResolvedAdminAreaNameExpr()} AS admin_area_name,`,
                Prisma.sql`${roadResolvedAdminAreaNameExpr()} AS effective_admin_area_name`
            );
        }
    }

    if (config.buildingTypeJoin) {
        selectParts.push(
            Prisma.sql`,`,
            Prisma.sql`bt.code AS building_type_code,`,
            Prisma.sql`bt.name AS building_type_name`
        );
    }

    if (config.landuseClassJoin) {
        selectParts.push(
            Prisma.sql`,`,
            Prisma.sql`lc.code AS landuse_class_code,`,
            Prisma.sql`lc.name_en AS landuse_class_name,`,
            Prisma.sql`lc.name_mm AS landuse_class_name_mm`
        );
    }

    if (config.routeFamily === "bus_stops") {
        selectParts.push(
            Prisma.sql`,`,
            Prisma.sql`${busStopNameMmExpr(config.tableAlias)} AS name_mm,`,
            Prisma.sql`${busStopNameEnExpr(config.tableAlias)} AS name_en,`,
            Prisma.sql`${colRef(config, "stop_code")} AS stop_code`
        );
    }

    if (config.routeFamily === "addresses") {
        selectParts.push(
            Prisma.sql`,`,
            Prisma.sql`${colRef(config, "source_entity_type")} AS source_entity_type,`,
            Prisma.sql`COALESCE(to_jsonb(${colRef(config, "source_tags")}), '{}'::jsonb) AS source_tags,`,
            Prisma.sql`${colRef(config, "validation_status")} AS validation_status,`,
            Prisma.sql`COALESCE(to_jsonb(${colRef(config, "promotion_blockers")}), '[]'::jsonb) AS promotion_blockers,`,
            Prisma.sql`COALESCE(to_jsonb(${colRef(config, "promotion_warnings")}), '[]'::jsonb) AS promotion_warnings,`,
            Prisma.sql`${colRef(config, "validated_at")} AS validated_at,`,
            Prisma.sql`${colRef(config, "matched_admin_area_id")} AS matched_admin_area_id,`,
            Prisma.sql`${colRef(config, "matched_street_id")} AS matched_street_id,`,
            Prisma.sql`${colRef(config, "matched_building_id")} AS matched_building_id,`,
            Prisma.sql`${colRef(config, "matched_place_id")} AS matched_place_id,`,
            Prisma.sql`${colRef(config, "admin_match_type")} AS admin_match_type,`,
            Prisma.sql`${colRef(config, "street_match_type")} AS street_match_type,`,
            Prisma.sql`${colRef(config, "admin_match_confidence")} AS admin_match_confidence,`,
            Prisma.sql`${colRef(config, "street_match_confidence")} AS street_match_confidence,`,
            Prisma.sql`${colRef(config, "promoted_core_address_id")} AS promoted_core_address_id`
        );
    }

    if (config.effectiveAdminAreaJoin && config.routeFamily !== "roads") {
        selectParts.push(
            Prisma.sql`,`,
            Prisma.sql`eff_aa.canonical_name AS effective_admin_area_name`
        );
    }

    return Prisma.join(selectParts, " ");
}

export function buildCandidateFromClause(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const adminJoin =
        config.effectiveAdminAreaJoin && config.routeFamily === "roads"
            ? buildRoadAdminAreaJoins(config.tableAlias)
            : config.effectiveAdminAreaJoin
              ? Prisma.sql`
                    LEFT JOIN core.core_admin_areas AS eff_aa
                        ON eff_aa.id = ${effectiveAdminAreaIdExpr(config.tableAlias)}
                `
              : Prisma.empty;

    if (config.roadClassJoin && config.buildingTypeJoin) {
        return Prisma.sql`
            ${tableFrom(config)}
            LEFT JOIN ref.ref_road_classes AS rc ON rc.id = ${colRef(config, "road_class_id")}
            LEFT JOIN ref.ref_building_types AS bt ON bt.id = ${effectiveBuildingTypeIdExpr(config)}
            ${adminJoin}
        `;
    }
    if (config.roadClassJoin) {
        return Prisma.sql`
            ${tableFrom(config)}
            LEFT JOIN ref.ref_road_classes AS rc ON rc.id = ${colRef(config, "road_class_id")}
            ${adminJoin}
        `;
    }
    if (config.buildingTypeJoin) {
        return Prisma.sql`
            ${tableFrom(config)}
            LEFT JOIN ref.ref_building_types AS bt ON bt.id = ${effectiveBuildingTypeIdExpr(config)}
            ${adminJoin}
        `;
    }
    if (config.landuseClassJoin) {
        return Prisma.sql`
            ${tableFrom(config)}
            LEFT JOIN ref.ref_landuse_classes AS lc ON lc.id = ${effectiveLanduseClassIdExpr(config)}
            ${adminJoin}
        `;
    }
    if (config.effectiveAdminAreaJoin) {
        return Prisma.sql`
            ${tableFrom(config)}
            ${adminJoin}
        `;
    }
    return tableFrom(config);
}

/** SELECT list + FROM for rows returned after PATCH overrides (includes ref joins). */
export function buildCandidateRowQueryParts(
    config: ImportReviewEntityFamilyConfig,
    includeGeometry: boolean
): { select: Prisma.Sql; from: Prisma.Sql } {
    return {
        select: buildCandidateCommonSelect(config, includeGeometry),
        from: buildCandidateFromClause(config),
    };
}

export function buildCandidateListQueryParts(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint,
    filters: CandidateListFilters
): {
    select: Prisma.Sql;
    from: Prisma.Sql;
    where: Prisma.Sql;
    orderBy: Prisma.Sql;
} {
    const includeGeometry = filters.include_geometry ?? false;
    return {
        select: buildCandidateCommonSelect(config, includeGeometry),
        from: buildCandidateFromClause(config),
        where: buildCandidateWhereClause(config, reviewBatchId, filters),
        orderBy: buildCandidateOrderBy(config, filters.sort ?? config.defaultSort),
    };
}

export function buildSummaryAggregationSql(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint
): Prisma.Sql {
    return Prisma.sql`
        SELECT
            ${config.entityFamily}::text AS entity_family,
            c.review_batch_id,
            c.source_snapshot_version,
            c.match_status,
            c.auto_action,
            c.review_status,
            c.review_decision,
            c.promotion_status,
            count(*)::bigint AS row_count
        FROM ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS c
        WHERE c.review_batch_id = ${reviewBatchId} AND c.entity_family = ${config.entityFamily}
        GROUP BY
            c.review_batch_id,
            c.source_snapshot_version,
            c.match_status,
            c.auto_action,
            c.review_status,
            c.review_decision,
            c.promotion_status
    `;
}

export function buildFilterOptionsColumnSql(
    config: ImportReviewEntityFamilyConfig,
    field: ImportReviewEntityFamilyConfig["filterFields"][number]
): Prisma.Sql {
    return colRef(config, field);
}

export function buildBulkModeBWhere(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint,
    filters: ImportReviewBulkFilters
): Prisma.Sql {
    const parts: Prisma.Sql[] = [
        Prisma.sql`(${colRef(config, "review_batch_id")} = ${reviewBatchId} AND ${colRef(config, "entity_family")} = ${config.entityFamily})`,
    ];

    if (filters.match_status !== undefined) {
        parts.push(Prisma.sql`${colRef(config, "match_status")} = ${filters.match_status}`);
    }
    if (filters.auto_action !== undefined) {
        parts.push(Prisma.sql`${colRef(config, "auto_action")} = ${filters.auto_action}`);
    }
    if (filters.review_decision === null) {
        parts.push(Prisma.sql`${colRef(config, "review_decision")} IS NULL`);
    } else if (filters.review_decision !== undefined) {
        parts.push(Prisma.sql`${colRef(config, "review_decision")} = ${filters.review_decision}`);
    }

    return Prisma.join(parts, " AND ");
}

export function buildBulkUpdateSetClause(args: {
    reviewDecision: string;
    reviewStatus: string;
    reviewedByUserId: bigint | null;
    reviewNote: string | null | undefined;
}): Prisma.Sql {
    const sets: Prisma.Sql[] = [
        Prisma.sql`review_decision = ${args.reviewDecision}`,
        Prisma.sql`review_status = ${args.reviewStatus}`,
        Prisma.sql`reviewed_at = now()`,
        Prisma.sql`updated_at = now()`,
    ];
    if (args.reviewedByUserId !== null) {
        sets.push(Prisma.sql`reviewed_by = ${args.reviewedByUserId}`);
    } else {
        sets.push(Prisma.sql`reviewed_by = NULL`);
    }

    if (args.reviewNote !== undefined) {
        sets.push(Prisma.sql`review_note = ${args.reviewNote}`);
    }

    return Prisma.join(sets, ", ");
}

export function buildBulkClassifyCaseSql(force: boolean, reviewDecision: string): Prisma.Sql {
    return Prisma.sql`
        CASE
            WHEN promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
            WHEN (match_status = 'manual_protected' OR auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
            WHEN match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
            WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                match_status = 'new_auto' AND auto_action = 'insert_candidate'
            ) THEN 'ineligible_bulk_approval'
            ELSE 'eligible'
        END
    `;
}

export function buildBulkJoinedClassifyCaseSql(
    alias: string,
    force: boolean,
    reviewDecision: string
): Prisma.Sql {
    return Prisma.sql`
        CASE
            WHEN ${Prisma.raw(alias)}.id IS NULL THEN 'not_found'
            WHEN ${Prisma.raw(alias)}.promotion_status = 'promoted' AND NOT ${force} THEN 'skipped_promoted'
            WHEN (${Prisma.raw(alias)}.match_status = 'manual_protected' OR ${Prisma.raw(alias)}.auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
            WHEN ${Prisma.raw(alias)}.match_status = 'duplicate_candidate' AND NOT ${force} THEN 'skipped_duplicate_candidate'
            WHEN ${reviewDecision} = 'approved' AND NOT ${force} AND NOT (
                ${Prisma.raw(alias)}.match_status = 'new_auto' AND ${Prisma.raw(alias)}.auto_action = 'insert_candidate'
            ) THEN 'ineligible_bulk_approval'
            ELSE 'eligible'
        END
    `;
}

export function sqlBigintArray(ids: bigint[]): Prisma.Sql {
    return Prisma.sql`ARRAY[${Prisma.join(
        ids.map((id) => Prisma.sql`${id}`),
        ", "
    )}]::bigint[]`;
}

export function buildCandidateUpdateReturningSelect(
    config: ImportReviewEntityFamilyConfig
): Prisma.Sql {
    return buildCandidateCommonSelect(config, true);
}

export function buildCandidateScopeWhere(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint,
    id: bigint
): Prisma.Sql {
    return Prisma.sql`${colRef(config, "id")} = ${id} AND (${colRef(config, "review_batch_id")} = ${reviewBatchId} AND ${colRef(config, "entity_family")} = ${config.entityFamily})`;
}

export { tableFrom, colRef, qual };
