import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { externalIdExpr, mapClassCodeExpr, nameExpr } from "./import-review-promotion-promote-sql.js";
import {
    deriveImportReviewNames,
    pickEffectiveDisplayName,
    type ImportReviewNameCandidate,
} from "./import-review-name-fields.js";
import type { ImportReviewBuildingListItem } from "./import-review.types.js";

export type EffectiveFieldSource = "column" | "normalized";

export type EffectiveFieldDef = {
    /** API response key, e.g. effective_name */
    effectiveKey: string;
    /** review_overrides / patch key */
    overrideKey: string;
    /** Fallback sources after override (column first, then normalized_data) */
    columnKey?: string;
    normalizedKey?: string;
    type: "string" | "bigint" | "number" | "boolean";
};

export type EffectiveValuesRawRow = {
    name?: string | null;
    name_mm?: string | null;
    name_en?: string | null;
    canonical_name?: string | null;
    class_code?: string | null;
    landuse_class_id?: bigint | null;
    admin_area_id?: bigint | null;
    levels?: number | null;
    height_m?: unknown;
    normalized_data?: unknown;
    review_overrides?: unknown;
    /** From SQL join when effectiveAdminAreaJoin is enabled */
    effective_admin_area_name?: string | null;
    /** Extra column fields not in BuildingListRowDb padding */
    name_local?: string | null;
    stop_code?: string | null;
};

function asOverrideRecord(review_overrides: unknown): Record<string, unknown> {
    if (review_overrides && typeof review_overrides === "object" && !Array.isArray(review_overrides)) {
        return review_overrides as Record<string, unknown>;
    }
    return {};
}

function normPick(data: unknown, key: string): unknown {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return undefined;
    }
    const o = data as Record<string, unknown>;
    if (key in o) {
        return o[key];
    }
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camel in o) {
        return o[camel];
    }
    return undefined;
}

export function pickEffectiveString(
    overrideKey: string,
    overrides: Record<string, unknown>,
    ...fallbacks: unknown[]
): string | null {
    if (Object.prototype.hasOwnProperty.call(overrides, overrideKey)) {
        const v = overrides[overrideKey];
        if (v === null || v === undefined) {
            return null;
        }
        if (typeof v === "boolean") {
            return v ? "true" : "false";
        }
        return String(v);
    }
    for (const fb of fallbacks) {
        if (fb === null || fb === undefined) {
            continue;
        }
        const s = String(fb);
        return s;
    }
    return null;
}

export function pickEffectiveBigint(
    overrideKey: string,
    overrides: Record<string, unknown>,
    ...fallbacks: unknown[]
): string | null {
    if (Object.prototype.hasOwnProperty.call(overrides, overrideKey)) {
        const v = overrides[overrideKey];
        if (v === null || v === undefined) {
            return null;
        }
        if (typeof v === "bigint") {
            return v.toString();
        }
        if (typeof v === "number" && Number.isFinite(v)) {
            return String(Math.trunc(v));
        }
        const s = String(v).trim();
        return /^\d+$/.test(s) ? s : null;
    }
    for (const fb of fallbacks) {
        if (fb === null || fb === undefined) {
            continue;
        }
        if (typeof fb === "bigint") {
            return fb.toString();
        }
        if (typeof fb === "number" && Number.isFinite(fb)) {
            return String(Math.trunc(fb));
        }
        const s = String(fb).trim();
        if (/^\d+$/.test(s)) {
            return s;
        }
    }
    return null;
}

export function pickEffectiveNumber(
    overrideKey: string,
    overrides: Record<string, unknown>,
    ...fallbacks: unknown[]
): number | null {
    if (Object.prototype.hasOwnProperty.call(overrides, overrideKey)) {
        const v = overrides[overrideKey];
        if (v === null || v === undefined) {
            return null;
        }
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : null;
    }
    for (const fb of fallbacks) {
        if (fb === null || fb === undefined) {
            continue;
        }
        const n = typeof fb === "number" ? fb : Number(fb);
        if (Number.isFinite(n)) {
            return n;
        }
    }
    return null;
}

export function computeOverrideMeta(overrides: unknown): {
    has_overrides: boolean;
    overridden_fields: string[];
} {
    const ov = asOverrideRecord(overrides);
    const overridden_fields = Object.keys(ov).filter((key) => ov[key] !== null && ov[key] !== undefined);
    return {
        has_overrides: overridden_fields.length > 0,
        overridden_fields,
    };
}

const STRING_FIELD = (
    effectiveKey: string,
    overrideKey: string,
    columnKey?: string,
    normalizedKey?: string
): EffectiveFieldDef => ({
    effectiveKey,
    overrideKey,
    columnKey: columnKey ?? overrideKey,
    normalizedKey: normalizedKey ?? overrideKey,
    type: "string",
});

const BIGINT_FIELD = (effectiveKey: string, overrideKey: string, columnKey?: string): EffectiveFieldDef => ({
    effectiveKey,
    overrideKey,
    columnKey: columnKey ?? overrideKey,
    normalizedKey: overrideKey,
    type: "bigint",
});

const NUMBER_FIELD = (effectiveKey: string, overrideKey: string, columnKey?: string): EffectiveFieldDef => ({
    effectiveKey,
    overrideKey,
    columnKey: columnKey ?? overrideKey,
    normalizedKey: overrideKey,
    type: "number",
});

const NORMALIZED_STRING = (effectiveKey: string, overrideKey: string): EffectiveFieldDef => ({
    effectiveKey,
    overrideKey,
    normalizedKey: overrideKey,
    type: "string",
});

/** Per-family overrideable fields and effective API keys. */
export const IMPORT_REVIEW_EFFECTIVE_FIELD_REGISTRY: Partial<
    Record<ImportReviewEntityFamilySlug, readonly EffectiveFieldDef[]>
> = {
    bus_stops: [
        STRING_FIELD("effective_stop_code", "stop_code"),
        BIGINT_FIELD("effective_admin_area_id", "admin_area_id"),
    ],
    buildings: [
        BIGINT_FIELD("effective_admin_area_id", "admin_area_id"),
        NUMBER_FIELD("effective_levels", "levels"),
        NUMBER_FIELD("effective_height_m", "height_m"),
    ],
    places: [
        BIGINT_FIELD("effective_admin_area_id", "admin_area_id"),
        STRING_FIELD("effective_class_code", "class_code"),
    ],
    landuse: [STRING_FIELD("effective_class_code", "class_code"), BIGINT_FIELD("effective_landuse_class_id", "landuse_class_id")],
    water_lines: [STRING_FIELD("effective_class_code", "class_code")],
    water_polygons: [STRING_FIELD("effective_class_code", "class_code")],
    // addresses: composed full address from import_review.address_components (see import-review-address-responses.ts)
    admin_areas: [
        BIGINT_FIELD("effective_admin_level_id", "admin_level_id", "admin_area_id"),
        BIGINT_FIELD("effective_parent_id", "parent_id"),
        STRING_FIELD("effective_slug", "slug", "name"),
    ],
    routing_barriers: [
        STRING_FIELD("effective_barrier_type", "barrier_type", "name"),
        STRING_FIELD("effective_class_code", "class_code"),
    ],
    // TODO: roads use dedicated effective-state path (import-review-road-overrides-validator)
};

function resolveColumnValue(raw: EffectiveValuesRawRow, columnKey: string): unknown {
    const row = raw as Record<string, unknown>;
    if (columnKey in row) {
        return row[columnKey];
    }
    return undefined;
}

function normTagPick(data: unknown, tagKey: string): unknown {
    const tags = normPick(data, "tags");
    if (tags && typeof tags === "object" && !Array.isArray(tags)) {
        return (tags as Record<string, unknown>)[tagKey];
    }
    return undefined;
}

function importedClassCodeFallbacks(
    family: ImportReviewEntityFamilySlug,
    normalized_data: unknown
): unknown[] {
    const tagKeysByFamily: Partial<Record<ImportReviewEntityFamilySlug, readonly string[]>> = {
        water_lines: ["waterway"],
        water_polygons: ["water", "natural"],
        landuse: ["landuse", "amenity", "natural"],
    };
    const keys = tagKeysByFamily[family] ?? [];
    const fallbacks: unknown[] = [];
    for (const key of keys) {
        fallbacks.push(normTagPick(normalized_data, key));
        fallbacks.push(normPick(normalized_data, key));
    }
    return fallbacks;
}

function pickEffectiveClassCode(
    family: ImportReviewEntityFamilySlug,
    overrides: Record<string, unknown>,
    columnVal: unknown,
    normVal: unknown,
    normalized_data: unknown
): string | null {
    if (Object.prototype.hasOwnProperty.call(overrides, "class_code")) {
        return pickEffectiveString("class_code", overrides);
    }
    if (family === "water_lines" && Object.prototype.hasOwnProperty.call(overrides, "waterway_class")) {
        return pickEffectiveString("waterway_class", overrides);
    }
    if (family === "water_polygons" && Object.prototype.hasOwnProperty.call(overrides, "water_class")) {
        return pickEffectiveString("water_class", overrides);
    }
    return pickEffectiveString(
        "class_code",
        overrides,
        columnVal,
        normVal,
        ...importedClassCodeFallbacks(family, normalized_data)
    );
}

function computeEffectiveField(
    def: EffectiveFieldDef,
    overrides: Record<string, unknown>,
    raw: EffectiveValuesRawRow,
    family?: ImportReviewEntityFamilySlug
): unknown {
    const columnVal = def.columnKey ? resolveColumnValue(raw, def.columnKey) : undefined;
    const normVal = def.normalizedKey ? normPick(raw.normalized_data, def.normalizedKey) : undefined;

    switch (def.type) {
        case "string":
            if (def.overrideKey === "class_code" && family) {
                return pickEffectiveClassCode(family, overrides, columnVal, normVal, raw.normalized_data);
            }
            return pickEffectiveString(def.overrideKey, overrides, columnVal, normVal);
        case "bigint":
            return pickEffectiveBigint(def.overrideKey, overrides, columnVal, normVal);
        case "number":
            return pickEffectiveNumber(def.overrideKey, overrides, columnVal, normVal);
        default:
            return null;
    }
}

const BILINGUAL_NAME_FAMILIES = new Set<ImportReviewEntityFamilySlug>([
    "bus_stops",
    "buildings",
    "places",
    "roads",
    "landuse",
    "water_lines",
    "water_polygons",
    "admin_areas",
]);

function toNameCandidate(
    raw: EffectiveValuesRawRow,
    item?: ImportReviewBuildingListItem
): ImportReviewNameCandidate {
    return {
        review_overrides: raw.review_overrides,
        canonical_name: raw.canonical_name ?? null,
        normalized_data: raw.normalized_data,
        class_code: raw.class_code ?? null,
        external_id: item?.external_id ?? null,
        name: raw.name ?? item?.name ?? null,
    };
}

function applyBilingualNameFields(
    item: ImportReviewBuildingListItem,
    overrides: Record<string, unknown>,
    raw: EffectiveValuesRawRow
): ImportReviewBuildingListItem {
    const candidate = { ...toNameCandidate(raw, item), review_overrides: overrides };
    const { name_mm: effective_name_mm, name_en: effective_name_en, name_und: effective_name_und } =
        deriveImportReviewNames(candidate);
    const effective_name = pickEffectiveDisplayName(overrides, candidate);
    return {
        ...item,
        name_mm: effective_name_mm,
        name_en: effective_name_en,
        effective_name_mm,
        effective_name_en,
        effective_name_und,
        effective_name,
        effective_name_local: effective_name_mm,
        effective_canonical_name: effective_name_en ?? effective_name_mm,
    };
}

/** Bus-stop-specific extras beyond bilingual names. */
function applyBusStopEffectiveExtras(
    item: ImportReviewBuildingListItem,
    overrides: Record<string, unknown>,
    raw: EffectiveValuesRawRow
): ImportReviewBuildingListItem {
    const withNames = applyBilingualNameFields(item, overrides, raw);
    const effective_stop_code = pickEffectiveString(
        "stop_code",
        overrides,
        raw.stop_code,
        normPick(raw.normalized_data, "stop_code")
    );
    const effective_admin_area_id = pickEffectiveBigint(
        "admin_area_id",
        overrides,
        raw.admin_area_id,
        normPick(raw.normalized_data, "admin_area_id")
    );

    return {
        ...withNames,
        effective_stop_code,
        effective_admin_area_id,
        effective_admin_area_name: raw.effective_admin_area_name ?? item.effective_admin_area_name ?? null,
    };
}

export function applyImportReviewEffectiveFields(
    family: ImportReviewEntityFamilySlug,
    baseItem: ImportReviewBuildingListItem,
    rawRow?: EffectiveValuesRawRow
): ImportReviewBuildingListItem {
    const raw: EffectiveValuesRawRow = rawRow ?? {
        name: baseItem.name,
        canonical_name: baseItem.canonical_name,
        class_code: baseItem.class_code,
        admin_area_id: baseItem.admin_area_id ? BigInt(baseItem.admin_area_id) : null,
        levels: baseItem.levels,
        height_m: baseItem.height_m,
        normalized_data: baseItem.normalized_data,
        review_overrides: baseItem.review_overrides,
        effective_admin_area_name: baseItem.effective_admin_area_name ?? null,
    };

    const overrides = asOverrideRecord(raw.review_overrides ?? baseItem.review_overrides);
    const meta = computeOverrideMeta(overrides);
    const defs = IMPORT_REVIEW_EFFECTIVE_FIELD_REGISTRY[family];

    let enriched: ImportReviewBuildingListItem = {
        ...baseItem,
        has_overrides: meta.has_overrides,
        overridden_fields: meta.overridden_fields,
    };

    if (family === "bus_stops") {
        enriched = applyBusStopEffectiveExtras(enriched, overrides, raw);
        if (raw.effective_admin_area_name) {
            enriched = { ...enriched, effective_admin_area_name: raw.effective_admin_area_name };
        }
        return enriched;
    }

    if (BILINGUAL_NAME_FAMILIES.has(family)) {
        enriched = applyBilingualNameFields(enriched, overrides, raw);
    }

    if (!defs || defs.length === 0) {
        return enriched;
    }

    const effectivePatch: Record<string, unknown> = {};
    for (const def of defs) {
        effectivePatch[def.effectiveKey] = computeEffectiveField(def, overrides, raw, family);
    }

    enriched = {
        ...enriched,
        ...effectivePatch,
        effective_admin_area_name:
            raw.effective_admin_area_name ?? enriched.effective_admin_area_name ?? null,
    };

    return enriched;
}

// --- SQL expression builders (shared with promotion + validation) ---

export function busStopStopCodeExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.review_overrides->>'stop_code',
            ${a}.stop_code,
            ${a}.normalized_data->>'stop_code',
            ''
        )), '')
    `;
}

export function busStopNameMmExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.review_overrides->>'name_mm',
            ${a}.normalized_data->'tags'->>'name',
            ${a}.canonical_name,
            ''
        )), '')
    `;
}

export function busStopNameEnExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.review_overrides->>'name_en',
            ${a}.normalized_data->'tags'->>'name:en',
            ''
        )), '')
    `;
}

export function busStopPrimaryRealNameExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${busStopNameEnExpr(alias)},
            ${busStopNameMmExpr(alias)},
            ''
        )), '')
    `;
}

export function busStopNameExpr(alias: string): Prisma.Sql {
    return busStopNameEnExpr(alias);
}

export function busStopNameLocalExpr(alias: string): Prisma.Sql {
    return busStopNameMmExpr(alias);
}

export function busStopDisplayNameExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        coalesce(
            ${busStopPrimaryRealNameExpr(alias)},
            CASE
                WHEN ${busStopStopCodeExpr(alias)} IS NOT NULL
                    THEN 'Bus stop ' || ${busStopStopCodeExpr(alias)}
            END,
            CASE
                WHEN ${externalIdExpr(alias)} IS NOT NULL
                    THEN 'Bus stop ' || ${externalIdExpr(alias)}
            END,
            'Unnamed bus stop'
        )
    `;
}

export function busStopPointGeomExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        CASE
            WHEN ${a}.review_overrides ? 'geom'
                 AND ${a}.review_overrides->'geom' IS NOT NULL
                 AND jsonb_typeof(${a}.review_overrides->'geom') = 'object'
            THEN ST_SetSRID(ST_GeomFromGeoJSON(${a}.review_overrides->'geom'), 4326)
            WHEN ${a}.review_overrides ? 'point_geom'
                 AND ${a}.review_overrides->'point_geom' IS NOT NULL
                 AND jsonb_typeof(${a}.review_overrides->'point_geom') = 'object'
            THEN ST_SetSRID(ST_GeomFromGeoJSON(${a}.review_overrides->'point_geom'), 4326)
            WHEN ${a}.geom IS NOT NULL THEN ${a}.geom
            ELSE NULL::geometry(Point, 4326)
        END
    `;
}

/** Raw effective admin_area_id (no FK existence check) — for validation/read joins. */
export function busStopEffectiveAdminAreaIdRawExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        coalesce(
            CASE WHEN (${a}.review_overrides->>'admin_area_id') ~ '^[0-9]+$'
                THEN (${a}.review_overrides->>'admin_area_id')::bigint END,
            ${a}.admin_area_id,
            CASE WHEN (${a}.normalized_data->>'admin_area_id') ~ '^[0-9]+$'
                THEN (${a}.normalized_data->>'admin_area_id')::bigint END
        )
    `;
}

export function busStopAdminAreaIdExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        CASE
            WHEN ${busStopEffectiveAdminAreaIdRawExpr(alias)} IS NULL THEN NULL::bigint
            WHEN EXISTS (
                SELECT 1 FROM core.core_admin_areas AS aa
                WHERE aa.id = ${busStopEffectiveAdminAreaIdRawExpr(alias)}
            ) THEN ${busStopEffectiveAdminAreaIdRawExpr(alias)}
            ELSE NULL::bigint
        END
    `;
}

export function effectiveAdminAreaIdExpr(configTableAlias: string): Prisma.Sql {
    const a = Prisma.raw(configTableAlias);
    return Prisma.sql`
        coalesce(
            CASE WHEN (${a}.review_overrides->>'admin_area_id') ~ '^[0-9]+$'
                THEN (${a}.review_overrides->>'admin_area_id')::bigint END,
            ${a}.admin_area_id,
            CASE WHEN (${a}.normalized_data->>'admin_area_id') ~ '^[0-9]+$'
                THEN (${a}.normalized_data->>'admin_area_id')::bigint END
        )
    `;
}

export { nameExpr, mapClassCodeExpr };
