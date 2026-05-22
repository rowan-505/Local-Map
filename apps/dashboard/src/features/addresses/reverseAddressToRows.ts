import type { AddressComponentEditorRow } from "@/src/features/import-review/utils/importReviewAddressComponentRows";
import type { ReverseAddressDebugComponent } from "./reverseAddress.types";

let rowKeyCounter = 0;
function newRowKey(type: string): string {
    rowKeyCounter += 1;
    return `reverse::${type}::${rowKeyCounter}`;
}

function normalizeLang(code: string): "en" | "my" | "und" {
    const c = code.trim().toLowerCase();
    if (c === "en") {
        return "en";
    }
    if (c === "my" || c === "mm") {
        return "my";
    }
    return "und";
}

function confidenceToEditorScore(score: number | null): string {
    if (score === null || !Number.isFinite(score)) {
        return "";
    }
    const pct = score <= 1 ? Math.round(score * 100) : Math.round(score);
    return String(Math.min(100, Math.max(0, pct)));
}

function summarizeReverseSource(c: ReverseAddressDebugComponent): string {
    const parts: string[] = [c.source.replace(/^core_/, "")];
    if (c.match_type) {
        parts.push(c.match_type);
    }
    if (c.boundary_status) {
        parts.push(c.boundary_status);
    }
    if (c.address_usage === "locality_hint") {
        parts.push("locality_hint");
    }
    return parts.join(" · ");
}

/** Group API reverse components into import-review editor rows (one row per type). */
export function reverseComponentsToImportReviewRows(
    components: readonly ReverseAddressDebugComponent[]
): AddressComponentEditorRow[] {
    const byType = new Map<string, AddressComponentEditorRow>();

    for (const c of components) {
        const typeCode = c.component_type.trim();
        const value = c.value.trim();
        if (!typeCode || !value) {
            continue;
        }

        let row = byType.get(typeCode);
        if (!row) {
            row = {
                rowKey: newRowKey(typeCode),
                component_type_code: typeCode,
                en: "",
                my: "",
                und: "",
                match_type: c.match_type ?? "",
                confidence_score: confidenceToEditorScore(c.confidence_score),
                source_summary: summarizeReverseSource(c),
                component_ids: {},
                is_reviewed: false,
            };
            byType.set(typeCode, row);
        }

        const lang = normalizeLang(c.language_code);
        if (lang === "en") {
            row.en = value;
        } else if (lang === "my") {
            row.my = value;
        } else {
            row.und = value;
        }
        if (!row.match_type && c.match_type) {
            row.match_type = c.match_type;
        }
        if (!row.confidence_score && c.confidence_score !== null) {
            row.confidence_score = confidenceToEditorScore(c.confidence_score);
        }
        row.source_summary = summarizeReverseSource(c);
    }

    return [...byType.values()].sort((a, b) => a.component_type_code.localeCompare(b.component_type_code));
}

export type CoreAddressComponentsPatch = {
    upsert: Array<{
        id?: string;
        component_type_code: string;
        component_value: string;
        language_code: "en" | "my" | "und";
        confidence_score?: number | null;
        match_type?: string | null;
    }>;
    delete_ids?: string[];
};

/** Flatten reverse components into core-review PATCH `components.upsert` entries. */
export function reverseComponentsToCorePatch(
    components: readonly ReverseAddressDebugComponent[]
): CoreAddressComponentsPatch {
    const upsert: CoreAddressComponentsPatch["upsert"] = [];

    for (const c of components) {
        const typeCode = c.component_type.trim();
        const value = c.value.trim();
        if (!typeCode || !value) {
            continue;
        }
        const lang = normalizeLang(c.language_code);
        const scoreRaw = c.confidence_score;
        const confidence_score =
            scoreRaw === null || !Number.isFinite(scoreRaw)
                ? null
                : scoreRaw <= 1
                  ? Math.round(scoreRaw * 100)
                  : Math.round(scoreRaw);

        upsert.push({
            component_type_code: typeCode,
            component_value: value,
            language_code: lang,
            confidence_score,
            match_type: c.match_type,
        });
    }

    return { upsert };
}
