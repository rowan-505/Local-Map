import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";
import {
    colRef,
    shapeColumn,
} from "./import-review-candidate-sql.js";
import { useLightweightImportReviewList } from "./import-review-list-query-contract.js";
import {
    buildBuildingLightweightListExtensionSelect,
    buildBuildingLightweightListFromClause,
} from "./import-review-list-query-building.js";
import {
    buildGenericLightweightListExtensionSelect,
    buildGenericLightweightListFromClause,
} from "./import-review-list-query-family.js";
import {
    buildRoadLightweightListExtensionSelect,
    buildRoadLightweightListFromClause,
} from "./import-review-list-query-road.js";

function tableAlias(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    return Prisma.raw(config.tableAlias);
}

/**
 * Shared lightweight list core — identity, display label, status, timestamps.
 * Excludes geom, GeoJSON, normalized_data, source_refs, source_tags, raw_payload, validation JSON.
 */
export function buildLightweightListCoreSelect(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const a = tableAlias(config);

    return Prisma.sql`
        ${a}.id,
        ${a}.public_id::text AS public_id,
        ${a}.review_batch_id,
        ${a}.source_snapshot_version,
        ${a}.local_staging_id,
        ${a}.source_snapshot_id_local,
        ${a}.external_id,
        ${a}.canonical_name,
        ${shapeColumn(config, "name", "text")} AS name,
        ${a}.class_code,
        ${a}.confidence_score,
        ${a}.match_status,
        ${a}.auto_action,
        ${a}.review_status,
        ${a}.review_decision,
        ${a}.reviewed_by::text AS reviewed_by,
        ${a}.reviewed_at,
        ${a}.review_note,
        '{}'::jsonb AS normalized_data,
        '{}'::jsonb AS source_refs,
        ${a}.matched_core_id,
        ${a}.matched_core_table,
        '{}'::jsonb AS matched_core_data,
        '{}'::jsonb AS f2_comparison,
        '[]'::jsonb AS validation_warnings,
        '[]'::jsonb AS validation_errors,
        ${a}.promotion_status,
        ${a}.promoted_core_id,
        ${a}.created_at,
        ${a}.updated_at,
        NULL::json AS geometry,
        NULL::json AS centroid
    `;
}

function buildLightweightListExtensionSelect(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    if (config.routeFamily === "roads") {
        return buildRoadLightweightListExtensionSelect(config);
    }
    if (config.routeFamily === "buildings") {
        return buildBuildingLightweightListExtensionSelect(config);
    }
    return buildGenericLightweightListExtensionSelect(config);
}

export function buildLightweightListSelect(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const extension = buildLightweightListExtensionSelect(config);
    const flags =
        config.routeFamily === "roads"
            ? Prisma.sql`, true AS is_road_list_projection, true AS is_list_projection`
            : config.routeFamily === "buildings"
              ? Prisma.sql`, true AS is_building_list_projection, true AS is_list_projection`
              : Prisma.sql`, true AS is_list_projection`;

    return Prisma.sql`${buildLightweightListCoreSelect(config)}${extension}${flags}`;
}

export function buildLightweightListFromClause(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    if (config.routeFamily === "roads") {
        return buildRoadLightweightListFromClause(config);
    }
    if (config.routeFamily === "buildings") {
        return buildBuildingLightweightListFromClause(config);
    }
    return buildGenericLightweightListFromClause(config);
}

export function shouldUseLightweightListQuery(
    config: ImportReviewEntityFamilyConfig,
    includeGeometry: boolean
): boolean {
    return useLightweightImportReviewList(config, includeGeometry);
}

/** @deprecated Use buildLightweightListSelect — kept for transitional imports. */
export const buildGenericCandidateListSelect = buildLightweightListSelect;
/** @deprecated Use buildLightweightListFromClause */
export const buildGenericCandidateListFromClause = buildLightweightListFromClause;
/** @deprecated Use buildLightweightListSelect */
export const buildBuildingCandidateListSelect = buildLightweightListSelect;
/** @deprecated Use buildLightweightListFromClause */
export const buildBuildingCandidateListFromClause = buildLightweightListFromClause;
/** @deprecated Use buildLightweightListSelect */
export const buildRoadCandidateListSelect = buildLightweightListSelect;
/** @deprecated Use buildLightweightListFromClause */
export const buildRoadCandidateListFromClause = buildLightweightListFromClause;
