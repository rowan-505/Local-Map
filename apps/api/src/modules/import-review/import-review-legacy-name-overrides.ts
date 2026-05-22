import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { isMyanmarScript, trimString } from "./import-review-name-fields.js";
import { applyReviewOverridesPatch } from "./import-review-overrides-merge.js";
import { overrideAllowlistForFamily } from "./import-review-overrides-allowlist.js";

/** Legacy review_overrides name keys migrated to name_mm / name_en. */
export const LEGACY_NAME_OVERRIDE_KEYS = ["name", "name_local"] as const;

function asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return { ...(value as Record<string, unknown>) };
    }
    return {};
}

function familySupportsNameOverrides(family: ImportReviewEntityFamilySlug): boolean {
    return overrideAllowlistForFamily(family).has("name_mm");
}

/**
 * Migrate legacy override name keys into name_mm / name_en and drop legacy keys.
 * - name_local -> name_mm when name_mm is not already set (name_mm wins)
 * - name -> name_en when Latin/non-Myanmar and name_en is not set (name_en wins)
 * - name -> name_mm when Myanmar script and name_mm is not set
 */
export function normalizeLegacyNameOverrides(
    family: ImportReviewEntityFamilySlug,
    review_overrides: unknown
): Record<string, unknown> {
    if (!familySupportsNameOverrides(family)) {
        return asRecord(review_overrides);
    }

    const out = asRecord(review_overrides);

    if (Object.prototype.hasOwnProperty.call(out, "name_local")) {
        if (!Object.prototype.hasOwnProperty.call(out, "name_mm")) {
            const local = trimString(out.name_local);
            if (local !== null) {
                out.name_mm = local;
            }
        }
        delete out.name_local;
    }

    if (Object.prototype.hasOwnProperty.call(out, "name")) {
        const migrated = trimString(out.name);
        if (migrated !== null) {
            if (isMyanmarScript(migrated)) {
                if (!Object.prototype.hasOwnProperty.call(out, "name_mm")) {
                    out.name_mm = migrated;
                }
            } else if (!Object.prototype.hasOwnProperty.call(out, "name_en")) {
                out.name_en = migrated;
            }
        }
        delete out.name;
    }

    return out;
}

/** Build a shallow-merge patch that persists normalized overrides and removes legacy keys. */
export function reviewOverridesPersistPatch(
    existing: Record<string, unknown>,
    normalized: Record<string, unknown>
): Record<string, unknown> {
    const patch: Record<string, unknown> = {};

    for (const key of LEGACY_NAME_OVERRIDE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(existing, key)) {
            patch[key] = null;
        }
    }

    const keys = new Set([...Object.keys(existing), ...Object.keys(normalized)]);
    for (const key of keys) {
        if ((LEGACY_NAME_OVERRIDE_KEYS as readonly string[]).includes(key)) {
            continue;
        }
        const next = normalized[key];
        const prev = existing[key];
        if (prev !== next) {
            patch[key] = next === undefined ? null : next;
        }
    }

    return patch;
}

/** Merge incoming patch with stored overrides, migrate legacy name keys, return DB merge patch. */
export function buildPersistableReviewOverridesPatch(
    family: ImportReviewEntityFamilySlug,
    existing: Record<string, unknown>,
    incomingPatch: Record<string, unknown>
): Record<string, unknown> {
    const merged = applyReviewOverridesPatch(existing, incomingPatch);
    const normalized = normalizeLegacyNameOverrides(family, merged);
    return reviewOverridesPersistPatch(existing, normalized);
}
