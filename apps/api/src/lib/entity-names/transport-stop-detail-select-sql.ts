import { Prisma } from "@prisma/client";

import {
    ENGLISH_LANGUAGE_CODE,
    MYANMAR_LANGUAGE_CODE,
    UNKNOWN_LANGUAGE_CODE,
    trimName,
} from "./derive-display-name.js";
import {
    resolveTransportStopDisplayName,
    type TransportStopDisplayLang,
} from "./resolve-transport-stop-display-name.js";
import { enrichTransportStopPrimaryNames } from "./transport-stop-primary-names.js";

const PRIMARY_NAME_ORDER_SQL = Prisma.sql`
    CASE
        WHEN x.name_type = 'official' AND x.is_primary IS TRUE THEN 1
        WHEN x.is_primary IS TRUE THEN 2
        WHEN x.name_type = 'official' THEN 3
        ELSE 4
    END,
    x.search_weight DESC NULLS LAST,
    x.name ASC
`;

/**
 * Primary localized names from `transport.stop_names` for public stop detail.
 * Does not read derived cache columns on `transport.stops` (name_mm/name_en).
 */
export const transportStopNameLabelSelectSql = Prisma.sql`
    (
        SELECT x.name
        FROM transport.stop_names AS x
        WHERE x.stop_id = s.id
          AND (
              lower(btrim(coalesce(x.language_code, ''))) = ${MYANMAR_LANGUAGE_CODE}
              OR upper(btrim(coalesce(x.script_code, ''))) = 'MYMR'
          )
        ORDER BY ${PRIMARY_NAME_ORDER_SQL}
        LIMIT 1
    ) AS name_mm,
    (
        SELECT x.name
        FROM transport.stop_names AS x
        WHERE x.stop_id = s.id
          AND (
              lower(btrim(coalesce(x.language_code, ''))) = ${ENGLISH_LANGUAGE_CODE}
              OR upper(btrim(coalesce(x.script_code, ''))) = 'LATN'
          )
        ORDER BY ${PRIMARY_NAME_ORDER_SQL}
        LIMIT 1
    ) AS name_en,
    (
        SELECT x.name
        FROM transport.stop_names AS x
        WHERE x.stop_id = s.id
          AND lower(btrim(coalesce(x.language_code, ''))) = ${UNKNOWN_LANGUAGE_CODE}
        ORDER BY ${PRIMARY_NAME_ORDER_SQL}
        LIMIT 1
    ) AS name_und,
    NULLIF(btrim(s.name), '') AS canonical_name
`;

export type TransportStopNameRow = {
    name_mm: string | null;
    name_en: string | null;
    name_und: string | null;
    canonical_name: string | null;
};

export function mapTransportStopNameFields(
    row: TransportStopNameRow,
    options?: {
        lang?: TransportStopDisplayLang | null;
        typeFallback?: string;
        sanitize?: (value: string | null | undefined) => string | null;
    },
) {
    const sanitize = options?.sanitize ?? trimName;
    const name_und = sanitize(row.name_und);
    const canonical_name = sanitize(row.canonical_name);
    const enriched = enrichTransportStopPrimaryNames({
        name_mm: sanitize(row.name_mm),
        name_en: sanitize(row.name_en),
        name_und,
        canonical_name,
    });
    const name_mm = enriched.name_mm;
    const name_en = enriched.name_en;
    const display_name = resolveTransportStopDisplayName({
        lang: options?.lang,
        name_mm,
        name_en,
        name_und,
        canonical_name,
        typeFallback: options?.typeFallback,
    });

    return {
        name_mm,
        name_en,
        name_my: name_mm,
        name_und,
        canonical_name,
        myanmar_name: name_mm,
        english_name: name_en,
        name: display_name,
        display_name,
        primary_name: display_name,
    };
}
