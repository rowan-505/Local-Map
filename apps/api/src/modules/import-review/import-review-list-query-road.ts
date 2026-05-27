import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";
import { colRef } from "./import-review-candidate-sql.js";
import { roadsExplicitAdminAreaIdExpr } from "./import-review-road-admin-area-sql.js";

function roadAlias(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    return Prisma.raw(config.tableAlias);
}

function roadJsonKey(key: string): Prisma.Sql {
    return Prisma.raw(`'${key.replace(/'/g, "''")}'`);
}

function roadReviewOverrides(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`coalesce(${a}.review_overrides, '{}'::jsonb)`;
}

function roadOvBooleanExpr(alias: string, key: string, column: string): Prisma.Sql {
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

export function buildRoadLightweightListFromClause(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
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

export function buildRoadLightweightListExtensionSelect(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const alias = config.tableAlias;

    return Prisma.sql`
        , NULL::text AS name
        , NULL::text AS building_type
        , NULL::bigint AS building_type_id
        , NULL::bigint AS landuse_class_id
        , ${roadsExplicitAdminAreaIdExpr(alias)} AS admin_area_id
        , NULL::int AS levels
        , NULL::numeric AS height_m
        , NULL::numeric AS area_m2
        , ${roadEffectiveRoadClassIdExpr(alias)} AS road_candidate_road_class_id
        , ${roadOvStringExpr(alias, "surface", "surface")} AS road_candidate_surface
        , ${roadOvBooleanExpr(alias, "is_oneway", "is_oneway")} AS road_candidate_is_oneway
        , COALESCE(rc.code, ${colRef(config, "road_class")}) AS road_candidate_class_label
        , COALESCE(
            ${colRef(config, "length_m")},
            CASE
                WHEN (${Prisma.raw(alias)}.normalized_data->>'length_m') ~ '^[0-9]+(\.[0-9]+)?$'
                    THEN (${Prisma.raw(alias)}.normalized_data->>'length_m')::numeric
            END
        ) AS length_m
        , eff_aa_explicit.canonical_name AS admin_area_name
        , eff_aa_explicit.canonical_name AS effective_admin_area_name
        , ${roadOvBooleanExpr(alias, "bridge", "bridge")} AS bridge
        , ${roadOvBooleanExpr(alias, "tunnel", "tunnel")} AS tunnel
        , ${roadOvIntegerExpr(alias, "layer", "layer")} AS layer
        , ${roadListValidationStatusExpr(alias)} AS validation_status
        , (${colRef(config, "geom")} IS NOT NULL) AS has_geometry
    `;
}
