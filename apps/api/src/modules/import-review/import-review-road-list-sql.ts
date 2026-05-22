import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";
import { colRef } from "./import-review-candidate-sql.js";
import { roadsExplicitAdminAreaIdExpr } from "./import-review-road-admin-area-sql.js";

/*
 * Suggested local EXPLAIN for list shape:
 *
 * EXPLAIN (ANALYZE, BUFFERS)
 * SELECT ... FROM import_review.road_candidates AS r
 * LEFT JOIN ref.ref_road_classes AS rc ON rc.id = r.road_class_id
 * LEFT JOIN core.core_admin_areas AS eff_aa_explicit ON ...
 * WHERE r.review_batch_id = $1 AND r.entity_family = 'roads'
 * ORDER BY r.updated_at DESC
 * LIMIT 50 OFFSET 0;
 */

function roadAlias(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    return Prisma.raw(config.tableAlias);
}

/** Quoted JSON object key for `->` / `->>` / `?` (must not be a bare identifier). */
function roadJsonKey(key: string): Prisma.Sql {
    return Prisma.raw(`'${key.replace(/'/g, "''")}'`);
}

function roadReviewOverrides(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`coalesce(${a}.review_overrides, '{}'::jsonb)`;
}

function roadOvBooleanExpr(alias: string, key: string, column: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    const jsonKey = roadJsonKey(key);
    const ov = roadReviewOverrides(alias);
    return Prisma.sql`
        CASE
            WHEN jsonb_typeof(${ov} -> ${jsonKey}) = 'boolean'
                THEN (${ov} ->> ${jsonKey})::boolean
            WHEN jsonb_typeof(${ov} -> ${jsonKey}) = 'string'
                THEN lower(${ov} ->> ${jsonKey}) IN ('true', '1', 'yes')
            WHEN jsonb_typeof(${ov} -> ${jsonKey}) = 'null' THEN NULL
            ELSE ${Prisma.raw(`${alias}.${column}`)}
        END
    `;
}

function roadOvIntegerExpr(alias: string, key: string, column: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    const jsonKey = roadJsonKey(key);
    const ov = roadReviewOverrides(alias);
    return Prisma.sql`
        CASE
            WHEN jsonb_typeof(${ov} -> ${jsonKey}) = 'number'
                THEN (${ov} ->> ${jsonKey})::integer
            WHEN (${ov} ->> ${jsonKey}) ~ '^-?[0-9]+$'
                THEN (${ov} ->> ${jsonKey})::integer
            WHEN jsonb_typeof(${ov} -> ${jsonKey}) = 'null' THEN NULL::integer
            ELSE ${Prisma.raw(`${alias}.${column}`)}
        END
    `;
}

function roadOvStringExpr(alias: string, key: string, column: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    const jsonKey = roadJsonKey(key);
    const ov = roadReviewOverrides(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            nullif(trim(${ov} ->> ${jsonKey}), ''),
            ${Prisma.raw(`${alias}.${column}`)},
            ${a}.normalized_data->'tags'->>${jsonKey},
            ${a}.normalized_data->>${jsonKey},
            ''
        )), '')
    `;
}

function roadEffectiveRoadClassIdExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    const ov = roadReviewOverrides(alias);
    return Prisma.sql`
        CASE
            WHEN (${ov} ->> 'road_class_id') ~ '^[0-9]+$'
                THEN (${ov} ->> 'road_class_id')::bigint
            ELSE ${a}.road_class_id
        END
    `;
}

function roadListReviewOverridesExpr(alias: string): Prisma.Sql {
    const ov = roadReviewOverrides(alias);
    return Prisma.sql`
        jsonb_strip_nulls(jsonb_build_object(
            'name_mm', ${ov} ->> 'name_mm',
            'name_en', ${ov} ->> 'name_en',
            'admin_area_id', ${ov} ->> 'admin_area_id',
            'road_class_id', ${ov} ->> 'road_class_id',
            'surface', ${ov} ->> 'surface',
            'is_oneway', ${ov} -> 'is_oneway',
            'bridge', ${ov} -> 'bridge',
            'tunnel', ${ov} -> 'tunnel',
            'layer', ${ov} -> 'layer'
        ))
    `;
}

function roadListNormalizedDataExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        jsonb_strip_nulls(jsonb_build_object(
            'tags', jsonb_strip_nulls(jsonb_build_object(
                'name', ${a}.normalized_data->'tags'->>'name',
                'name:en', ${a}.normalized_data->'tags'->>'name:en',
                'name:my', ${a}.normalized_data->'tags'->>'name:my',
                'name:mm', ${a}.normalized_data->'tags'->>'name:mm',
                'name:my-MM', ${a}.normalized_data->'tags'->>'name:my-MM',
                'name:my-Latn', ${a}.normalized_data->'tags'->>'name:my-Latn',
                'official_name', ${a}.normalized_data->'tags'->>'official_name',
                'alt_name', ${a}.normalized_data->'tags'->>'alt_name',
                'highway', ${a}.normalized_data->'tags'->>'highway',
                'surface', ${a}.normalized_data->'tags'->>'surface'
            )),
            'name_mm', ${a}.normalized_data->>'name_mm',
            'name_en', ${a}.normalized_data->>'name_en',
            'surface', ${a}.normalized_data->>'surface',
            'is_oneway', ${a}.normalized_data->>'is_oneway',
            'length_m', ${a}.normalized_data->>'length_m',
            'road_name_candidates', ${a}.normalized_data->'road_name_candidates'
        ))
    `;
}

function roadListValidationStatusExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        CASE
            WHEN jsonb_array_length(COALESCE(${a}.validation_errors, '[]'::jsonb)) > 0 THEN 'errors'
            WHEN jsonb_array_length(COALESCE(${a}.validation_warnings, '[]'::jsonb)) > 0 THEN 'warnings'
            WHEN ${a}.validation_errors IS NOT NULL OR ${a}.validation_warnings IS NOT NULL THEN 'valid'
            ELSE 'unknown'
        END
    `;
}

/** Explicit admin-area join only — no LATERAL spatial inference on list rows. */
export function buildRoadCandidateListFromClause(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const alias = config.tableAlias;
    const explicitId = roadsExplicitAdminAreaIdExpr(alias);

    return Prisma.sql`
        ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${roadAlias(config)}
        LEFT JOIN ref.ref_road_classes AS rc
            ON rc.id = ${roadEffectiveRoadClassIdExpr(alias)}
        LEFT JOIN core.core_admin_areas AS eff_aa_explicit
            ON eff_aa_explicit.id = ${explicitId}
            AND eff_aa_explicit.is_active IS TRUE
            AND eff_aa_explicit.deleted_at IS NULL
    `;
}

export function buildRoadCandidateListSelect(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const alias = config.tableAlias;
    const a = roadAlias(config);

    return Prisma.sql`
        ${a}.id,
        ${a}.public_id::text AS public_id,
        ${a}.review_batch_id,
        ${a}.source_snapshot_version,
        ${a}.local_staging_id,
        ${a}.source_snapshot_id_local,
        ${a}.external_id,
        ${a}.canonical_name,
        NULL::text AS name,
        ${a}.class_code,
        NULL::text AS building_type,
        NULL::bigint AS building_type_id,
        NULL::bigint AS landuse_class_id,
        ${roadsExplicitAdminAreaIdExpr(alias)} AS admin_area_id,
        NULL::int AS levels,
        NULL::numeric AS height_m,
        NULL::numeric AS area_m2,
        ${a}.confidence_score,
        ${a}.match_status,
        ${a}.auto_action,
        ${a}.review_status,
        ${a}.review_decision,
        ${a}.reviewed_by::text AS reviewed_by,
        ${a}.reviewed_at,
        ${a}.review_note,
        ${roadListNormalizedDataExpr(alias)} AS normalized_data,
        '{}'::jsonb AS source_refs,
        ${roadListReviewOverridesExpr(alias)} AS review_overrides,
        ${a}.matched_core_id,
        ${a}.matched_core_table,
        '{}'::jsonb AS matched_core_data,
        '{}'::jsonb AS f2_comparison,
        ${a}.validation_warnings,
        ${a}.validation_errors,
        ${a}.promotion_status,
        ${a}.promoted_core_id,
        ${a}.created_at,
        ${a}.updated_at,
        NULL::json AS geometry,
        NULL::json AS centroid,
        ${roadEffectiveRoadClassIdExpr(alias)} AS road_candidate_road_class_id,
        ${roadOvStringExpr(alias, "surface", "surface")} AS road_candidate_surface,
        ${roadOvBooleanExpr(alias, "is_oneway", "is_oneway")} AS road_candidate_is_oneway,
        COALESCE(rc.code, ${colRef(config, "road_class")}) AS road_candidate_class_label,
        COALESCE(
            ${colRef(config, "length_m")},
            CASE
                WHEN (${a}.normalized_data->>'length_m') ~ '^[0-9]+(\.[0-9]+)?$'
                    THEN (${a}.normalized_data->>'length_m')::numeric
            END
        ) AS length_m,
        eff_aa_explicit.canonical_name AS admin_area_name,
        eff_aa_explicit.canonical_name AS effective_admin_area_name,
        ${roadOvBooleanExpr(alias, "bridge", "bridge")} AS bridge,
        ${roadOvBooleanExpr(alias, "tunnel", "tunnel")} AS tunnel,
        ${roadOvIntegerExpr(alias, "layer", "layer")} AS layer,
        ${roadListValidationStatusExpr(alias)} AS validation_status,
        true AS is_road_list_projection
    `;
}
