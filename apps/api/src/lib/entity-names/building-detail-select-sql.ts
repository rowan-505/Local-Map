import { Prisma } from "@prisma/client";

import {
    deriveBuildingDisplayNameFromPriority,
    deriveCoalescedDisplayName,
} from "./derive-display-name.js";

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

/** Priority: official primary → local primary → imported primary → alternate → any. */
export const buildingNameTypePriorityOrderSql = Prisma.sql`
    CASE
        WHEN n.name_type = 'official' AND n.is_primary IS TRUE THEN 0
        WHEN n.name_type = 'local' AND n.is_primary IS TRUE THEN 1
        WHEN n.name_type = 'imported' AND n.is_primary IS TRUE THEN 2
        WHEN n.name_type = 'alternate' THEN 3
        ELSE 4
    END
`;

/**
 * Display name from core.core_map_building_names (canonical).
 * Soft-fallback to deprecated b.name only when names table has nothing.
 */
export const buildingDisplayNameCoalesceSql = Prisma.sql`COALESCE(
    (
        SELECT n.name
        FROM core.core_map_building_names AS n
        WHERE n.building_id = b.id
          AND nullif(btrim(n.name), '') IS NOT NULL
        ORDER BY
            CASE
                WHEN n.name_type = 'official' AND n.is_primary IS TRUE THEN 0
                WHEN n.name_type = 'local' AND n.is_primary IS TRUE THEN 1
                WHEN n.name_type = 'imported' AND n.is_primary IS TRUE THEN 2
                WHEN n.name_type = 'alternate' THEN 3
                ELSE 4
            END,
            n.search_weight DESC NULLS LAST,
            n.id ASC
        LIMIT 1
    ),
    -- deprecated: legacy core_map_buildings.name; do not write new values
    NULLIF(btrim(b.name), '')
)`;

export const buildingNameLabelSelectSql = Prisma.sql`
    (
        SELECT n.name
        FROM core.core_map_building_names AS n
        WHERE n.building_id = b.id
          AND nullif(btrim(n.name), '') IS NOT NULL
          AND (
              lower(trim(n.language_code)) = 'my'
              OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
          )
        ORDER BY
            CASE
                WHEN n.name_type = 'official' AND n.is_primary IS TRUE THEN 0
                WHEN n.name_type = 'local' AND n.is_primary IS TRUE THEN 1
                WHEN n.name_type = 'imported' AND n.is_primary IS TRUE THEN 2
                WHEN n.name_type = 'alternate' THEN 3
                ELSE 4
            END,
            n.search_weight DESC NULLS LAST,
            n.id ASC
        LIMIT 1
    ) AS name_mm,
    (
        SELECT n.name
        FROM core.core_map_building_names AS n
        WHERE n.building_id = b.id
          AND nullif(btrim(n.name), '') IS NOT NULL
          AND (
              lower(trim(n.language_code)) = 'en'
              OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
          )
        ORDER BY
            CASE
                WHEN n.name_type = 'official' AND n.is_primary IS TRUE THEN 0
                WHEN n.name_type = 'local' AND n.is_primary IS TRUE THEN 1
                WHEN n.name_type = 'imported' AND n.is_primary IS TRUE THEN 2
                WHEN n.name_type = 'alternate' THEN 3
                ELSE 4
            END,
            n.search_weight DESC NULLS LAST,
            n.id ASC
        LIMIT 1
    ) AS name_en,
    (
        SELECT n.name
        FROM core.core_map_building_names AS n
        WHERE n.building_id = b.id
          AND nullif(btrim(n.name), '') IS NOT NULL
        ORDER BY
            CASE
                WHEN n.name_type = 'official' AND n.is_primary IS TRUE THEN 0
                WHEN n.name_type = 'local' AND n.is_primary IS TRUE THEN 1
                WHEN n.name_type = 'imported' AND n.is_primary IS TRUE THEN 2
                WHEN n.name_type = 'alternate' THEN 3
                ELSE 4
            END,
            n.search_weight DESC NULLS LAST,
            n.id ASC
        LIMIT 1
    ) AS fallback_name,
    (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'id', n.id,
                    'name', n.name,
                    'languageCode', n.language_code,
                    'scriptCode', n.script_code,
                    'nameType', n.name_type,
                    'isPrimary', n.is_primary,
                    'searchWeight', n.search_weight
                )
                ORDER BY n.is_primary DESC, n.search_weight DESC NULLS LAST, n.id ASC
            ),
            '[]'::jsonb
        )
        FROM core.core_map_building_names AS n
        WHERE n.building_id = b.id
    ) AS names_json
`;

export type BuildingNameApiRow = {
    id?: number;
    name: string;
    languageCode: "my" | "en" | "und";
    scriptCode?: string | null;
    nameType: string;
    isPrimary: boolean;
    searchWeight: number;
};

function parseNamesJson(raw: unknown): BuildingNameApiRow[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: BuildingNameApiRow[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const row = item as Record<string, unknown>;
        const name = typeof row.name === "string" ? row.name.trim() : "";
        const languageCodeRaw =
            typeof row.languageCode === "string"
                ? row.languageCode
                : typeof row.language_code === "string"
                  ? row.language_code
                  : null;
        const languageCode =
            languageCodeRaw === "my" || languageCodeRaw === "mm"
                ? "my"
                : languageCodeRaw === "en"
                  ? "en"
                  : languageCodeRaw === "und"
                    ? "und"
                    : null;
        if (!name || !languageCode) {
            continue;
        }
        const idRaw = row.id;
        const id =
            typeof idRaw === "number"
                ? idRaw
                : typeof idRaw === "string" && /^\d+$/.test(idRaw)
                  ? Number(idRaw)
                  : undefined;
        out.push({
            ...(id !== undefined ? { id } : {}),
            name,
            languageCode,
            scriptCode:
                typeof row.scriptCode === "string"
                    ? row.scriptCode
                    : typeof row.script_code === "string"
                      ? row.script_code
                      : null,
            nameType:
                typeof row.nameType === "string"
                    ? row.nameType
                    : typeof row.name_type === "string"
                      ? row.name_type
                      : "imported",
            isPrimary: Boolean(row.isPrimary ?? row.is_primary ?? false),
            searchWeight: Number(row.searchWeight ?? row.search_weight ?? 50) || 50,
        });
    }
    return out;
}

export function mapBuildingNameFields(row: {
    name_mm: string | null;
    name_en: string | null;
    fallback_name: string | null;
    names_json?: unknown;
}) {
    const names = parseNamesJson(row.names_json);
    const name_mm = row.name_mm;
    const name_en = row.name_en;
    const fallback_name = row.fallback_name;
    const fromPriority =
        names.length > 0
            ? deriveBuildingDisplayNameFromPriority(
                  names.map((n) => ({
                      name: n.name,
                      nameType: n.nameType,
                      isPrimary: n.isPrimary,
                      searchWeight: n.searchWeight,
                  }))
              )
            : null;
    return {
        name_mm,
        name_en,
        fallback_name,
        names,
        name:
            fromPriority ??
            deriveCoalescedDisplayName({ name_mm, name_en, fallback_name }),
    };
}
