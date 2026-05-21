import { Prisma } from "@prisma/client";

import { deriveCoalescedDisplayName } from "./derive-display-name.js";

/** Lateral selects for primary official Myanmar/English building names. */
/**
 * Building type/class label when `core.core_map_buildings.class_code` is not present
 * (use ref FK + normalized_data fallbacks).
 */
export const buildingClassCodeCoalesceSql = Prisma.sql`COALESCE(
    bt.code,
    NULLIF(btrim(b.normalized_data->>'class_code'), ''),
    NULLIF(btrim(b.normalized_data->>'building_type'), ''),
    'yes'
)`;

export const buildingClassCodeSelectSql = Prisma.sql`${buildingClassCodeCoalesceSql}::text AS class_code`;

export const buildingNameLabelSelectSql = Prisma.sql`
    (
        SELECT n.name
        FROM core.core_map_building_names AS n
        WHERE n.building_id = b.id
          AND n.is_primary IS TRUE
          AND n.name_type = 'official'
          AND (
              lower(trim(n.language_code)) IN ('my', 'mm')
              OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
          )
        ORDER BY
            CASE lower(trim(n.language_code))
                WHEN 'my' THEN 0
                WHEN 'mm' THEN 1
                ELSE 2
            END,
            n.search_weight DESC,
            n.id ASC
        LIMIT 1
    ) AS name_mm,
    (
        SELECT n.name
        FROM core.core_map_building_names AS n
        WHERE n.building_id = b.id
          AND n.is_primary IS TRUE
          AND n.name_type = 'official'
          AND (
              lower(trim(n.language_code)) = 'en'
              OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
          )
        ORDER BY n.search_weight DESC, n.id ASC
        LIMIT 1
    ) AS name_en,
    NULLIF(btrim(b.name), '') AS fallback_name
`;

export function mapBuildingNameFields(row: {
    name_mm: string | null;
    name_en: string | null;
    fallback_name: string | null;
}) {
    const name_mm = row.name_mm;
    const name_en = row.name_en;
    const fallback_name = row.fallback_name;
    return {
        name_mm,
        name_en,
        fallback_name,
        name: deriveCoalescedDisplayName({ name_mm, name_en, fallback_name }),
    };
}
