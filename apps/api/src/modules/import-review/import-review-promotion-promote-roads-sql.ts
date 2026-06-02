import { Prisma } from "@prisma/client";

import { roadsExplicitAdminAreaIdExpr } from "./import-review-road-admin-area-sql.js";
import {
    effectiveRoadLengthMExpr,
    externalIdExpr,
    geomSourceExpr,
    nameExpr,
} from "./import-review-promotion-promote-sql.js";

export const ROAD_CANDIDATE_SQL_ALIAS = "r";

export const PROMOTE_ROAD_SRC_COLUMNS = Prisma.sql`
    spi.id AS publish_item_id,
    r.id,
    r.review_batch_id,
    r.source_snapshot_version,
    r.local_staging_id,
    r.external_id,
    r.canonical_name,
    r.class_code,
    r.road_class,
    r.road_class_id,
    r.surface,
    r.is_oneway,
    r.bridge,
    r.tunnel,
    r.layer,
    r.normalized_data,
    r.name_mm,
    r.name_en,
    r.admin_area_id,
    r.source_refs,
    r.confidence_score,
    r.matched_core_id,
    r.matched_core_table,
    r.match_status,
    r.auto_action,
    r.review_status,
    r.review_decision,
    r.promotion_status,
    r.promoted_core_id,
    r.validation_errors,
    r.geom AS candidate_geom
`;

function roadAlias(alias: string): Prisma.Sql {
    return Prisma.raw(alias);
}

export function roadEffectiveTextFieldExpr(alias: string, field: string): Prisma.Sql {
    const a = roadAlias(alias);
    const f = Prisma.raw(field);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.${f},
            ${a}.normalized_data->>${f}
        )), '')
    `;
}

export function roadEffectiveBoolFieldExpr(alias: string, field: string, defaultSql: Prisma.Sql): Prisma.Sql {
    const a = roadAlias(alias);
    const f = Prisma.raw(field);
    return Prisma.sql`
        coalesce(
            ${a}.${f},
            CASE
                WHEN ${a}.normalized_data ? ${f}
                    THEN (${a}.normalized_data->>${f})::boolean
            END,
            ${defaultSql}
        )
    `;
}

export function roadEffectiveIntFieldExpr(alias: string, field: string, defaultSql: Prisma.Sql): Prisma.Sql {
    const a = roadAlias(alias);
    const f = Prisma.raw(field);
    return Prisma.sql`
        coalesce(
            ${a}.${f},
            CASE
                WHEN (${a}.normalized_data->>${f}) ~ '^-?[0-9]+$'
                    THEN (${a}.normalized_data->>${f})::integer
            END,
            ${defaultSql}
        )
    `;
}

export function roadEffectiveRoadClassIdExpr(alias: string): Prisma.Sql {
    const a = roadAlias(alias);
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

export function roadEffectiveRoadClassCodeExpr(alias: string): Prisma.Sql {
    const a = roadAlias(alias);
    const classId = roadEffectiveRoadClassIdExpr(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            (SELECT rc.code FROM ref.ref_road_classes AS rc WHERE rc.id = ${classId}),
            ${a}.road_class,
            ${a}.class_code,
            ${a}.normalized_data->>'road_class',
            ${a}.normalized_data->>'class_code',
            ${a}.normalized_data->>'highway'
        )), '')
    `;
}

export function roadLineGeomExpr(alias: string, geomColumn = "geom"): Prisma.Sql {
    const raw = geomSourceExpr(alias, geomColumn);
    return Prisma.sql`
        CASE
            WHEN ${raw} IS NULL THEN NULL::geometry(LineString, 4326)
            WHEN ST_GeometryType(${raw}) = 'ST_LineString'
                THEN ${raw}::geometry(LineString, 4326)
            WHEN ST_GeometryType(${raw}) = 'ST_MultiLineString' THEN (
                SELECT (ST_Dump(${raw})).geom::geometry(LineString, 4326)
                ORDER BY ST_Length(((ST_Dump(${raw})).geom)::geography) DESC
                LIMIT 1
            )
            ELSE NULL::geometry(LineString, 4326)
        END
    `;
}

export function roadCanonicalNameExpr(alias: string): Prisma.Sql {
    const a = roadAlias(alias);
    return Prisma.sql`
        coalesce(
            nullif(trim(${nameExpr(alias)}), ''),
            nullif(trim(${a}.canonical_name), ''),
            'Unnamed Street'
        )
    `;
}

export function roadSourceTypeIdExpr(alias: string): Prisma.Sql {
    const a = roadAlias(alias);
    return Prisma.sql`(
        SELECT st.id
        FROM ref.ref_source_types AS st
        WHERE st.code = coalesce(
            nullif(trim(${a}.source_refs->>'source_type_code'), ''),
            nullif(trim(${a}.source_refs->>'source'), ''),
            nullif(trim(${a}.normalized_data->>'source_type_code'), ''),
            nullif(trim(${a}.normalized_data->>'source'), ''),
            'osm'
        )
        LIMIT 1
    )`;
}

export function roadSourceRefsMergeExpr(
    alias: string,
    batchId: bigint,
    dryRunStatus: string | null
): Prisma.Sql {
    const a = roadAlias(alias);
    return Prisma.sql`
        coalesce(${a}.source_refs, '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object(
            'review_candidate_id', ${a}.id::text,
            'review_batch_id', ${a}.review_batch_id::text,
            'source_snapshot_version', ${a}.source_snapshot_version,
            'local_staging_id', ${a}.local_staging_id::text,
            'publish_batch_id', ${batchId}::text,
            'entity_family', 'roads',
            'road_dry_run_status', ${dryRunStatus}
        ))
    `;
}

export function roadNormalizedDataMergeExpr(
    alias: string,
    batchId: bigint,
    dryRunSummaryJson: string
): Prisma.Sql {
    const a = roadAlias(alias);
    return Prisma.sql`
        coalesce(${a}.normalized_data, '{}'::jsonb)
        || jsonb_build_object(
            'promotion', jsonb_build_object(
                'publish_batch_id', ${batchId}::text,
                'promoted_at', to_jsonb(now()),
                'entity_family', 'roads'
            ),
            'road_dry_run_summary', ${dryRunSummaryJson}::jsonb
        )
    `;
}

export function roadReadyFieldExprs(
    batchId: bigint,
    alias: string,
    dryRunStatus: string | null,
    dryRunSummaryJson: string
): Prisma.Sql {
    const a = roadAlias(alias);
    return Prisma.sql`
        ${roadLineGeomExpr(alias)} AS geom_ready,
        ${roadCanonicalNameExpr(alias)} AS canonical_name_ready,
        ${externalIdExpr(alias)} AS external_id_ready,
        ${roadEffectiveRoadClassIdExpr(alias)} AS road_class_id_ready,
        ${roadEffectiveRoadClassCodeExpr(alias)} AS road_class_code_ready,
        ${roadEffectiveTextFieldExpr(alias, "surface")} AS surface_ready,
        ${roadEffectiveBoolFieldExpr(alias, "is_oneway", Prisma.sql`false`)} AS is_oneway_ready,
        ${roadEffectiveBoolFieldExpr(alias, "bridge", Prisma.sql`false`)} AS bridge_ready,
        ${roadEffectiveBoolFieldExpr(alias, "tunnel", Prisma.sql`false`)} AS tunnel_ready,
        ${roadEffectiveIntFieldExpr(alias, "layer", Prisma.sql`0`)} AS layer_ready,
        coalesce(
            ${roadsExplicitAdminAreaIdExpr(alias)},
            NULL::bigint
        ) AS admin_area_id_ready,
        coalesce(${a}.confidence_score, 80::numeric) AS confidence_score_ready,
        ${effectiveRoadLengthMExpr(alias)} AS length_m_ready,
        ${roadSourceTypeIdExpr(alias)} AS source_type_id_ready,
        ${roadSourceRefsMergeExpr(alias, batchId, dryRunStatus)} AS merged_source_refs,
        ${roadNormalizedDataMergeExpr(alias, batchId, dryRunSummaryJson)} AS merged_normalized_data
    `;
}
