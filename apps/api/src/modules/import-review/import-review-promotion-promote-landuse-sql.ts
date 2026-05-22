import { Prisma } from "@prisma/client";

import { effectiveAdminAreaIdExpr } from "./import-review-effective-values.js";
import {
    externalIdExpr,
    geomSourceExpr,
    normalizedDataMergeExpr,
    sourceRefsMergeExpr,
} from "./import-review-promotion-promote-sql.js";

/** Paddy parcels at or below this area (m²) promote as detail_level = parcel. */
export const LANDUSE_PADDY_PARCEL_MAX_AREA_M2 = 25_000;

export const LANDUSE_CANDIDATE_SQL_ALIAS = "lu";

export function landuseEffectiveClassIdRawExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        coalesce(
            CASE WHEN (${a}.review_overrides->>'landuse_class_id') ~ '^[0-9]+$'
                THEN (${a}.review_overrides->>'landuse_class_id')::bigint END,
            ${a}.landuse_class_id
        )
    `;
}

/** Effective landuse_class_id when it exists in ref.ref_landuse_classes. */
export function landuseClassIdExpr(alias: string): Prisma.Sql {
    const raw = landuseEffectiveClassIdRawExpr(alias);
    return Prisma.sql`
        CASE
            WHEN ${raw} IS NULL THEN NULL::bigint
            WHEN EXISTS (
                SELECT 1 FROM ref.ref_landuse_classes AS lc
                WHERE lc.id = ${raw}
                  AND coalesce(lc.is_active, true)
            ) THEN ${raw}
            ELSE NULL::bigint
        END
    `;
}

export function landuseClassCodeExpr(alias: string, classIdExpr: Prisma.Sql): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.review_overrides->>'class_code',
            ${a}.class_code,
            ${a}.normalized_data->>'class_code',
            (
                SELECT lc.code
                FROM ref.ref_landuse_classes AS lc
                WHERE lc.id = ${classIdExpr}
                LIMIT 1
            ),
            ''
        )), '')
    `;
}

export function landuseSourceTagsExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        CASE
            WHEN jsonb_typeof(${a}.normalized_data->'tags') = 'object'
                THEN ${a}.normalized_data->'tags'
            WHEN jsonb_typeof(${a}.source_refs->'tags') = 'object'
                THEN ${a}.source_refs->'tags'
            ELSE '{}'::jsonb
        END
    `;
}

export function landuseCropCodeExpr(
    alias: string,
    classIdExpr: Prisma.Sql,
    classCodeExpr: Prisma.Sql
): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        CASE
            WHEN lower(coalesce(${classCodeExpr}, '')) IN ('paddy', 'rice') THEN 'rice'
            WHEN lower(coalesce(
                nullif(trim(${a}.review_overrides->>'crop_code'), ''),
                nullif(trim(${a}.normalized_data->>'crop'), ''),
                nullif(trim(${a}.normalized_data->'tags'->>'crop'), ''),
                ''
            )) = 'rice' THEN 'rice'
            WHEN EXISTS (
                SELECT 1 FROM ref.ref_landuse_classes AS lc
                WHERE lc.id = ${classIdExpr}
                  AND lower(lc.code) IN ('paddy', 'rice')
            ) THEN 'rice'
            ELSE NULL::text
        END
    `;
}

export function landuseDetailLevelExpr(classIdExpr: Prisma.Sql, areaM2Expr: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
        CASE
            WHEN EXISTS (
                SELECT 1 FROM ref.ref_landuse_classes AS lc
                WHERE lc.id = ${classIdExpr}
                  AND lower(lc.code) = 'paddy'
            )
            AND ${areaM2Expr} IS NOT NULL
            AND ${areaM2Expr} > 0
            AND ${areaM2Expr} <= ${LANDUSE_PADDY_PARCEL_MAX_AREA_M2}
                THEN 'parcel'
            ELSE 'zone'
        END
    `;
}

/** Polygon/MultiPolygon from raw geom; invalid rings fixed with ST_MakeValid. */
export function landusePolygonFromRawExpr(rawGeomExpr: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
        CASE
            WHEN ${rawGeomExpr} IS NULL THEN NULL::geometry(MultiPolygon, 4326)
            WHEN ST_GeometryType(ST_MakeValid(${rawGeomExpr})) = 'ST_Polygon'
                THEN ST_Multi(ST_MakeValid(${rawGeomExpr}))::geometry(MultiPolygon, 4326)
            WHEN ST_GeometryType(ST_MakeValid(${rawGeomExpr})) = 'ST_MultiPolygon'
                THEN ST_MakeValid(${rawGeomExpr})::geometry(MultiPolygon, 4326)
            ELSE NULL::geometry(MultiPolygon, 4326)
        END
    `;
}

export function landuseAdminAreaIdExpr(alias: string): Prisma.Sql {
    const raw = effectiveAdminAreaIdExpr(alias);
    return Prisma.sql`
        CASE
            WHEN ${raw} IS NULL THEN NULL::bigint
            WHEN EXISTS (
                SELECT 1 FROM core.core_admin_areas AS aa
                WHERE aa.id = ${raw}
                  AND coalesce(aa.is_active, true)
            ) THEN ${raw}
            ELSE NULL::bigint
        END
    `;
}

/** Ready-row expressions — alias must reference a row that already has `geom` (MultiPolygon). */
export function landuseReadyFieldExprs(batchId: bigint, alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    const classId = landuseClassIdExpr(alias);
    const classCode = landuseClassCodeExpr(alias, classId);
    const areaM2 = Prisma.sql`ROUND(ST_Area(${a}.geom::geography)::numeric, 2)`;
    return Prisma.sql`
        ${classId} AS landuse_class_id_ready,
        ${classCode} AS class_code_ready,
        ${landuseAdminAreaIdExpr(alias)} AS admin_area_id_ready,
        ${landuseSourceTagsExpr(alias)} AS source_tags_ready,
        ${externalIdExpr(alias)} AS external_id_ready,
        ${sourceRefsMergeExpr(alias, batchId, "landuse")} AS merged_source_refs,
        ${normalizedDataMergeExpr(alias, batchId)} AS merged_normalized_data,
        least(100, greatest(0, coalesce(
            CASE WHEN (${a}.review_overrides->>'confidence_score') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                THEN (${a}.review_overrides->>'confidence_score')::numeric END,
            ${a}.confidence_score,
            70
        ))) AS confidence_score_ready,
        ST_PointOnSurface(${a}.geom)::geometry(Point, 4326) AS centroid_ready,
        ${areaM2} AS area_m2_ready,
        ${landuseCropCodeExpr(alias, classId, classCode)} AS crop_code_ready,
        ${landuseDetailLevelExpr(classId, areaM2)} AS detail_level_ready
    `;
}

export const PROMOTE_LANDUSE_SRC_COLUMNS = Prisma.sql`
    spi.id AS publish_item_id,
    lu.id,
    lu.review_batch_id,
    lu.source_snapshot_version,
    lu.local_staging_id,
    lu.external_id,
    lu.name,
    lu.canonical_name,
    lu.name_mm,
    lu.name_en,
    lu.class_code,
    lu.landuse_class_id,
    lu.confidence_score,
    lu.normalized_data,
    lu.review_overrides,
    lu.source_refs,
    lu.matched_core_id,
    lu.geom AS candidate_geom
`;

export function landuseRawGeomExpr(srcAlias: string): Prisma.Sql {
    return geomSourceExpr(srcAlias, "candidate_geom");
}

export function landuseFixedGeomExpr(rawAlias: string): Prisma.Sql {
    const r = Prisma.raw(rawAlias);
    return landusePolygonFromRawExpr(Prisma.sql`${r}.g_raw`);
}
