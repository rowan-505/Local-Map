const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export type CoreReviewExactIdSearch = {
    numericId: bigint | null;
    publicId: string | null;
};

/**
 * Recognize complete IDs only so repository predicates can use indexed equality.
 * Partial IDs remain ordinary text search terms.
 */
export function parseCoreReviewExactIdSearch(search?: string): CoreReviewExactIdSearch {
    const trimmed = search?.trim() ?? "";

    if (UUID_PATTERN.test(trimmed)) {
        return { numericId: null, publicId: trimmed };
    }

    if (/^\d+$/.test(trimmed)) {
        const numericId = BigInt(trimmed);
        if (numericId <= POSTGRES_BIGINT_MAX) {
            return { numericId, publicId: null };
        }
    }

    return { numericId: null, publicId: null };
}
