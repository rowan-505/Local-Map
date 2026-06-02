import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";
import { buildLightweightTypedNameColumns, colRef } from "./import-review-candidate-sql.js";
import { roadsExplicitAdminAreaIdExpr } from "./import-review-road-admin-area-sql.js";

function roadAlias(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    return Prisma.raw(config.tableAlias);
}

function roadCoalesceTextExpr(alias: string, column: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    const col = Prisma.raw(column);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.${col},
            ${a}.normalized_data->'tags'->>${col},
            ${a}.normalized_data->>${col},
            ''
        )), '')
    `;
}

function roadColumnBooleanExpr(alias: string, column: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    const colIdent = Prisma.raw(column);
    const colKey = column;
    return Prisma.sql`
        coalesce(
            ${a}.${colIdent},
            CASE
                WHEN ${a}.normalized_data ? ${colKey}
                    THEN (${a}.normalized_data->>${colKey})::boolean
            END
        )
    `;
}

function roadColumnIntegerExpr(alias: string, column: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    const colIdent = Prisma.raw(column);
    const colKey = column;
    return Prisma.sql`
        coalesce(
            ${a}.${colIdent},
            CASE
                WHEN (${a}.normalized_data->>${colKey}) ~ '^-?[0-9]+$'
                    THEN (${a}.normalized_data->>${colKey})::integer
            END
        )
    `;
}

function roadEffectiveRoadClassIdExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        coalesce(
            ${a}.road_class_id,
            CASE
                WHEN (${a}.normalized_data->>'road_class_id') ~ '^[0-9]+$'
                    THEN (${a}.normalized_data->>'road_class_id')::bigint
            END
        )
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
        , ${roadCoalesceTextExpr(alias, "surface")} AS road_candidate_surface
        , ${roadColumnBooleanExpr(alias, "is_oneway")} AS road_candidate_is_oneway
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
        , ${roadColumnBooleanExpr(alias, "bridge")} AS bridge
        , ${roadColumnBooleanExpr(alias, "tunnel")} AS tunnel
        , ${roadColumnIntegerExpr(alias, "layer")} AS layer
        , ${roadListValidationStatusExpr(alias)} AS routing_status
        , (${colRef(config, "geom")} IS NOT NULL) AS has_geometry
        ${buildLightweightTypedNameColumns(config)}
    `;
}
