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

/**
 * Legacy `core.core_buildings.name` is unused.
 * Canonical building names are written to `core.core_building_names` after promote.
 */
export function promotionTypedBuildingNameExpr(_alias: string): Prisma.Sql {
    return Prisma.sql`NULL::text`;
}

/**
 * Upsert approved building names into core.core_building_names.
 * Source: normalized_data.names when present, else typed name_mm / name_en / name as imported.
 * ON CONFLICT identity → DO NOTHING (never overwrite official/local/alternate/old rows).
 * is_primary for imported only when no primary exists for that language.
 */
export function promotionBuildingNamesUpsertSql(args: {
    buildingId: bigint;
    publishItemId: bigint;
    candidateTable?: string;
}): Prisma.Sql {
    const candidateTable = Prisma.raw(
        args.candidateTable ?? "import_review.building_candidates"
    );
    return Prisma.sql`
        WITH src AS (
            SELECT
                b.normalized_data,
                nullif(btrim(b.name_mm), '') AS name_mm,
                nullif(btrim(b.name_en), '') AS name_en,
                nullif(btrim(b.name), '') AS name_plain
            FROM system.system_publish_items AS spi
            INNER JOIN ${candidateTable} AS b
                ON b.id = spi.review_candidate_id
            WHERE spi.id = ${args.publishItemId}
            LIMIT 1
        ),
        from_json AS (
            SELECT
                nullif(btrim(coalesce(elem->>'name', '')), '') AS name,
                CASE
                    WHEN lower(btrim(coalesce(
                        elem->>'language_code',
                        elem->>'languageCode',
                        ''
                    ))) IN ('my', 'mm', 'my-mm') THEN 'my'
                    WHEN lower(btrim(coalesce(
                        elem->>'language_code',
                        elem->>'languageCode',
                        ''
                    ))) = 'en' THEN 'en'
                    WHEN lower(btrim(coalesce(
                        elem->>'language_code',
                        elem->>'languageCode',
                        ''
                    ))) = 'und' THEN 'und'
                    ELSE NULL
                END AS language_code,
                nullif(btrim(coalesce(elem->>'script_code', elem->>'scriptCode', '')), '') AS script_code,
                coalesce(
                    (elem->>'is_primary')::boolean,
                    (elem->>'isPrimary')::boolean,
                    false
                ) AS wants_primary,
                coalesce(
                    (elem->>'search_weight')::int,
                    (elem->>'searchWeight')::int,
                    50
                ) AS search_weight
            FROM src AS s
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(s.normalized_data->'names') = 'array'
                        THEN s.normalized_data->'names'
                    ELSE '[]'::jsonb
                END
            ) AS elem
            WHERE nullif(btrim(coalesce(elem->>'name', '')), '') IS NOT NULL
        ),
        typed_fallback AS (
            SELECT
                v.name,
                v.language_code,
                v.script_code,
                v.wants_primary,
                v.search_weight
            FROM src AS s
            CROSS JOIN LATERAL (
                VALUES
                    (s.name_mm, 'my'::text, 'Mymr'::text, true, 100),
                    (s.name_en, 'en'::text, 'Latn'::text, true, 90),
                    (s.name_plain, 'und'::text, NULL::text, true, 70)
            ) AS v(name, language_code, script_code, wants_primary, search_weight)
            WHERE v.name IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM from_json)
        ),
        source_names AS (
            SELECT name, language_code, script_code, wants_primary, search_weight
            FROM from_json
            WHERE language_code IS NOT NULL
            UNION ALL
            SELECT name, language_code, script_code, wants_primary, search_weight
            FROM typed_fallback
        ),
        dedup AS (
            SELECT DISTINCT ON (language_code, lower(btrim(name)))
                name,
                language_code,
                script_code,
                wants_primary,
                search_weight
            FROM source_names
            ORDER BY
                language_code,
                lower(btrim(name)),
                wants_primary DESC,
                search_weight DESC
        ),
        ranked AS (
            SELECT
                d.*,
                row_number() OVER (
                    PARTITION BY d.language_code
                    ORDER BY d.wants_primary DESC, d.search_weight DESC
                ) AS rn
            FROM dedup AS d
        )
        INSERT INTO core.core_building_names (
            building_id,
            name,
            language_code,
            script_code,
            name_type,
            is_primary,
            search_weight
        )
        SELECT
            ${args.buildingId},
            r.name,
            r.language_code,
            r.script_code,
            'imported',
            (
                r.wants_primary
                AND r.rn = 1
                AND NOT EXISTS (
                    SELECT 1
                    FROM core.core_building_names AS existing
                    WHERE existing.building_id = ${args.buildingId}
                      AND existing.language_code = r.language_code
                      AND existing.is_primary IS TRUE
                )
            ),
            r.search_weight
        FROM ranked AS r
        ON CONFLICT (building_id, language_code, name_type, (lower(btrim(name)))) DO NOTHING
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

/** Validated land_area_class_id from typed column only. */
export function promotionTypedLandAreaClassIdExpr(alias: string): Prisma.Sql {
    const raw = columnRef(alias, "land_area_class_id");
    return Prisma.sql`
        CASE
            WHEN ${raw} IS NULL THEN NULL::bigint
            WHEN EXISTS (
                SELECT 1 FROM ref.ref_land_area_classes AS lc
                WHERE lc.id = ${raw}
                  AND coalesce(lc.is_active, true)
            ) THEN ${raw}
            ELSE NULL::bigint
        END
    `;
}

export function promotionTypedLandAreaClassCodeExpr(alias: string): Prisma.Sql {
    return promotionTypedClassCodeExpr(alias);
}

/**
 * Water class id: typed water_class_id when valid, else lookup by typed class_code
 * against ref.ref_water_classes (active).
 */
export function promotionTypedWaterClassIdExpr(alias: string): Prisma.Sql {
    const a = aliasRef(alias);
    const raw = columnRef(alias, "water_class_id");
    const classCode = Prisma.sql`nullif(trim(coalesce(${a}.class_code, '')), '')`;
    return Prisma.sql`
        CASE
            WHEN ${raw} IS NOT NULL AND EXISTS (
                SELECT 1 FROM ref.ref_water_classes AS wc
                WHERE wc.id = ${raw}
                  AND coalesce(wc.is_active, true)
            ) THEN ${raw}
            WHEN ${classCode} IS NOT NULL THEN (
                SELECT wc.id
                FROM ref.ref_water_classes AS wc
                WHERE wc.code = lower(${classCode})
                  AND coalesce(wc.is_active, true)
                LIMIT 1
            )
            ELSE NULL::bigint
        END
    `;
}

/** Legacy class_code synced from resolved water_class_id. */
export function promotionTypedWaterClassCodeExpr(alias: string): Prisma.Sql {
    const classId = promotionTypedWaterClassIdExpr(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            (SELECT wc.code FROM ref.ref_water_classes AS wc WHERE wc.id = ${classId}),
            ''
        )), '')
    `;
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
