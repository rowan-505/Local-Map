/**
 * Shared Transport naming policy + helpers (dashboard side).
 *
 * Mirror of `apps/api/src/modules/transport/transport-naming.ts` — keep the
 * behaviour identical between the two.
 *
 * Policy:
 *  - Admin edit forms expose only `name_mm` / `name_en`.
 *  - At least one of `name_mm` / `name_en` is required when saving a manual edit.
 *  - User-facing display name = name_mm ?? name_en ?? generic type label.
 *  - Raw / generated / `und` / imported names are debug/source only.
 *  - `public_name` / `name` cache fields are DERIVED, not directly edited.
 */

/**
 * OSM-derived synthetic name fragments. The importer emits names like
 * `bus_station osm:N:5293807821` / `ferry_terminal osm:R:123` when no human
 * name exists.
 */
export const GENERATED_OSM_NAME_CONTAINS = ["osm:n:", "osm:w:", "osm:r:"] as const;

export const GENERATED_OSM_NAME_PREFIXES = [
    "ferry_terminal osm:",
    "ferry_route osm:",
    "bus_stop osm:",
    "station osm:",
    "terminal osm:",
    "stop osm:",
] as const;

/**
 * Trims a free-text name input and normalizes "empty" to `null`.
 */
export function normalizeTransportNameInput(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}

/**
 * True when at least one localized manual name is present after normalization.
 * Guard for "a manual edit must set name_mm or name_en".
 */
export function hasTransportManualName(
    nameMm: string | null | undefined,
    nameEn: string | null | undefined
): boolean {
    return (
        normalizeTransportNameInput(nameMm) !== null ||
        normalizeTransportNameInput(nameEn) !== null
    );
}

/**
 * User-facing display name: Myanmar first, English fallback, then a generic
 * type label. Never returns a raw generated/OSM name.
 */
export function getTransportDisplayNameFromNames(
    nameMm: string | null | undefined,
    nameEn: string | null | undefined,
    fallbackLabel: string
): string {
    return (
        normalizeTransportNameInput(nameMm) ??
        normalizeTransportNameInput(nameEn) ??
        fallbackLabel
    );
}

/**
 * True when a stored raw name looks like an importer-generated OSM name and
 * must not be shown to users. Case-insensitive.
 */
export function isGeneratedOsmTransportName(value: string | null | undefined): boolean {
    const normalized = normalizeTransportNameInput(value);
    if (normalized === null) {
        return false;
    }
    const lower = normalized.toLowerCase();
    if (GENERATED_OSM_NAME_CONTAINS.some((fragment) => lower.includes(fragment))) {
        return true;
    }
    return GENERATED_OSM_NAME_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Debug/source-only label for a raw stored name. Returns the raw value as-is so
 * reviewers can see provenance, or an em dash when missing. NOT a user-facing
 * display name — use {@link getTransportDisplayNameFromNames}.
 */
export function getRawNameDebugLabel(value: string | null | undefined): string {
    return normalizeTransportNameInput(value) ?? "—";
}

/**
 * Generic, user-safe fallback label for an entity that has no manual Myanmar/
 * English name, derived from its type (e.g. `stop` → "Unnamed stop",
 * `ferry_terminal` → "Unnamed ferry terminal"). Never echoes a raw/generated
 * OSM name. Mirror of the API helper of the same name.
 */
export function getTransportTypeFallbackLabel(
    type: string | null | undefined,
    base = "stop"
): string {
    const normalized = normalizeTransportNameInput(type) ?? base;
    return `Unnamed ${normalized.replace(/_/g, " ")}`;
}
