const NUMERIC_BATCH_ID_RE = /^\d+$/;

const INVALID_ROUTE_ID_LITERALS = new Set(["undefined", "null"]);

export const IMPORT_REVIEW_PROMOTION_BATCH_INVALID_ROUTE_ID_MESSAGE =
    "Invalid promotion batch id. Go back and create a promotion batch again.";

export function isValidImportReviewPromotionBatchRouteId(
    id: string | null | undefined
): boolean {
    return parseValidImportReviewPromotionBatchRouteId(id) !== null;
}

/** Returns trimmed numeric batch id for API routes, or null when the route param is invalid. */
export function parseValidImportReviewPromotionBatchRouteId(
    id: string | null | undefined
): string | null {
    const text = String(id ?? "").trim();
    if (!text || INVALID_ROUTE_ID_LITERALS.has(text.toLowerCase())) {
        return null;
    }
    if (!NUMERIC_BATCH_ID_RE.test(text)) {
        return null;
    }
    return text;
}
