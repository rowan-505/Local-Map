/**
 * Plan and apply legacy marking for pre-simple-train train network rows.
 */

import {
    TRAIN_IMPORT_GENERATION,
    TRAIN_LEGACY_GENERATION,
    TRAIN_LEGACY_GROUP,
    TRAIN_LEGACY_REVIEW_STATUS,
    TRAIN_MODE,
    resolveLegacyMarkReviewStatus,
} from "./train-import-constants.js";

export type LegacyTrainEntityRow = {
    id: number;
    code: string;
    review_status: string;
    is_active: boolean;
    generation: string | null;
};

export type LegacyTrainMarkPlan = {
    routes: LegacyTrainEntityRow[];
    variants: LegacyTrainEntityRow[];
    paths: LegacyTrainEntityRow[];
};

export type LegacyTrainMarkResult = {
    dry_run: boolean;
    committed: boolean;
    routes_affected: number;
    variants_affected: number;
    paths_affected: number;
    plan: LegacyTrainMarkPlan;
};

export function generationFromJson(data: Record<string, unknown> | null | undefined): string | null {
    const value = data?.generation;
    return typeof value === "string" ? value : null;
}

export function isLegacyTrainRouteCandidate(generation: string | null): boolean {
    return generation !== TRAIN_IMPORT_GENERATION;
}

export function buildLegacyMarkPatch(currentReviewStatus: string): {
    review_status: string;
    source_refs_patch: Record<string, unknown>;
    normalized_data_patch: Record<string, unknown>;
} {
    return {
        review_status: resolveLegacyMarkReviewStatus(currentReviewStatus),
        source_refs_patch: {
            legacy_flag: true,
            legacy_group: TRAIN_LEGACY_GROUP,
        },
        normalized_data_patch: {
            generation: TRAIN_LEGACY_GENERATION,
        },
    };
}

export function summarizeLegacyMarkPlan(plan: LegacyTrainMarkPlan): {
    routes_affected: number;
    variants_affected: number;
    paths_affected: number;
} {
    return {
        routes_affected: plan.routes.length,
        variants_affected: plan.variants.length,
        paths_affected: plan.paths.length,
    };
}

export function runMarkLegacyTrainDataSelfTest(): void {
    if (!isLegacyTrainRouteCandidate(null)) {
        throw new Error("null generation should be legacy");
    }
    if (isLegacyTrainRouteCandidate(TRAIN_IMPORT_GENERATION)) {
        throw new Error("simple_train_system_v1 should not be legacy");
    }
    if (resolveLegacyMarkReviewStatus("verified") !== "verified") {
        throw new Error("verified should stay verified");
    }
    if (resolveLegacyMarkReviewStatus("reviewed") !== TRAIN_LEGACY_REVIEW_STATUS) {
        throw new Error("reviewed should become needs_review");
    }
    const patch = buildLegacyMarkPatch("imported_unreviewed");
    if (patch.normalized_data_patch.generation !== TRAIN_LEGACY_GENERATION) {
        throw new Error("legacy generation patch mismatch");
    }
    console.log("ok - mark-legacy-train-data self-test");
}

export const LEGACY_TRAIN_ROUTE_SQL = `
    SELECT
        r.id::text,
        r.route_code AS code,
        r.review_status,
        r.is_active,
        r.normalized_data->>'generation' AS generation
    FROM transport.routes AS r
    WHERE r.mode = $1
      AND r.deleted_at IS NULL
      AND COALESCE(r.normalized_data->>'generation', '') <> $2
    ORDER BY r.route_code
`;

export const LEGACY_TRAIN_VARIANT_SQL = `
    SELECT
        v.id::text,
        v.variant_code AS code,
        v.review_status,
        v.is_active,
        v.normalized_data->>'generation' AS generation
    FROM transport.route_variants AS v
    WHERE v.route_id = ANY($1::bigint[])
      AND v.deleted_at IS NULL
    ORDER BY v.variant_code
`;

export const LEGACY_TRAIN_PATH_SQL = `
    SELECT
        p.id::text,
        COALESCE(v.variant_code, p.path_kind, p.id::text) AS code,
        p.review_status,
        p.is_active,
        p.normalized_data->>'generation' AS generation
    FROM transport.route_paths AS p
    INNER JOIN transport.route_variants AS v ON v.id = p.route_variant_id
    WHERE p.route_variant_id = ANY($1::bigint[])
      AND p.deleted_at IS NULL
    ORDER BY p.id
`;

export const UPDATE_LEGACY_TRAIN_ROUTE_SQL = `
    UPDATE transport.routes AS r
    SET
        is_active = false,
        review_status = CASE
            WHEN r.review_status IN ('verified', 'manual_protected') THEN r.review_status
            ELSE $2
        END,
        source_refs = r.source_refs || $3::jsonb,
        normalized_data = r.normalized_data || $4::jsonb,
        updated_at = now()
    WHERE r.id = ANY($1::bigint[])
      AND r.mode = '${TRAIN_MODE}'
      AND r.deleted_at IS NULL
      AND COALESCE(r.normalized_data->>'generation', '') <> '${TRAIN_IMPORT_GENERATION}'
`;

export const UPDATE_LEGACY_TRAIN_VARIANT_SQL = `
    UPDATE transport.route_variants AS v
    SET
        is_active = false,
        review_status = CASE
            WHEN v.review_status IN ('verified', 'manual_protected') THEN v.review_status
            ELSE $2
        END,
        source_refs = v.source_refs || $3::jsonb,
        normalized_data = v.normalized_data || $4::jsonb,
        updated_at = now()
    WHERE v.id = ANY($1::bigint[])
      AND v.deleted_at IS NULL
`;

export const UPDATE_LEGACY_TRAIN_PATH_SQL = `
    UPDATE transport.route_paths AS p
    SET
        is_active = false,
        review_status = CASE
            WHEN p.review_status IN ('verified', 'manual_protected') THEN p.review_status
            ELSE $2
        END,
        source_refs = p.source_refs || $3::jsonb,
        normalized_data = p.normalized_data || $4::jsonb,
        updated_at = now()
    WHERE p.id = ANY($1::bigint[])
      AND p.deleted_at IS NULL
`;
