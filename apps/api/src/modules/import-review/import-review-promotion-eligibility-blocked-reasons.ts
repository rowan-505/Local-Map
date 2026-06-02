/** @deprecated Import from import-review-promotion-eligibility-reasons.js */
export {
    isDuplicateUnconfirmed,
    isManualProtected,
    isRejectedDecision,
    resolvePromotionEligibilityBlockedReasons,
    type PromotionEligibilityReasonRow as PromotionEligibilityBlockedReasonRow,
} from "./import-review-promotion-eligibility-reasons.js";

export { roadDuplicateCoreExternalIdSql, roadClassMissingWithoutFallbackSql } from "./import-review-road-promotion-policy.js";

/** @deprecated Use geometry_missing / duplicate_core_external_id flags on reason rows instead. */
export function isDuplicateExternalIdInCore(row: {
    matched_core_id: bigint | null;
    duplicate_core_external_id?: boolean;
}): boolean {
    return row.duplicate_core_external_id === true;
}

/** @deprecated Use required_type_missing / road_class_missing_no_fallback flags on reason rows instead. */
export function isRoadClassMissingNoFallback(row: {
    road_class_id: bigint | null;
    class_code: string | null;
    normalized_data: unknown;
    road_class_missing_no_fallback?: boolean;
}): boolean {
    if (row.road_class_missing_no_fallback === true) {
        return true;
    }
    const nd = row.normalized_data;
    const highwayFromNd =
        nd && typeof nd === "object" && !Array.isArray(nd)
            ? String((nd as Record<string, unknown>).highway ?? "").trim()
            : "";
    return (
        row.road_class_id === null &&
        (row.class_code?.trim() ?? "") === "" &&
        highwayFromNd === ""
    );
}
