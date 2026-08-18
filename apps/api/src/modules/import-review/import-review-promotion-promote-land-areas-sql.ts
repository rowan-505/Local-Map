import { Prisma } from "@prisma/client";

import {
    geomSourceExpr,
    normalizedDataMergeExpr,
    sourceRefsMergeExpr,
} from "./import-review-promotion-promote-sql.js";
import { promotionTypedExternalIdExpr } from "./import-review-promotion-typed-promote-sql.js";
import {
    promotionTypedLandAreaClassCodeExpr,
    promotionTypedLandAreaClassIdExpr,
} from "./import-review-promotion-typed-promote-sql.js";

/** Paddy parcels at or below this area (m²) promote as detail_level = parcel. */
export const LANDUSE_PADDY_PARCEL_MAX_AREA_M2 = 25_000;

export const LANDUSE_CANDIDATE_SQL_ALIAS = "lu";

export function landAreaClassIdExpr(alias: string): Prisma.Sql {
    return promotionTypedLandAreaClassIdExpr(alias);
}

export function landAreaClassCodeExpr(alias: string, classIdExpr: Prisma.Sql): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${promotionTypedLandAreaClassCodeExpr(alias)},
            (
                SELECT lc.code
                FROM ref.ref_land_area_classes AS lc
                WHERE lc.id = ${classIdExpr}
                LIMIT 1
            ),
            ''
        )), '')
    `;
}

export function landAreaSourceTagsExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        CASE
            WHEN jsonb_typeof(${a}.source_refs->'tags') = 'object'
                THEN ${a}.source_refs->'tags'
            ELSE '{}'::jsonb
        END
    `;
}

export function landAreaCropCodeExpr(
    alias: string,
    classIdExpr: Prisma.Sql,
    classCodeExpr: Prisma.Sql
): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        CASE
            WHEN lower(coalesce(${classCodeExpr}, '')) IN ('paddy', 'rice') THEN 'rice'
            WHEN EXISTS (
                SELECT 1 FROM ref.ref_land_area_classes AS lc
                WHERE lc.id = ${classIdExpr}
                  AND lower(lc.code) IN ('paddy', 'rice')
            ) THEN 'rice'
            ELSE NULL::text
        END
    `;
}

export function landAreaDetailLevelExpr(classIdExpr: Prisma.Sql, areaM2Expr: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
        CASE
            WHEN EXISTS (
                SELECT 1 FROM ref.ref_land_area_classes AS lc
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
export function landAreaPolygonFromRawExpr(rawGeomExpr: Prisma.Sql): Prisma.Sql {
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

export function landAreaAdminAreaIdExpr(_alias: string): Prisma.Sql {
    return Prisma.sql`NULL::bigint`;
}

/** Ready-row expressions — alias must reference a row that already has `geom` (MultiPolygon). */
export function landAreaReadyFieldExprs(batchId: bigint, alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    const classId = landAreaClassIdExpr(alias);
    const classCode = landAreaClassCodeExpr(alias, classId);
    const areaM2 = Prisma.sql`ROUND(ST_Area(${a}.geom::geography)::numeric, 2)`;
    return Prisma.sql`
        ${classId} AS land_area_class_id_ready,
        ${classCode} AS class_code_ready,
        ${landAreaAdminAreaIdExpr(alias)} AS admin_area_id_ready,
        ${landAreaSourceTagsExpr(alias)} AS source_tags_ready,
        ${promotionTypedExternalIdExpr(alias)} AS external_id_ready,
        ${sourceRefsMergeExpr(alias, batchId, "land_areas")} AS merged_source_refs,
        ${normalizedDataMergeExpr(alias, batchId)} AS merged_normalized_data,
        least(100, greatest(0, coalesce(
            ${a}.confidence_score,
            70
        ))) AS confidence_score_ready,
        ST_PointOnSurface(${a}.geom)::geometry(Point, 4326) AS centroid_ready,
        ${areaM2} AS area_m2_ready,
        ${landAreaCropCodeExpr(alias, classId, classCode)} AS crop_code_ready,
        ${landAreaDetailLevelExpr(classId, areaM2)} AS detail_level_ready
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
    lu.land_area_class_id,
    lu.confidence_score,
    lu.normalized_data,
    lu.source_refs,
    lu.matched_core_id,
    lu.geom AS candidate_geom
`;

export function landAreaRawGeomExpr(srcAlias: string): Prisma.Sql {
    return geomSourceExpr(srcAlias, "candidate_geom");
}

export function landAreaFixedGeomExpr(rawAlias: string): Prisma.Sql {
    const r = Prisma.raw(rawAlias);
    return landAreaPolygonFromRawExpr(Prisma.sql`${r}.g_raw`);
}
