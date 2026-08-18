import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import type { ImportReviewBuildingListItem } from "./import-review.types.js";
import { externalIdExpr, mapClassCodeExpr, nameExpr } from "./import-review-promotion-promote-sql.js";
import {
    deriveImportReviewNames,
    pickEffectiveDisplayName,
    type ImportReviewNameCandidate,
} from "./import-review-name-fields.js";
import {
    effectiveAdminAreaIdExpr as buildEffectiveAdminAreaIdExpr,
} from "./import-review-candidate-column-registry.js";
import { overrideAllowlistForFamily } from "./import-review-overrides-allowlist.js";

export type EffectiveFieldSource = "column" | "normalized";

export type EffectiveFieldDef = {
    /** API response key, e.g. effective_name */
    effectiveKey: string;
    /** PATCH / column key */
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
    stop_code?: string | null;
    canonical_name?: string | null;
    class_code?: string | null;
    barrier_type?: string | null;
    category_id?: bigint | null;
    land_area_class_id?: bigint | null;
    water_class_id?: bigint | null;
    admin_area_id?: bigint | null;
    levels?: number | null;
    height_m?: unknown;
    normalized_data?: unknown;
    /** From SQL join when effectiveAdminAreaJoin is enabled */
    effective_admin_area_name?: string | null;
    /** Extra column fields not in BuildingListRowDb padding */
    name_local?: string | null;
};

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
    for (const fb of fallbacks) {
        if (fb === null || fb === undefined) {
            continue;
        }
        const s = String(fb);
        return s;
    }
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
    return null;
}

export function pickEffectiveBigint(
    overrideKey: string,
    overrides: Record<string, unknown>,
    ...fallbacks: unknown[]
): string | null {
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
    return null;
}

export function pickEffectiveNumber(
    overrideKey: string,
    overrides: Record<string, unknown>,
    ...fallbacks: unknown[]
): number | null {
    for (const fb of fallbacks) {
        if (fb === null || fb === undefined) {
            continue;
        }
        const n = typeof fb === "number" ? fb : Number(fb);
        if (Number.isFinite(n)) {
            return n;
        }
    }
    if (Object.prototype.hasOwnProperty.call(overrides, overrideKey)) {
        const v = overrides[overrideKey];
        if (v === null || v === undefined) {
            return null;
        }
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

export function computeColumnEditMeta(
    family: ImportReviewEntityFamilySlug,
    raw: EffectiveValuesRawRow
): {
    has_overrides: boolean;
    overridden_fields: string[];
} {
    const allowlist = overrideAllowlistForFamily(family);
    const overridden_fields: string[] = [];
    for (const key of allowlist) {
        const v = resolveColumnValue(raw, key);
        if (v !== null && v !== undefined && v !== "") {
            overridden_fields.push(key);
        }
    }
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
    buildings: [
        BIGINT_FIELD("effective_admin_area_id", "admin_area_id"),
        NUMBER_FIELD("effective_levels", "levels"),
        NUMBER_FIELD("effective_height_m", "height_m"),
    ],
    places: [
        BIGINT_FIELD("effective_admin_area_id", "admin_area_id"),
        STRING_FIELD("effective_class_code", "class_code"),
    ],
    land_areas: [STRING_FIELD("effective_class_code", "class_code"), BIGINT_FIELD("effective_land_area_class_id", "land_area_class_id")],
    water_lines: [
        STRING_FIELD("effective_class_code", "class_code"),
        BIGINT_FIELD("effective_water_class_id", "water_class_id"),
    ],
    water_polygons: [
        STRING_FIELD("effective_class_code", "class_code"),
        BIGINT_FIELD("effective_water_class_id", "water_class_id"),
    ],
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
        land_areas: ["landuse", "amenity", "natural"],
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
    "buildings",
    "places",
    "roads",
    "land_areas",
    "water_lines",
    "water_polygons",
    "admin_areas",
]);

function toNameCandidate(
    raw: EffectiveValuesRawRow,
    item?: ImportReviewBuildingListItem
): ImportReviewNameCandidate {
    const candidate: ImportReviewNameCandidate = {
        canonical_name: raw.canonical_name ?? null,
        normalized_data: raw.normalized_data,
        class_code: raw.class_code ?? null,
        external_id: item?.external_id ?? null,
        name: raw.name ?? item?.name ?? null,
    };
    const nameMm = raw.name_mm ?? item?.name_mm;
    if (nameMm !== undefined) {
        candidate.name_mm = nameMm;
    }
    const nameEn = raw.name_en ?? item?.name_en;
    if (nameEn !== undefined) {
        candidate.name_en = nameEn;
    }
    return candidate;
}

function typedNameFromRow(
    raw: EffectiveValuesRawRow,
    item: ImportReviewBuildingListItem,
    key: "name_mm" | "name_en"
): string | null {
    const fromRaw = raw[key];
    if (fromRaw !== undefined && fromRaw !== null && String(fromRaw).trim() !== "") {
        return String(fromRaw).trim();
    }
    const fromItem = item[key];
    if (fromItem !== undefined && fromItem !== null && String(fromItem).trim() !== "") {
        return String(fromItem).trim();
    }
    return null;
}

/**
 * Maps typed `name_mm` / `name_en` onto API item and legacy `effective_name_*` fields.
 * Typed direct-edit columns win over source/legacy names — see docs/import-review/naming-contract.md.
 */
function applyBilingualNameFields(
    item: ImportReviewBuildingListItem,
    raw: EffectiveValuesRawRow
): ImportReviewBuildingListItem {
    const candidate = toNameCandidate(raw, item);
    const emptyOverrides: Record<string, unknown> = {};
    const derived = deriveImportReviewNames(candidate);
    const typed_name_mm = typedNameFromRow(raw, item, "name_mm");
    const typed_name_en = typedNameFromRow(raw, item, "name_en");
    const effective_name_mm = typed_name_mm ?? derived.name_mm;
    const effective_name_en = typed_name_en ?? derived.name_en;
    const effective_name_und = derived.name_und;
    const effective_name =
        effective_name_en ?? effective_name_mm ?? pickEffectiveDisplayName(emptyOverrides, candidate);
    return {
        ...item,
        name_mm: typed_name_mm,
        name_en: typed_name_en,
        effective_name_mm,
        effective_name_en,
        effective_name_und,
        effective_name,
        effective_name_local: effective_name_mm,
        effective_canonical_name: effective_name_en ?? effective_name_mm,
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
        name_mm: baseItem.name_mm ?? null,
        name_en: baseItem.name_en ?? null,
        effective_admin_area_name: baseItem.effective_admin_area_name ?? null,
    };

    const emptyOverrides: Record<string, unknown> = {};
    const meta = computeColumnEditMeta(family, raw);
    const defs = IMPORT_REVIEW_EFFECTIVE_FIELD_REGISTRY[family];

    let enriched: ImportReviewBuildingListItem = {
        ...baseItem,
        has_overrides: meta.has_overrides,
        overridden_fields: meta.overridden_fields,
    };

    if (BILINGUAL_NAME_FAMILIES.has(family)) {
        enriched = applyBilingualNameFields(enriched, raw);
    }

    if (!defs || defs.length === 0) {
        return enriched;
    }

    const effectivePatch: Record<string, unknown> = {};
    for (const def of defs) {
        effectivePatch[def.effectiveKey] = computeEffectiveField(def, emptyOverrides, raw, family);
    }

    enriched = {
        ...enriched,
        ...effectivePatch,
        effective_admin_area_name:
            raw.effective_admin_area_name ?? enriched.effective_admin_area_name ?? null,
    };

    if (family === "routing_barriers") {
        enriched = {
            ...enriched,
            class_code:
                raw.class_code !== undefined && raw.class_code !== null
                    ? String(raw.class_code)
                    : (enriched.class_code ?? null),
            ...(raw.barrier_type !== undefined && raw.barrier_type !== null
                ? { barrier_type: String(raw.barrier_type) }
                : {}),
        };
    }

    return enriched;
}

// --- SQL expression builders (shared with promotion + validation) ---

export function effectiveAdminAreaIdExpr(
    alias: string,
    options?: { hasAdminAreaColumn?: boolean }
): Prisma.Sql {
    return buildEffectiveAdminAreaIdExpr(alias, {
        hasAdminAreaColumn: options?.hasAdminAreaColumn !== false,
    });
}

export { nameExpr, mapClassCodeExpr };
