import { z } from "zod";

import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { ImportReviewDecisionRuleError } from "./import-review-errors.js";
import {
    normalizeOptionalOverrideString,
    normalizeOverrideBoolean,
    normalizeOverrideNumericId,
    normalizeOverrideOptionalBoolean,
    normalizeOverrideOptionalNumber,
    normalizeOverrideOptionalScore,
} from "./import-review-overrides-normalize.js";
import {
    IMPORT_REVIEW_OVERRIDE_PATCH_KEY_ALIASES,
    overrideAllowlistForFamily,
    unsupportedOverrideKeys,
} from "./import-review-overrides-allowlist.js";
import { normalizeLegacyNameOverrides } from "./import-review-legacy-name-overrides.js";

const DISPLAY_ONLY_OVERRIDE_KEYS = new Set(["admin_area", "effective_admin_area_name"]);

const ID_PATCH_KEYS = new Set([
    "admin_area_id",
    "building_type_id",
    "landuse_class_id",
    "category_id",
    "road_class_id",
    "admin_level_id",
    "parent_id",
    "street_id",
]);

const STRING_PATCH_KEYS = new Set([
    "name_mm",
    "name_en",
    "stop_code",
    "class_code",
    "surface",
    "barrier_type",
    "waterway_class",
    "water_class",
    "full_address",
    "house_number",
    "street_name",
    "quarter",
    "township",
    "city",
    "postcode",
    "plus_code",
    "slug",
]);

const BOOLEAN_PATCH_KEYS = new Set(["is_oneway", "intermittent"]);

const SCORE_PATCH_KEYS = new Set(["confidence_score", "importance_score", "popularity_score"]);

const NUMBER_PATCH_KEYS = new Set(["levels", "height_m"]);

const GEOM_PATCH_KEYS = new Set(["geom", "point_geom"]);

const CLASSIFICATION_PATCH_KEYS = ["class_code", "barrier_type", "waterway_class", "water_class"] as const;

/** Shared override values in PATCH bodies (nullable). Geometry fields may be GeoJSON objects. */
export const importReviewOverridePrimitiveValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
]);

export const importReviewReviewOverridesPatchValueSchema = z.union([
    importReviewOverridePrimitiveValueSchema,
    z.record(z.string(), z.unknown()),
]);

/** PATCH body `review_overrides` — shallow merge object; `{}` clears all stored overrides. */
export const importReviewReviewOverridesPatchSchema = z.record(
    z.string(),
    importReviewReviewOverridesPatchValueSchema
);

export type ImportReviewReviewOverridesPatch = z.infer<typeof importReviewReviewOverridesPatchSchema>;

function asPatchRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function isPrimitiveOverrideValue(value: unknown): boolean {
    return (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    );
}

function assertPrimitiveValue(key: string, value: unknown): void {
    if (isPrimitiveOverrideValue(value)) {
        return;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        throw new ImportReviewDecisionRuleError(
            `review_overrides.${key} must be a string, number, boolean, or null (objects are not supported).`
        );
    }
    throw new ImportReviewDecisionRuleError(
        `review_overrides.${key} must be a string, number, boolean, or null.`
    );
}

function assertGeomOverrideValue(key: string, value: unknown): void {
    if (value === null) {
        return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return;
    }
    throw new ImportReviewDecisionRuleError(
        `review_overrides.${key} must be a GeoJSON object or null.`
    );
}

function applyPatchKeyAliases(patch: Record<string, unknown>): Record<string, unknown> {
    const out = { ...patch };
    for (const [alias, canonical] of Object.entries(IMPORT_REVIEW_OVERRIDE_PATCH_KEY_ALIASES)) {
        if (!Object.prototype.hasOwnProperty.call(out, alias)) {
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(out, canonical)) {
            out[canonical] = out[alias];
        }
        delete out[alias];
    }
    return out;
}

function assertNameNotMatchingClassification(
    key: string,
    value: string | null,
    patch: Record<string, unknown>
): void {
    if (value === null || (key !== "name_mm" && key !== "name_en")) {
        return;
    }
    const lower = value.toLowerCase();
    for (const classKey of CLASSIFICATION_PATCH_KEYS) {
        const classVal = normalizeOptionalOverrideString(patch[classKey], classKey);
        if (classVal && classVal.toLowerCase() === lower) {
            throw new ImportReviewDecisionRuleError(
                `review_overrides.${key} must not match classification field ${classKey}.`
            );
        }
    }
}

function normalizePatchFieldValue(
    family: ImportReviewEntityFamilySlug,
    key: string,
    value: unknown,
    patch: Record<string, unknown>
): unknown {
    if (value === null || value === undefined) {
        return null;
    }

    if (GEOM_PATCH_KEYS.has(key)) {
        assertGeomOverrideValue(key, value);
        return value;
    }

    if (ID_PATCH_KEYS.has(key)) {
        return normalizeOverrideNumericId(value, key);
    }

    if (BOOLEAN_PATCH_KEYS.has(key)) {
        return normalizeOverrideBoolean(value, key);
    }

    if (SCORE_PATCH_KEYS.has(key)) {
        return normalizeOverrideOptionalScore(value, key);
    }

    if (NUMBER_PATCH_KEYS.has(key)) {
        return normalizeOverrideOptionalNumber(value, key);
    }

    if (STRING_PATCH_KEYS.has(key)) {
        const normalized = normalizeOptionalOverrideString(value, key);
        assertNameNotMatchingClassification(key, normalized, patch);
        return normalized;
    }

    assertPrimitiveValue(key, value);
    return value;
}

function assertStoredFieldValue(
    family: ImportReviewEntityFamilySlug,
    key: string,
    value: unknown
): void {
    if (GEOM_PATCH_KEYS.has(key)) {
        assertGeomOverrideValue(key, value);
        return;
    }
    assertPrimitiveValue(key, value);
}

/**
 * Validate allowlist + primitive shapes for an incoming PATCH.
 * Throws ImportReviewDecisionRuleError (400) for client errors.
 */
export function sanitizeReviewOverridesPatch(
    family: ImportReviewEntityFamilySlug,
    review_overrides: unknown
): Record<string, unknown> {
    const parsed = importReviewReviewOverridesPatchSchema.safeParse(review_overrides ?? {});
    if (!parsed.success) {
        throw new ImportReviewDecisionRuleError(
            `Invalid review_overrides: expected an object with string, number, boolean, or null values.`
        );
    }

    const patch = applyPatchKeyAliases(normalizeLegacyNameOverrides(family, parsed.data));

    for (const key of Object.keys(patch)) {
        if (DISPLAY_ONLY_OVERRIDE_KEYS.has(key)) {
            throw new ImportReviewDecisionRuleError(
                `Invalid review_overrides key "${key}": use admin_area_id (numeric id), not display text.`
            );
        }
    }

    const unsupported = unsupportedOverrideKeys(family, patch);
    if (unsupported.length > 0) {
        throw new ImportReviewDecisionRuleError(
            `Unsupported review_overrides field(s) for ${family}: ${unsupported.join(", ")}.`
        );
    }

    const allow = overrideAllowlistForFamily(family);
    const out: Record<string, unknown> = {};

    for (const key of allow) {
        if (!Object.prototype.hasOwnProperty.call(patch, key)) {
            continue;
        }
        out[key] = normalizePatchFieldValue(family, key, patch[key], patch);
    }

    return out;
}

/** Validate stored overrides on a candidate (after merge). Empty object is valid. */
export function assertStoredReviewOverridesAllowlist(
    family: ImportReviewEntityFamilySlug,
    review_overrides: unknown
): void {
    const ov = applyPatchKeyAliases(
        normalizeLegacyNameOverrides(family, asPatchRecord(review_overrides))
    );
    if (Object.keys(ov).length === 0) {
        return;
    }

    for (const key of Object.keys(ov)) {
        if (DISPLAY_ONLY_OVERRIDE_KEYS.has(key)) {
            throw new ImportReviewDecisionRuleError(
                `Invalid review_overrides key "${key}": use admin_area_id (numeric id), not display text.`
            );
        }
    }

    const unsupported = unsupportedOverrideKeys(family, ov);
    if (unsupported.length > 0) {
        throw new ImportReviewDecisionRuleError(
            `Invalid review_overrides on this ${family} candidate: unsupported field(s) ${unsupported.join(", ")}.`
        );
    }

    for (const [key, value] of Object.entries(ov)) {
        assertStoredFieldValue(family, key, value);
    }
}
