/**
 * Extract structured building names from OSM tags.
 * language_code is only my | en | und (never mm).
 */

import {
    ENGLISH_LANGUAGE_CODE,
    MYANMAR_LANGUAGE_CODE,
    UNKNOWN_LANGUAGE_CODE,
    deriveBuildingDisplayNameFromPriority,
    trimName,
} from "./derive-display-name.js";

/** Myanmar script block — classify unsuffixed OSM name tags. */
const MYANMAR_SCRIPT_RE = /[\u1000-\u109F]/;

export type BuildingLanguageCode = typeof MYANMAR_LANGUAGE_CODE | typeof ENGLISH_LANGUAGE_CODE | typeof UNKNOWN_LANGUAGE_CODE;

export type BuildingNameType =
    | "official"
    | "alternate"
    | "short"
    | "local"
    | "old"
    | "imported";

export type BuildingNameEntry = {
    name: string;
    languageCode: BuildingLanguageCode;
    scriptCode?: string | null;
    nameType: BuildingNameType;
    isPrimary: boolean;
    searchWeight: number;
};

type MutableName = {
    name: string;
    languageCode: BuildingLanguageCode;
    scriptCode: string | null;
    nameType: BuildingNameType;
    searchWeight: number;
    sortKey: number;
};

function normalizeLanguageCode(raw: string | null | undefined): BuildingLanguageCode | null {
    if (!raw) {
        return null;
    }
    const code = raw.trim().toLowerCase();
    if (code === "my" || code === "mm" || code === "my-mm") {
        return MYANMAR_LANGUAGE_CODE;
    }
    if (code === "en") {
        return ENGLISH_LANGUAGE_CODE;
    }
    if (code === "und") {
        return UNKNOWN_LANGUAGE_CODE;
    }
    return null;
}

function addCandidate(
    out: MutableName[],
    seen: Set<string>,
    name: string | null | undefined,
    languageCode: BuildingLanguageCode,
    scriptCode: string | null,
    searchWeight: number,
    sortKey: number
): void {
    const trimmed = trimName(name);
    if (!trimmed) {
        return;
    }
    const identity = `${languageCode}\0${trimmed.toLowerCase()}`;
    if (seen.has(identity)) {
        return;
    }
    seen.add(identity);
    out.push({
        name: trimmed,
        languageCode,
        scriptCode,
        nameType: "imported",
        searchWeight,
        sortKey,
    });
}

/** Build names[] from OSM tag object. Blank/whitespace ignored. mm → my. */
export function extractBuildingNamesFromOsmTags(
    tags: Record<string, unknown> | null | undefined
): BuildingNameEntry[] {
    const t = tags ?? {};
    const asString = (key: string): string | null => {
        const v = t[key];
        return typeof v === "string" ? v : null;
    };

    const nameMy =
        trimName(asString("name:my")) ??
        trimName(asString("name:mm")) ??
        trimName(asString("name:my-MM"));
    const nameEn = trimName(asString("name:en"));
    const namePlain = trimName(asString("name"));

    const candidates: MutableName[] = [];
    const seen = new Set<string>();

    addCandidate(candidates, seen, nameMy, MYANMAR_LANGUAGE_CODE, "Mymr", 100, 1);
    addCandidate(
        candidates,
        seen,
        nameEn,
        ENGLISH_LANGUAGE_CODE,
        "Latn",
        nameMy ? 90 : 100,
        2
    );

    if (namePlain) {
        if (nameEn && namePlain.toLowerCase() === nameEn.toLowerCase()) {
            addCandidate(candidates, seen, namePlain, ENGLISH_LANGUAGE_CODE, "Latn", 80, 3);
        } else if (MYANMAR_SCRIPT_RE.test(namePlain)) {
            addCandidate(candidates, seen, namePlain, MYANMAR_LANGUAGE_CODE, "Mymr", 80, 3);
        } else {
            addCandidate(candidates, seen, namePlain, UNKNOWN_LANGUAGE_CODE, null, 70, 3);
        }
    }

    const primarySeen = new Set<BuildingLanguageCode>();
    return candidates
        .sort((a, b) => a.sortKey - b.sortKey || b.searchWeight - a.searchWeight)
        .map((row) => {
            const isPrimary = !primarySeen.has(row.languageCode);
            if (isPrimary) {
                primarySeen.add(row.languageCode);
            }
            return {
                name: row.name,
                languageCode: row.languageCode,
                scriptCode: row.scriptCode,
                nameType: row.nameType,
                isPrimary,
                searchWeight: row.searchWeight,
            };
        });
}

/** Map API / JSON snake or camel entries into BuildingNameEntry[]. */
export function normalizeBuildingNameEntries(raw: unknown): BuildingNameEntry[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: BuildingNameEntry[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const row = item as Record<string, unknown>;
        const name = trimName(
            typeof row.name === "string"
                ? row.name
                : typeof row.value === "string"
                  ? row.value
                  : null
        );
        const languageCode = normalizeLanguageCode(
            typeof row.languageCode === "string"
                ? row.languageCode
                : typeof row.language_code === "string"
                  ? row.language_code
                  : null
        );
        if (!name || !languageCode) {
            continue;
        }
        const identity = `${languageCode}\0${name.toLowerCase()}`;
        if (seen.has(identity)) {
            continue;
        }
        seen.add(identity);
        const nameTypeRaw =
            typeof row.nameType === "string"
                ? row.nameType
                : typeof row.name_type === "string"
                  ? row.name_type
                  : "imported";
        const nameType = (
            [
                "official",
                "alternate",
                "short",
                "local",
                "old",
                "imported",
            ] as const
        ).includes(nameTypeRaw as BuildingNameType)
            ? (nameTypeRaw as BuildingNameType)
            : "imported";
        const scriptCode =
            typeof row.scriptCode === "string"
                ? row.scriptCode
                : typeof row.script_code === "string"
                  ? row.script_code
                  : null;
        out.push({
            name,
            languageCode,
            scriptCode,
            nameType,
            isPrimary: Boolean(row.isPrimary ?? row.is_primary ?? false),
            searchWeight: Number(row.searchWeight ?? row.search_weight ?? 50) || 50,
        });
    }
    return out;
}

/** Display-name priority: official primary → local primary → imported primary → alternate → any. */
export function pickBuildingDisplayName(names: BuildingNameEntry[]): string | null {
    return deriveBuildingDisplayNameFromPriority(names);
}

/** Snake_case payload for normalized_data.names / Stage K. */
export function buildingNamesToNormalizedJson(names: BuildingNameEntry[]): unknown[] {
    return names.map((n) => ({
        name: n.name,
        language_code: n.languageCode,
        script_code: n.scriptCode ?? null,
        name_type: n.nameType,
        is_primary: n.isPrimary,
        search_weight: n.searchWeight,
    }));
}
