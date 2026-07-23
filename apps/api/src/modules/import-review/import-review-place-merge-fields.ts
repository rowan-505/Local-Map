/**
 * Apply merge_fields choices onto a core place row (TypeScript-side field pick).
 * Only fields with an explicit choice are changed; others stay as existing.
 */

import type { ParsedFieldChoices } from "./import-review-decision-publish-action.js";

export type PlaceMergeFieldValues = {
    primary_name: string | null;
    display_name: string | null;
    category_id: bigint | number | null;
    admin_area_id: bigint | number | null;
    name_mm: string | null;
    name_en: string | null;
    plus_code: string | null;
    lat: number | null;
    lng: number | null;
    importance_score: number | null;
    popularity_score: number | null;
    confidence_score: number | null;
};

function asString(value: unknown): string | null {
    if (value == null) return null;
    const t = String(value).trim();
    return t === "" ? null : t;
}

function asNumber(value: unknown): number | null {
    if (value == null || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

function asBigIntish(value: unknown): bigint | number | null {
    if (value == null || value === "") return null;
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const t = String(value).trim();
    if (/^\d+$/.test(t)) return BigInt(t);
    return null;
}

function pickChoice(
    choices: ParsedFieldChoices,
    field: string,
    existing: unknown,
    imported: unknown
): unknown {
    const entry = choices[field];
    if (!entry) return existing;
    if (entry.choice === "existing") return existing;
    if (entry.choice === "imported") return imported;
    if (entry.choice === "custom") {
        return entry.custom !== undefined ? entry.custom : existing;
    }
    return existing;
}

export function resolvePlaceMergeFieldValues(args: {
    choices: ParsedFieldChoices;
    existing: PlaceMergeFieldValues;
    imported: PlaceMergeFieldValues;
}): PlaceMergeFieldValues & { selected_fields: string[] } {
    const { choices, existing, imported } = args;
    const selected_fields = Object.keys(choices).filter(
        (k) => choices[k]?.choice && choices[k]!.choice !== ("unset" as string)
    );

    const primary = pickChoice(choices, "primary_name", existing.primary_name, imported.primary_name);
    const display = pickChoice(choices, "display_name", existing.display_name, imported.display_name);
    const category = pickChoice(choices, "category_id", existing.category_id, imported.category_id);
    const admin = pickChoice(choices, "admin_area_id", existing.admin_area_id, imported.admin_area_id);
    const nameMm = pickChoice(choices, "name_mm", existing.name_mm, imported.name_mm);
    const nameEn = pickChoice(choices, "name_en", existing.name_en, imported.name_en);
    const plus = pickChoice(choices, "plus_code", existing.plus_code, imported.plus_code);
    const lat = pickChoice(choices, "lat", existing.lat, imported.lat);
    const lng = pickChoice(choices, "lng", existing.lng, imported.lng);
    const importance = pickChoice(
        choices,
        "importance_score",
        existing.importance_score,
        imported.importance_score
    );
    const popularity = pickChoice(
        choices,
        "popularity_score",
        existing.popularity_score,
        imported.popularity_score
    );
    const confidence = pickChoice(
        choices,
        "confidence_score",
        existing.confidence_score,
        imported.confidence_score
    );

    return {
        primary_name: asString(primary),
        display_name: asString(display),
        category_id: asBigIntish(category),
        admin_area_id: asBigIntish(admin),
        name_mm: asString(nameMm),
        name_en: asString(nameEn),
        plus_code: asString(plus),
        lat: asNumber(lat),
        lng: asNumber(lng),
        importance_score: asNumber(importance),
        popularity_score: asNumber(popularity),
        confidence_score: asNumber(confidence),
        selected_fields,
    };
}
