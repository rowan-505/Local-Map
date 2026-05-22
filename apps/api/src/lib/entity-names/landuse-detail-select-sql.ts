import { Prisma } from "@prisma/client";

import { deriveCoalescedDisplayName } from "./derive-display-name.js";

/** Primary official Myanmar/English feature names for core landuse polygons. */
export const landuseNameLabelSelectSql = Prisma.sql`
    (
        SELECT n.name
        FROM core.core_map_landuse_names AS n
        WHERE n.landuse_id = lu.id
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
        FROM core.core_map_landuse_names AS n
        WHERE n.landuse_id = lu.id
          AND n.is_primary IS TRUE
          AND n.name_type = 'official'
          AND lower(trim(n.language_code)) = 'en'
        ORDER BY n.search_weight DESC, n.id ASC
        LIMIT 1
    ) AS name_en,
    (
        SELECT n.name
        FROM core.core_map_landuse_names AS n
        WHERE n.landuse_id = lu.id
          AND n.is_primary IS TRUE
          AND n.name_type = 'official'
          AND lower(trim(n.language_code)) = 'und'
        ORDER BY n.search_weight DESC, n.id ASC
        LIMIT 1
    ) AS name_und,
    NULLIF(btrim(lu.name), '') AS fallback_name
`;

export function mapLanduseNameFields(row: {
    name_mm: string | null;
    name_en: string | null;
    name_und?: string | null;
    fallback_name: string | null;
}) {
    const name_mm = row.name_mm;
    const name_en = row.name_en;
    const fallback_name = row.fallback_name;
    return {
        name_mm,
        name_en,
        name_und: row.name_und ?? null,
        fallback_name,
        name: deriveCoalescedDisplayName({ name_mm, name_en, fallback_name }),
    };
}
