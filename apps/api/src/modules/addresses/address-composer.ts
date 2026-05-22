import type {
    AddressComposerComponent,
    AddressComposerFallbackMode,
    AddressComposerInput,
    AddressComposerResult,
    AddressComponentTypeSummary,
    AddressDisplayLanguage,
} from "./address-composer.types.js";

/** Stable composition order (low → high in formatted address). */
export const ADDRESS_COMPOSITION_ORDER = [
    "house_number",
    "unit",
    "floor",
    "building",
    "street",
    "road",
    "quarter",
    "ward",
    "village",
    "village_tract",
    "town",
    "city",
    "township",
    "district",
    "region",
    "postcode",
    "plus_code",
    "country",
] as const;

export type AddressCompositionTypeCode = (typeof ADDRESS_COMPOSITION_ORDER)[number];

/** Language-neutral tokens included in both en and my formatted lines. */
export const NEUTRAL_ADDRESS_COMPONENT_TYPES = new Set<string>([
    "house_number",
    "unit",
    "floor",
    "postcode",
    "plus_code",
    "country",
]);

const EN_SEPARATOR = ", ";
const MY_SEPARATOR = "၊ ";

const ORDER_INDEX = new Map<string, number>(
    ADDRESS_COMPOSITION_ORDER.map((code, index) => [code, index])
);

function trimValue(value: string | null | undefined): string | null {
    if (value === undefined || value === null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}

function normalizeLang(code: string | null | undefined): string {
    const c = trimValue(code)?.toLowerCase();
    if (c === "mm") {
        return "my";
    }
    if (c === "en" || c === "my" || c === "und") {
        return c;
    }
    return "und";
}

function normalizeCompareKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}

type NormalizedRow = {
    component_type_code: string;
    component_value: string;
    language_code: string;
    sort_order: number | null;
};

function normalizeComponents(
    components: readonly AddressComposerComponent[],
    warnings: string[]
): NormalizedRow[] {
    const out: NormalizedRow[] = [];

    for (const raw of components) {
        const component_type_code = trimValue(raw.component_type_code);
        const component_value = trimValue(raw.component_value);
        if (!component_type_code || !component_value) {
            continue;
        }

        if (!ORDER_INDEX.has(component_type_code)) {
            warnings.push(`Unknown component_type_code "${component_type_code}" skipped in composition.`);
            continue;
        }

        const language_code = normalizeLang(raw.language_code);
        const sort_order =
            raw.sort_order === null || raw.sort_order === undefined
                ? null
                : Number.isFinite(Number(raw.sort_order))
                  ? Number(raw.sort_order)
                  : null;

        out.push({
            component_type_code,
            component_value,
            language_code,
            sort_order,
        });
    }

    return out;
}

function groupByType(rows: NormalizedRow[]): Map<string, NormalizedRow[]> {
    const map = new Map<string, NormalizedRow[]>();
    for (const row of rows) {
        const list = map.get(row.component_type_code);
        if (list) {
            list.push(row);
        } else {
            map.set(row.component_type_code, [row]);
        }
    }
    return map;
}

function pickByLanguagePriority(rows: NormalizedRow[], priority: readonly string[]): string | null {
    for (const lang of priority) {
        const match = rows.find((r) => r.language_code === lang);
        if (match) {
            return match.component_value;
        }
    }
    return null;
}

function summarizeType(rows: NormalizedRow[]): Pick<AddressComponentTypeSummary, "en" | "my" | "und"> {
    return {
        en: pickByLanguagePriority(rows, ["en"]),
        my: pickByLanguagePriority(rows, ["my"]),
        und: pickByLanguagePriority(rows, ["und"]),
    };
}

function resolveForEnglish(typeCode: string, rows: NormalizedRow[]): string | null {
    if (NEUTRAL_ADDRESS_COMPONENT_TYPES.has(typeCode)) {
        return pickByLanguagePriority(rows, ["und", "en", "my"]);
    }
    return pickByLanguagePriority(rows, ["en", "und"]);
}

function resolveForMyanmar(typeCode: string, rows: NormalizedRow[]): string | null {
    if (NEUTRAL_ADDRESS_COMPONENT_TYPES.has(typeCode)) {
        return pickByLanguagePriority(rows, ["und", "my", "en"]);
    }
    return pickByLanguagePriority(rows, ["my", "und"]);
}

type SegmentPlan = {
    typeCode: string;
    valueEn: string | null;
    valueMy: string | null;
};

function buildSegmentPlans(
    byType: Map<string, NormalizedRow[]>,
    warnings: string[]
): SegmentPlan[] {
    const plans: SegmentPlan[] = [];

    for (const typeCode of ADDRESS_COMPOSITION_ORDER) {
        const rows = byType.get(typeCode);
        if (!rows?.length) {
            continue;
        }

        const valueEn = resolveForEnglish(typeCode, rows);
        const valueMy = resolveForMyanmar(typeCode, rows);
        if (!valueEn && !valueMy) {
            continue;
        }

        plans.push({ typeCode, valueEn, valueMy });
    }

    // Street / road: drop road when it repeats street (same normalized text)
    const streetPlan = plans.find((p) => p.typeCode === "street");
    const roadPlan = plans.find((p) => p.typeCode === "road");
    if (streetPlan && roadPlan) {
        const streetKey =
            streetPlan.valueEn ?? streetPlan.valueMy
                ? normalizeCompareKey(streetPlan.valueEn ?? streetPlan.valueMy!)
                : null;
        const roadKey =
            roadPlan.valueEn ?? roadPlan.valueMy
                ? normalizeCompareKey(roadPlan.valueEn ?? roadPlan.valueMy!)
                : null;
        if (streetKey && roadKey && streetKey === roadKey) {
            const idx = plans.findIndex((p) => p.typeCode === "road");
            if (idx >= 0) {
                plans.splice(idx, 1);
                warnings.push("Skipped duplicate road value (same as street).");
            }
        }
    }

    return plans;
}

function dedupeAdjacent(values: string[], warnings: string[], context: "en" | "my"): string[] {
    const out: string[] = [];
    let prevKey: string | null = null;

    for (const value of values) {
        const key = normalizeCompareKey(value);
        if (prevKey !== null && key === prevKey) {
            warnings.push(`Skipped duplicate adjacent segment in ${context} address: "${value}".`);
            continue;
        }
        out.push(value);
        prevKey = key;
    }

    return out;
}

function joinSegments(segments: string[], language: "en" | "my"): string | null {
    if (segments.length === 0) {
        return null;
    }
    const separator = language === "my" ? MY_SEPARATOR : EN_SEPARATOR;
    return segments.join(separator);
}

function buildComponentsByType(
    byType: Map<string, NormalizedRow[]>,
    plans: SegmentPlan[]
): Record<string, AddressComponentTypeSummary> {
    const usedEn = new Map(plans.map((p) => [p.typeCode, p.valueEn]));
    const usedMy = new Map(plans.map((p) => [p.typeCode, p.valueMy]));
    const out: Record<string, AddressComponentTypeSummary> = {};

    for (const [typeCode, rows] of byType) {
        const summary = summarizeType(rows);
        out[typeCode] = {
            ...summary,
            used_in_en: usedEn.get(typeCode) ?? null,
            used_in_my: usedMy.get(typeCode) ?? null,
        };
    }

    return out;
}

function resolveDisplayFullAddress(
    full_address_en: string | null,
    full_address_my: string | null,
    displayLanguage: AddressDisplayLanguage | undefined,
    fallbackMode: AddressComposerFallbackMode
): string | null {
    if (displayLanguage === "my") {
        return full_address_my ?? full_address_en ?? null;
    }
    if (displayLanguage === "en") {
        return full_address_en ?? full_address_my ?? null;
    }

    switch (fallbackMode) {
        case "my_first":
            return full_address_my ?? full_address_en ?? null;
        case "en_first":
            return full_address_en ?? full_address_my ?? null;
        case "any":
        default:
            return full_address_en ?? full_address_my ?? null;
    }
}

/**
 * Compose readonly bilingual full address strings from structured components.
 * API-only; dashboard must not concatenate address lines manually.
 */
export function composeAddress(input: AddressComposerInput): AddressComposerResult {
    const warnings: string[] = [];
    const fallbackMode = input.fallbackMode ?? "any";
    const rows = normalizeComponents(input.components, warnings);
    const byType = groupByType(rows);
    const plans = buildSegmentPlans(byType, warnings);

    const enSegments: string[] = [];
    const mySegments: string[] = [];

    for (const plan of plans) {
        if (plan.valueEn) {
            enSegments.push(plan.valueEn);
        }
        if (plan.valueMy) {
            mySegments.push(plan.valueMy);
        }
    }

    const full_address_en = joinSegments(dedupeAdjacent(enSegments, warnings, "en"), "en");
    const full_address_my = joinSegments(dedupeAdjacent(mySegments, warnings, "my"), "my");

    return {
        full_address_en,
        full_address_my,
        display_full_address: resolveDisplayFullAddress(
            full_address_en,
            full_address_my,
            input.displayLanguage,
            fallbackMode
        ),
        components_by_type: buildComponentsByType(byType, plans),
        warnings,
    };
}
