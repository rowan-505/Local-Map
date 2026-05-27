import type { ImportReviewFormOptionsResponse } from "./import-review-options.types.js";

const FORM_OPTIONS_TTL_MS = 10 * 60 * 1000;

let cached: { fetchedAt: number; data: ImportReviewFormOptionsResponse } | null = null;

export function readCachedFormOptions(): ImportReviewFormOptionsResponse | null {
    if (!cached) {
        return null;
    }
    if (Date.now() - cached.fetchedAt > FORM_OPTIONS_TTL_MS) {
        cached = null;
        return null;
    }
    return cached.data;
}

export function writeCachedFormOptions(data: ImportReviewFormOptionsResponse): void {
    cached = { fetchedAt: Date.now(), data };
}

export function clearCachedFormOptions(): void {
    cached = null;
}
