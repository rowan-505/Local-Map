/**
 * Typed-column-only SQL fragments for publish-batch promotion.
 * Do not read review_overrides or normalized_data for required FK, class, geometry, or core names.
 *
 * @see docs/import-review/direct-edit-promotion-contract.md §8
 */

import { Prisma } from "@prisma/client";

function aliasRef(alias: string): Prisma.Sql {
    return Prisma.raw(alias);
}

function columnRef(alias: string, column: string): Prisma.Sql {
    const a = aliasRef(alias);
    const c = Prisma.raw(column);
    return Prisma.sql`${a}.${c}`;
}

/** Typed geometry column (no normalized_data fallback). */
export function promotionTypedGeom(alias: string, geomColumn = "geom"): Prisma.Sql {
    return columnRef(alias, geomColumn);
}

export function promotionTypedPointGeom(alias: string, geomColumn = "point_geom"): Prisma.Sql {
    return columnRef(alias, geomColumn);
}

/** Building core name from typed name_en / name_mm only. */
export function promotionTypedBuildingNameExpr(alias: string): Prisma.Sql {
    const a = aliasRef(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.name_en,
            ${a}.name_mm,
            ${a}.name,
            ${a}.canonical_name,
            ''
        )), '')
    `;
}

/** Core display name from typed name columns only. */
export function promotionTypedNameExpr(alias: string): Prisma.Sql {
    const a = aliasRef(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.name_en,
            ${a}.name_mm,
            ${a}.name,
            ${a}.canonical_name,
            ${a}.primary_name,
            ${a}.display_name,
            ''
        )), '')
    `;
}

/** Typed class_code only (water/landuse/map). */
export function promotionTypedClassCodeExpr(alias: string, fallback?: string): Prisma.Sql {
    const a = aliasRef(alias);
    const tail = fallback != null ? Prisma.sql`${fallback}` : Prisma.sql`NULL::text`;
    return Prisma.sql`nullif(trim(coalesce(${a}.class_code, ${tail})), '')`;
}

/** external_id or staging-derived id from typed columns only. */
export function promotionTypedExternalIdExpr(alias: string): Prisma.Sql {
    const a = aliasRef(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.external_id,
            CASE
                WHEN ${a}.local_staging_id IS NOT NULL
                    THEN 'staging:' || ${a}.local_staging_id::text
            END,
            ''
        )), '')
    `;
}

/** Place category_id from typed column; optional lookup by typed class_code (public ref row). */
export function promotionTypedPlaceCategoryIdExpr(alias: string): Prisma.Sql {
    const a = aliasRef(alias);
    const typedId = columnRef(alias, "category_id");
    const classCode = Prisma.sql`nullif(trim(coalesce(${a}.class_code, '')), '')`;
    return Prisma.sql`
        CASE
            WHEN ${typedId} IS NOT NULL AND EXISTS (
                SELECT 1
                FROM ref.ref_poi_categories AS c
                WHERE c.id = ${typedId}
                  AND coalesce(c.is_public, true)
            ) THEN ${typedId}
            WHEN ${classCode} IS NOT NULL THEN (
                SELECT c.id
                FROM ref.ref_poi_categories AS c
                WHERE c.code = ${classCode}
                  AND coalesce(c.is_public, true)
                LIMIT 1
            )
            ELSE NULL::bigint
        END
    `;
}

/** Typed admin_area_id when present and FK-valid on core.core_admin_areas. */
export function promotionTypedPlaceAdminAreaIdExpr(alias: string): Prisma.Sql {
    const raw = columnRef(alias, "admin_area_id");
    return Prisma.sql`
        CASE
            WHEN ${raw} IS NULL THEN NULL::bigint
            WHEN EXISTS (
                SELECT 1
                FROM core.core_admin_areas AS aa
                WHERE aa.id = ${raw}
                  AND aa.deleted_at IS NULL
            ) THEN ${raw}
            ELSE NULL::bigint
        END
    `;
}

/** Typed Myanmar label from name_mm (synced to core.core_place_names, not core_places). */
export function promotionTypedPlaceNameLocalExpr(alias: string): Prisma.Sql {
    const a = aliasRef(alias);
    return Prisma.sql`nullif(trim(${a}.name_mm), '')`;
}

export function promotionTypedPlacePrimaryNameExpr(alias: string): Prisma.Sql {
    const a = aliasRef(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.primary_name,
            ${a}.display_name,
            ${a}.name_en,
            ${a}.name_mm,
            ${a}.canonical_name,
            ''
        )), '')
    `;
}

export function promotionTypedPlaceDisplayNameExpr(alias: string): Prisma.Sql {
    const a = aliasRef(alias);
    return Prisma.sql`
        coalesce(
            nullif(trim(coalesce(
                ${a}.display_name,
                ${a}.primary_name,
                ${a}.name_en,
                ${a}.name_mm,
                ${a}.canonical_name,
                ''
            )), ''),
            ${promotionTypedPlacePrimaryNameExpr(alias)}
        )
    `;
}

/** Validated landuse_class_id from typed column only. */
export function promotionTypedLanduseClassIdExpr(alias: string): Prisma.Sql {
    const raw = columnRef(alias, "landuse_class_id");
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

export function promotionTypedLanduseClassCodeExpr(alias: string): Prisma.Sql {
    return promotionTypedClassCodeExpr(alias);
}

/** road_class_id from typed column only. */
export function promotionTypedRoadClassIdExpr(alias: string): Prisma.Sql {
    return columnRef(alias, "road_class_id");
}

export function promotionTypedRoadClassCodeExpr(alias: string): Prisma.Sql {
    const a = aliasRef(alias);
    const classId = promotionTypedRoadClassIdExpr(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            (SELECT rc.code FROM ref.ref_road_classes AS rc WHERE rc.id = ${classId}),
            ${a}.road_class,
            ${a}.class_code,
            ''
        )), '')
    `;
}

export function promotionTypedRoadTextFieldExpr(alias: string, field: string): Prisma.Sql {
    return Prisma.sql`nullif(trim(${columnRef(alias, field)}::text), '')`;
}

export function promotionTypedRoadBoolFieldExpr(
    alias: string,
    field: string,
    defaultSql: Prisma.Sql
): Prisma.Sql {
    const a = aliasRef(alias);
    const f = Prisma.raw(field);
    return Prisma.sql`coalesce(${a}.${f}, ${defaultSql})`;
}

export function promotionTypedRoadIntFieldExpr(
    alias: string,
    field: string,
    defaultSql: Prisma.Sql
): Prisma.Sql {
    const a = aliasRef(alias);
    const f = Prisma.raw(field);
    return Prisma.sql`coalesce(${a}.${f}, ${defaultSql})`;
}

export function promotionTypedBarrierTypeExpr(alias: string): Prisma.Sql {
    return Prisma.sql`nullif(trim(${columnRef(alias, "barrier_type")}::text), '')`;
}

/**
 * Building class_code for core write: ref target via building_type_id, else typed class_code only.
 */
export function promotionTypedBuildingClassCodeExpr(alias: string): Prisma.Sql {
    const a = aliasRef(alias);
    const typedClass = Prisma.sql`nullif(trim(${a}.class_code::text), '')`;
    return Prisma.sql`
        coalesce(
            (
                SELECT bt.code
                FROM ref.ref_building_types AS bt
                WHERE bt.id = ${a}.building_type_id
                LIMIT 1
            ),
            ${typedClass},
            'unknown'
        )
    `;
}

export function promotionTypedBuildingTypeIdExpr(alias: string): Prisma.Sql {
    return columnRef(alias, "building_type_id");
}

export function promotionTypedAdminAreaIdExpr(alias: string): Prisma.Sql {
    return columnRef(alias, "admin_area_id");
}
