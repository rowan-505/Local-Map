import { ImportReviewDecisionRuleError } from "./import-review-errors.js";

export function normalizeOptionalOverrideString(value: unknown, fieldName: string): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== "string") {
        throw new ImportReviewDecisionRuleError(
            `review_overrides.${fieldName} must be a string or null.`
        );
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}

export function normalizeOverrideBoolean(value: unknown, fieldName: string): boolean {
    if (value === true || value === false) {
        return value;
    }
    if (value === "true" || value === 1 || value === "1") {
        return true;
    }
    if (value === "false" || value === 0 || value === "0") {
        return false;
    }
    throw new ImportReviewDecisionRuleError(
        `review_overrides.${fieldName} must be a boolean.`
    );
}

export function normalizeOverrideOptionalBoolean(value: unknown, fieldName: string): boolean | null {
    if (value === null || value === undefined) {
        return null;
    }
    return normalizeOverrideBoolean(value, fieldName);
}

export function normalizeOverrideConfidenceScore(value: unknown, fieldName: string): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        if (value < 0 || value > 100) {
            throw new ImportReviewDecisionRuleError(
                `review_overrides.${fieldName} must be between 0 and 100.`
            );
        }
        return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value.trim());
        if (!Number.isFinite(n) || n < 0 || n > 100) {
            throw new ImportReviewDecisionRuleError(
                `review_overrides.${fieldName} must be between 0 and 100.`
            );
        }
        return n;
    }
    throw new ImportReviewDecisionRuleError(
        `review_overrides.${fieldName} must be a number between 0 and 100.`
    );
}

export function normalizeOverrideOptionalScore(value: unknown, fieldName: string): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    return normalizeOverrideConfidenceScore(value, fieldName);
}

export function normalizeOverrideOptionalNumber(value: unknown, fieldName: string): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value.trim());
        if (!Number.isFinite(n)) {
            throw new ImportReviewDecisionRuleError(
                `review_overrides.${fieldName} must be a number or null.`
            );
        }
        return n;
    }
    throw new ImportReviewDecisionRuleError(
        `review_overrides.${fieldName} must be a number or null.`
    );
}

/** Positive integer id for JSON storage (number, not string). */
export function normalizeOverrideNumericId(value: unknown, fieldName: string): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "number") {
        if (!Number.isInteger(value) || value <= 0) {
            throw new ImportReviewDecisionRuleError(
                `review_overrides.${fieldName} must be a positive integer or null.`
            );
        }
        return value;
    }
    if (typeof value === "bigint") {
        const asNumber = Number(value);
        if (!Number.isSafeInteger(asNumber) || asNumber <= 0) {
            throw new ImportReviewDecisionRuleError(
                `review_overrides.${fieldName} must be a positive integer or null.`
            );
        }
        return asNumber;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") {
            return null;
        }
        if (!/^\d+$/.test(trimmed)) {
            throw new ImportReviewDecisionRuleError(
                `review_overrides.${fieldName} must be a positive integer or null.`
            );
        }
        const asNumber = Number(trimmed);
        if (!Number.isSafeInteger(asNumber) || asNumber <= 0) {
            throw new ImportReviewDecisionRuleError(
                `review_overrides.${fieldName} must be a positive integer or null.`
            );
        }
        return asNumber;
    }
    throw new ImportReviewDecisionRuleError(
        `review_overrides.${fieldName} must be a number or null.`
    );
}

const ROAD_ID_OVERRIDE_KEYS = new Set(["road_class_id", "admin_area_id"]);

/** Coerce legacy string ids to numbers before persisting review_overrides JSON. */
export function normalizeReviewOverridesForJsonStorage(
    family: "roads",
    review_overrides: Record<string, unknown>
): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(review_overrides)) {
        if (value === undefined) {
            continue;
        }
        if (value === null) {
            out[key] = null;
            continue;
        }
        if (family === "roads" && ROAD_ID_OVERRIDE_KEYS.has(key)) {
            out[key] = normalizeOverrideNumericId(value, key);
            continue;
        }
        if (family === "roads" && key === "confidence_score") {
            out[key] = normalizeOverrideOptionalScore(value, key);
            continue;
        }
        if (family === "roads" && key === "is_oneway") {
            out[key] = normalizeOverrideOptionalBoolean(value, key);
            continue;
        }
        if (family === "roads" && (key === "name_mm" || key === "name_en" || key === "surface")) {
            out[key] = normalizeOptionalOverrideString(value, key);
            continue;
        }
        out[key] = value;
    }

    return out;
}
