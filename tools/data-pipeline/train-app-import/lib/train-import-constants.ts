/** DB import constants for the simple Myanmar train app pipeline (v1). */

export const TRAIN_IMPORT_SOURCE_NAME = "myanmar_train_app";
export const TRAIN_IMPORT_SOURCE_KIND = "visible_app_extraction";
export const TRAIN_IMPORT_GENERATION = "simple_train_system_v1";
export const TRAIN_LEGACY_GENERATION = "pre_simple_train_import";
export const TRAIN_LEGACY_GROUP = "pre_simple_train_import";
export const TRAIN_LEGACY_REVIEW_STATUS = "needs_review";
export const TRAIN_IMPORT_REVIEW_STATUS = "imported_unreviewed";
export const TRAIN_IMPORT_CONFIDENCE_SCORE = 70;
export const TRAIN_MODE = "train";
export const TRAIN_ROUTE_KIND = "rail";

/** Yangon Railway Service train app (visible on device as com.yangonrailwayservice.yrs). */
export const DEFAULT_TRAIN_APP_PACKAGE = "com.yangonrailwayservice.yrs";

export const PROTECTED_REVIEW_STATUSES = new Set([
    "reviewed",
    "verified",
    "manual_protected",
]);

/** Review statuses kept unchanged when marking legacy train data. */
export const LEGACY_MARK_IMMUTABLE_REVIEW_STATUSES = new Set([
    "verified",
    "manual_protected",
]);

export const MERGEABLE_REVIEW_STATUSES = new Set([
    "imported_unreviewed",
    "needs_review",
]);

export function isProtectedReviewStatus(status: string | null | undefined): boolean {
    return PROTECTED_REVIEW_STATUSES.has((status ?? "").trim());
}

export function isLegacyMarkImmutableReviewStatus(status: string | null | undefined): boolean {
    return LEGACY_MARK_IMMUTABLE_REVIEW_STATUSES.has((status ?? "").trim());
}

export function resolveLegacyMarkReviewStatus(status: string | null | undefined): string {
    const trimmed = (status ?? "").trim();
    if (isLegacyMarkImmutableReviewStatus(trimmed)) {
        return trimmed;
    }
    return TRAIN_LEGACY_REVIEW_STATUS;
}

export function isMergeableReviewStatus(status: string | null | undefined): boolean {
    return MERGEABLE_REVIEW_STATUSES.has((status ?? "").trim());
}

export function directionIdFromCode(directionCode: string): number | null {
    const code = directionCode.trim().toUpperCase();
    if (code === "UP") {
        return 0;
    }
    if (code === "DOWN") {
        return 1;
    }
    if (code === "CLOCKWISE" || code === "ANTICLOCKWISE") {
        return null;
    }
    return null;
}

export function directionLabelFromCode(directionCode: string): string {
    const code = directionCode.trim().toUpperCase();
    if (code === "UP") {
        return "Up";
    }
    if (code === "DOWN") {
        return "Down";
    }
    if (code === "CLOCKWISE") {
        return "Clockwise";
    }
    if (code === "ANTICLOCKWISE") {
        return "Anticlockwise";
    }
    return directionCode;
}

export function buildTrainSourceRefs(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        source_name: TRAIN_IMPORT_SOURCE_NAME,
        source_kind: TRAIN_IMPORT_SOURCE_KIND,
        generation: TRAIN_IMPORT_GENERATION,
        ...extra,
    };
}

export function buildTrainNormalizedData(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        generation: TRAIN_IMPORT_GENERATION,
        source_name: TRAIN_IMPORT_SOURCE_NAME,
        ...extra,
    };
}
