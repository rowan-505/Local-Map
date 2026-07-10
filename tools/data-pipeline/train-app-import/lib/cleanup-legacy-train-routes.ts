/**
 * Plan and apply soft-delete cleanup for marked legacy train network rows.
 */

import {
    TRAIN_IMPORT_GENERATION,
    TRAIN_LEGACY_GENERATION,
    TRAIN_MODE,
} from "./train-import-constants.js";
import type { LegacyTrainEntityRow } from "./mark-legacy-train-data.js";

export type LegacyTrainCleanupPlan = {
    routes: LegacyTrainEntityRow[];
    variants: LegacyTrainEntityRow[];
    paths: LegacyTrainEntityRow[];
};

export type LegacyTrainCleanupResult = {
    dry_run: boolean;
    committed: boolean;
    refused: boolean;
    refusal_reason: string | null;
    new_train_route_exists: boolean;
    routes_affected: number;
    variants_affected: number;
    paths_affected: number;
    route_codes: string[];
    plan: LegacyTrainCleanupPlan;
};

export function isEligibleLegacyCleanupGeneration(generation: string | null | undefined): boolean {
    return (generation ?? "").trim() === TRAIN_LEGACY_GENERATION;
}

export function isEligibleLegacyCleanupSourceRefs(
    sourceRefs: Record<string, unknown> | null | undefined,
): boolean {
    const flag = sourceRefs?.legacy_flag;
    return flag === true || flag === "true";
}

export function isEligibleLegacyCleanupRow(
    sourceRefs: Record<string, unknown> | null | undefined,
    generation: string | null | undefined,
): boolean {
    return (
        isEligibleLegacyCleanupSourceRefs(sourceRefs) &&
        isEligibleLegacyCleanupGeneration(generation)
    );
}

export function summarizeLegacyCleanupPlan(plan: LegacyTrainCleanupPlan): {
    routes_affected: number;
    variants_affected: number;
    paths_affected: number;
    route_codes: string[];
} {
    return {
        routes_affected: plan.routes.length,
        variants_affected: plan.variants.length,
        paths_affected: plan.paths.length,
        route_codes: plan.routes.map((row) => row.code).sort((a, b) => a.localeCompare(b)),
    };
}

export function runCleanupLegacyTrainRoutesSelfTest(): void {
    if (!isEligibleLegacyCleanupGeneration(TRAIN_LEGACY_GENERATION)) {
        throw new Error("pre_simple_train_import should be eligible");
    }
    if (isEligibleLegacyCleanupGeneration(TRAIN_IMPORT_GENERATION)) {
        throw new Error("simple_train_system_v1 should not be eligible");
    }
    if (!isEligibleLegacyCleanupSourceRefs({ legacy_flag: true })) {
        throw new Error("legacy_flag true should be eligible");
    }
    if (isEligibleLegacyCleanupSourceRefs({ legacy_flag: false })) {
        throw new Error("legacy_flag false should not be eligible");
    }
    if (
        !isEligibleLegacyCleanupRow(
            { legacy_flag: true },
            TRAIN_LEGACY_GENERATION,
        )
    ) {
        throw new Error("full legacy row should be eligible");
    }
    console.log("ok - cleanup-legacy-train-routes self-test");
}

export const NEW_TRAIN_ROUTE_EXISTS_SQL = `
    SELECT EXISTS (
        SELECT 1
        FROM transport.routes AS r
        WHERE r.mode = $1
          AND r.deleted_at IS NULL
          AND r.normalized_data->>'generation' = $2
    ) AS exists
`;

export const LEGACY_CLEANUP_TRAIN_ROUTE_SQL = `
    SELECT
        r.id::text,
        r.route_code AS code,
        r.review_status,
        r.is_active,
        r.normalized_data->>'generation' AS generation
    FROM transport.routes AS r
    WHERE r.mode = $1
      AND r.deleted_at IS NULL
      AND r.source_refs @> '{"legacy_flag": true}'::jsonb
      AND r.normalized_data->>'generation' = $2
    ORDER BY r.route_code
`;

export const LEGACY_CLEANUP_TRAIN_VARIANT_SQL = `
    SELECT
        v.id::text,
        v.variant_code AS code,
        v.review_status,
        v.is_active,
        v.normalized_data->>'generation' AS generation
    FROM transport.route_variants AS v
    INNER JOIN transport.routes AS r ON r.id = v.route_id
    WHERE r.mode = $1
      AND v.deleted_at IS NULL
      AND r.deleted_at IS NULL
      AND v.source_refs @> '{"legacy_flag": true}'::jsonb
      AND v.normalized_data->>'generation' = $2
    ORDER BY v.variant_code
`;

export const LEGACY_CLEANUP_TRAIN_PATH_SQL = `
    SELECT
        p.id::text,
        COALESCE(v.variant_code, p.path_kind, p.id::text) AS code,
        p.review_status,
        p.is_active,
        p.normalized_data->>'generation' AS generation
    FROM transport.route_paths AS p
    INNER JOIN transport.route_variants AS v ON v.id = p.route_variant_id
    INNER JOIN transport.routes AS r ON r.id = v.route_id
    WHERE r.mode = $1
      AND p.deleted_at IS NULL
      AND v.deleted_at IS NULL
      AND r.deleted_at IS NULL
      AND p.source_refs @> '{"legacy_flag": true}'::jsonb
      AND p.normalized_data->>'generation' = $2
    ORDER BY p.id
`;

export const SOFT_DELETE_LEGACY_TRAIN_PATH_SQL = `
    UPDATE transport.route_paths AS p
    SET
        deleted_at = now(),
        is_active = false,
        updated_at = now()
    WHERE p.id = ANY($1::bigint[])
      AND p.deleted_at IS NULL
      AND p.source_refs @> '{"legacy_flag": true}'::jsonb
      AND p.normalized_data->>'generation' = '${TRAIN_LEGACY_GENERATION}'
`;

export const SOFT_DELETE_LEGACY_TRAIN_VARIANT_SQL = `
    UPDATE transport.route_variants AS v
    SET
        deleted_at = now(),
        is_active = false,
        updated_at = now()
    WHERE v.id = ANY($1::bigint[])
      AND v.deleted_at IS NULL
      AND v.source_refs @> '{"legacy_flag": true}'::jsonb
      AND v.normalized_data->>'generation' = '${TRAIN_LEGACY_GENERATION}'
`;

export const SOFT_DELETE_LEGACY_TRAIN_ROUTE_SQL = `
    UPDATE transport.routes AS r
    SET
        deleted_at = now(),
        is_active = false,
        updated_at = now()
    WHERE r.id = ANY($1::bigint[])
      AND r.mode = '${TRAIN_MODE}'
      AND r.deleted_at IS NULL
      AND r.source_refs @> '{"legacy_flag": true}'::jsonb
      AND r.normalized_data->>'generation' = '${TRAIN_LEGACY_GENERATION}'
`;
