/**
 * Shared bilingual labeling for places, streets, admin areas, and bus entities.
 * Used by web MapLibre layouts and React UI (via path alias).
 */

export type LanguageMode = "my" | "en" | "both";

export type LocalizedEntity = Record<string, unknown> | null | undefined;

const MYANMAR_SCRIPT_RE = /[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/;
const LATIN_LETTER_RE = /[A-Za-z]/;

function trimStr(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const t = value.trim();
    return t.length ? t : null;
}

function pickFirst(entity: LocalizedEntity, keys: readonly string[]): string | null {
    if (!entity || typeof entity !== "object") return null;
    const rec = entity as Record<string, unknown>;
    for (const key of keys) {
        const v = trimStr(rec[key]);
        if (v) return v;
    }
    return null;
}

function looksMyanmar(text: string): boolean {
    return MYANMAR_SCRIPT_RE.test(text);
}

function looksLatin(text: string): boolean {
    return LATIN_LETTER_RE.test(text);
}

/** Myanmar-oriented candidates for places / geo features (priority order). */
export function pickMyanmarCandidate(entity: LocalizedEntity): string | null {
    const direct = pickFirst(entity, [
        "myanmar_name",
        "name_mm",
        "nameMm",
        "name_local",
        "nameLocal",
    ]);
    if (direct) return direct;

    const display = trimStr(entity?.display_name ?? entity?.displayName);
    if (display && looksMyanmar(display)) return display;

    const primary = trimStr(entity?.primary_name ?? entity?.primaryName);
    if (primary && looksMyanmar(primary)) return primary;

    const name = trimStr(entity?.name);
    if (name && looksMyanmar(name)) return name;

    return null;
}

/** English / Latin-oriented candidates (priority order). */
export function pickEnglishCandidate(entity: LocalizedEntity): string | null {
    const direct = pickFirst(entity, [
        "english_name",
        "name_en",
        "nameEn",
        "secondary_name",
        "secondaryName",
    ]);
    if (direct) return direct;

    const display = trimStr(entity?.display_name ?? entity?.displayName);
    if (display && looksLatin(display) && !looksMyanmar(display)) return display;

    const primary = trimStr(entity?.primary_name ?? entity?.primaryName);
    if (primary && looksLatin(primary) && !looksMyanmar(primary)) return primary;

    const name = trimStr(entity?.name);
    if (name && looksLatin(name) && !looksMyanmar(name)) return name;

    const canonical = trimStr(entity?.canonical_name ?? entity?.canonicalName);
    if (canonical) return canonical;

    return null;
}

function fallbackSingleLine(entity: LocalizedEntity): string {
    return (
        trimStr(entity?.display_name ?? entity?.displayName) ??
        trimStr(entity?.name) ??
        trimStr(entity?.canonical_name ?? entity?.canonicalName) ??
        "Unnamed"
    );
}

/**
 * UI string for list / detail / search rows.
 * `both`: Myanmar line, then English line when both exist and differ.
 */
export function getLocalizedName(entity: LocalizedEntity, mode: LanguageMode): string {
    const mm = pickMyanmarCandidate(entity);
    const en = pickEnglishCandidate(entity);

    if (mode === "my") {
        return mm ?? en ?? fallbackSingleLine(entity);
    }

    if (mode === "en") {
        return en ?? mm ?? fallbackSingleLine(entity);
    }

    if (mm && en && mm !== en) {
        return `${mm}\n${en}`;
    }

    return mm ?? en ?? fallbackSingleLine(entity);
}

/**
 * MapLibre `layout["text-field"]` for vector/GeoJSON features that expose `name_mm`, `name_en`, and fallback `name`.
 * Tile views and API GeoJSON should set `name` to `coalesce(name_mm, name_en, …)` when mm/en are absent.
 */
export function getMapTextFieldExpression(mode: LanguageMode): readonly unknown[] {
    if (mode === "my") {
        return ["coalesce", ["get", "name_mm"], ["get", "name_en"], ["get", "name"]];
    }
    if (mode === "en") {
        return ["coalesce", ["get", "name_en"], ["get", "name_mm"], ["get", "name"]];
    }
    return [
        "case",
        ["all", ["has", "name_mm"], ["has", "name_en"]],
        ["concat", ["get", "name_mm"], "\n", ["get", "name_en"]],
        ["coalesce", ["get", "name_mm"], ["get", "name_en"], ["get", "name"]],
    ];
}
