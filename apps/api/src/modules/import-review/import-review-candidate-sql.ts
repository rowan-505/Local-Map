import { Prisma } from "@prisma/client";

import { importReviewCandidateTableHasColumn } from "./import-review-candidate-column-registry.js";
import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";
import { ImportReviewDecisionRuleError } from "./import-review-errors.js";
import { effectiveAdminAreaIdExpr } from "./import-review-effective-values.js";
import {
    buildRoadAdminAreaJoins,
    roadResolvedAdminAreaIdExpr,
    roadResolvedAdminAreaNameExpr,
} from "./import-review-road-admin-area-sql.js";
import {
    buildLightweightListFromClause,
    buildLightweightListSelect,
    shouldUseLightweightListQuery,
} from "./import-review-list-query.js";
import { effectiveRoadLengthMExpr } from "./import-review-promotion-promote-sql.js";
import {
    buildDefaultActivePromotionWhereClause,
    buildPromotionStateWhereClause,
    buildRetryNeededWhereClause,
    promotionListExtrasSelect,
    type ImportReviewPromotionStateFilter,
} from "./import-review-promotion-candidate-list-sql.js";
import {
    matchStatusStorageValuesForFilter,
    promotionStatusStorageValuesForFilter,
} from "./import-review-status-model.js";

export type { ImportReviewPromotionStateFilter };
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
    retry_needed?: boolean | undefined;
    promotion_state?: ImportReviewPromotionStateFilter | undefined;
    q?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    sort?: ImportReviewBuildingSort | undefined;
    include_geometry?: boolean | undefined;
    /** When false, list query skips COUNT(*) (use has_more from limit+1 fetch). */
    include_total?: boolean | undefined;
};

function colRef(config: ImportReviewEntityFamilyConfig, column: string): Prisma.Sql {
    return Prisma.raw(`${config.tableAlias}.${column}`);
}

/** UPDATE SET target column (must not be alias-qualified). */
export function updateSetColumn(column: string): Prisma.Sql {
    return Prisma.raw(column);
}

export function buildUpdateColumnAssignment(column: string, value: unknown): Prisma.Sql {
    if (value === null || value === undefined) {
        return Prisma.sql`${updateSetColumn(column)} = NULL`;
    }

    if (BIGINT_SET_COLUMNS.has(column)) {
        const normalized = normalizeBigintPatchValue(column, value);
        return Prisma.sql`${updateSetColumn(column)} = ${normalized}::bigint`;
    }

    if (INTEGER_SET_COLUMNS.has(column)) {
        const normalized = normalizeIntegerPatchValue(column, value);
        return Prisma.sql`${updateSetColumn(column)} = ${normalized}::integer`;
    }

    if (NUMERIC_SET_COLUMNS.has(column)) {
        const normalized = normalizeNumericPatchValue(column, value);
        return Prisma.sql`${updateSetColumn(column)} = ${normalized}::numeric`;
    }

    if (BOOLEAN_SET_COLUMNS.has(column)) {
        const normalized = normalizeBooleanPatchValue(column, value);
        return Prisma.sql`${updateSetColumn(column)} = ${normalized}::boolean`;
    }

    if (JSONB_SET_COLUMNS.has(column)) {
        return Prisma.sql`${updateSetColumn(column)} = ${JSON.stringify(value)}::jsonb`;
    }

    return Prisma.sql`${updateSetColumn(column)} = ${value}`;
}

const BIGINT_SET_COLUMNS = new Set([
    "admin_area_id",
    "category_id",
    "building_type_id",
    "road_class_id",
    "landuse_class_id",
    "admin_level_id",
    "parent_id",
    "street_id",
    "route_id",
    "route_variant_id",
    "stop_id",
]);

const INTEGER_SET_COLUMNS = new Set(["layer", "levels", "stop_sequence"]);

const NUMERIC_SET_COLUMNS = new Set([
    "speed_kph",
    "confidence_score",
    "importance_score",
    "popularity_score",
    "height_m",
    "length_m",
    "distance_m",
    "distance_from_start_m",
]);

const BOOLEAN_SET_COLUMNS = new Set([
    "is_oneway",
    "bridge",
    "tunnel",
    "intermittent",
    "is_timing_point",
]);

const JSONB_SET_COLUMNS = new Set(["validation_warnings", "validation_errors"]);

function normalizeBigintPatchValue(column: string, value: unknown): bigint {
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (/^-?\d+$/.test(trimmed)) {
            return BigInt(trimmed);
        }
    }
    throw new ImportReviewDecisionRuleError(
        `fields.${column} must be an integer-compatible id or null.`
    );
}

function normalizeIntegerPatchValue(column: string, value: unknown): number {
    if (typeof value === "number" && Number.isInteger(value)) {
        return value;
    }
    if (typeof value === "bigint") {
        const asNumber = Number(value);
        if (Number.isSafeInteger(asNumber)) {
            return asNumber;
        }
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (/^-?\d+$/.test(trimmed)) {
            const asNumber = Number(trimmed);
            if (Number.isSafeInteger(asNumber)) {
                return asNumber;
            }
        }
    }
    throw new ImportReviewDecisionRuleError(
        `fields.${column} must be an integer or null.`
    );
}

function normalizeNumericPatchValue(column: string, value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
            const asNumber = Number(trimmed);
            if (Number.isFinite(asNumber)) {
                return asNumber;
            }
        }
    }
    throw new ImportReviewDecisionRuleError(
        `fields.${column} must be a numeric value or null.`
    );
}

function normalizeBooleanPatchValue(column: string, value: unknown): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        if (value === 1) {
            return true;
        }
        if (value === 0) {
            return false;
        }
    }
    if (typeof value === "string") {
        const trimmed = value.trim().toLowerCase();
        if (trimmed === "true" || trimmed === "1") {
            return true;
        }
        if (trimmed === "false" || trimmed === "0") {
            return false;
        }
    }
    throw new ImportReviewDecisionRuleError(
        `fields.${column} must be a boolean or null.`
    );
}

function qual(config: ImportReviewEntityFamilyConfig, expr: string): Prisma.Sql {
    return Prisma.raw(`${config.tableAlias}.${expr}`);
}

function tableFrom(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    return Prisma.sql`${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(config.tableAlias)}`;
}

export function shapeColumn(
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

/** Typed candidate column in SELECT, or NULL when the table has no such column. */
export function optionalTypedCandidateColumn(
    config: ImportReviewEntityFamilyConfig,
    column: string,
    sqlType: string
): Prisma.Sql {
    if (!importReviewCandidateTableHasColumn(config.importReviewTable, column)) {
        return Prisma.raw(`NULL::${sqlType}`);
    }
    return colRef(config, column);
}

/**
 * Lightweight list: typed reviewer name columns from DB only (not coalesced with normalized_data).
 * Typed direct-edit columns win over source/legacy names — docs/import-review/naming-contract.md.
 */
export function buildLightweightTypedNameColumns(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    if (
        !importReviewCandidateTableHasColumn(config.importReviewTable, "name_mm") &&
        !importReviewCandidateTableHasColumn(config.importReviewTable, "name_en")
    ) {
        return Prisma.empty;
    }
    return Prisma.sql`
        , ${optionalTypedCandidateColumn(config, "name_mm", "text")} AS name_mm
        , ${optionalTypedCandidateColumn(config, "name_en", "text")} AS name_en
    `;
}

/** Effective FK from typed building_type_id column. */
export function effectiveBuildingTypeIdExpr(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    return shapeColumn(config, "building_type_id", "bigint");
}

/** Effective FK from typed landuse_class_id column. */
export function effectiveLanduseClassIdExpr(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    return shapeColumn(config, "landuse_class_id", "bigint");
}

function buildSearchClause(config: ImportReviewEntityFamilyConfig, q: string): Prisma.Sql {
    const pattern = `%${q}%`;
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

    if (supportsPromotionFilter && filters.promotion_status === undefined) {
        if (filters.promotion_state !== undefined) {
            parts.push(buildPromotionStateWhereClause(config, reviewBatchId, filters.promotion_state));
        } else if (filters.retry_needed === true) {
            parts.push(buildRetryNeededWhereClause(config, reviewBatchId));
        } else if (filters.include_promoted === true) {
            // Legacy: show all statuses (no default active/promoted exclusion).
        } else {
            parts.push(buildDefaultActivePromotionWhereClause(config, reviewBatchId));
        }
    }

    if (filters.match_status !== undefined) {
        const values = matchStatusStorageValuesForFilter(filters.match_status);
        if (values.length === 1) {
            parts.push(Prisma.sql`${colRef(config, "match_status")} = ${values[0]}`);
        } else {
            parts.push(
                Prisma.sql`${colRef(config, "match_status")} IN (${Prisma.join(
                    values.map((v) => Prisma.sql`${v}`)
                )})`
            );
        }
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
        if (
            filters.review_decision === UNREVIEWED ||
            filters.review_decision.trim().toLowerCase() === "pending"
        ) {
            parts.push(
                Prisma.sql`(${colRef(config, "review_decision")} IS NULL OR trim(${colRef(config, "review_decision")}) = '' OR ${colRef(config, "review_decision")} = 'pending')`
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
            const values = promotionStatusStorageValuesForFilter(filters.promotion_status);
            if (values.length === 1) {
                parts.push(Prisma.sql`${colRef(config, "promotion_status")} = ${values[0]}`);
            } else {
                parts.push(
                    Prisma.sql`${colRef(config, "promotion_status")} IN (${Prisma.join(
                        values.map((v) => Prisma.sql`${v}`)
                    )})`
                );
            }
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

export function buildGeometrySelect(
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
    includeGeometry: boolean,
    reviewBatchId?: bigint
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
        Prisma.sql`${optionalTypedCandidateColumn(config, "name_mm", "text")} AS name_mm,`,
        Prisma.sql`${optionalTypedCandidateColumn(config, "name_en", "text")} AS name_en,`,
        Prisma.sql`${optionalTypedCandidateColumn(config, "category_id", "bigint")} AS category_id,`,
        Prisma.sql`${optionalTypedCandidateColumn(config, "primary_name", "text")} AS primary_name,`,
        Prisma.sql`${optionalTypedCandidateColumn(config, "display_name", "text")} AS display_name,`,
        Prisma.sql`${optionalTypedCandidateColumn(config, "barrier_type", "text")} AS barrier_type,`,
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
            Prisma.sql`${colRef(config, "road_class")} AS road_class,`,
            Prisma.sql`rc.name AS road_class_name,`,
            Prisma.sql`COALESCE(rc.name, rc.code, ${colRef(config, "road_class")}) AS road_class_label,`,
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

    if (reviewBatchId != null) {
        selectParts.push(promotionListExtrasSelect(config, reviewBatchId));
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
            Prisma.sql`${colRef(config, "source_classification")} AS source_classification,`,
            Prisma.sql`${colRef(config, "has_place_evidence")} AS has_place_evidence,`,
            Prisma.sql`${colRef(config, "has_address_evidence")} AS has_address_evidence,`,
            Prisma.sql`${colRef(config, "address_strength")} AS address_strength,`,
            Prisma.sql`${colRef(config, "place_candidate_status")} AS place_candidate_status,`,
            Prisma.sql`${colRef(config, "linked_place_candidate_id")} AS linked_place_candidate_id,`,
            Prisma.sql`${colRef(config, "matched_core_place_id")} AS matched_core_place_id,`,
            Prisma.sql`COALESCE(to_jsonb(${colRef(config, "classification_reasons")}), '[]'::jsonb) AS classification_reasons,`,
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
    const lightweightList = shouldUseLightweightListQuery(config, includeGeometry);

    return {
        select: lightweightList
            ? buildLightweightListSelect(config, reviewBatchId)
            : buildCandidateCommonSelect(config, includeGeometry, reviewBatchId),
        from: lightweightList ? buildLightweightListFromClause(config) : buildCandidateFromClause(config),
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
            WHEN promotion_status IN ('promoted', 'applied') AND NOT ${force} THEN 'skipped_promoted'
            WHEN (match_status IN ('manual_protected') OR auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
            WHEN match_status IN ('duplicate', 'duplicate_candidate') AND NOT ${force} THEN 'skipped_duplicate_candidate'
            WHEN ${reviewDecision} IN ('approved', 'replace_existing', 'merge_fields', 'insert_separate', 'confirm_soft_delete')
                 AND NOT ${force} AND NOT (
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
            WHEN ${Prisma.raw(alias)}.promotion_status IN ('promoted', 'applied') AND NOT ${force} THEN 'skipped_promoted'
            WHEN (${Prisma.raw(alias)}.match_status IN ('manual_protected') OR ${Prisma.raw(alias)}.auto_action = 'protect_manual') AND NOT ${force} THEN 'skipped_manual_protected'
            WHEN ${Prisma.raw(alias)}.match_status IN ('duplicate', 'duplicate_candidate') AND NOT ${force} THEN 'skipped_duplicate_candidate'
            WHEN ${reviewDecision} IN ('approved', 'replace_existing', 'merge_fields', 'insert_separate', 'confirm_soft_delete')
                 AND NOT ${force} AND NOT (
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
