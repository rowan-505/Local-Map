import { importReviewPath } from "@/src/lib/dashboardPaths";
import { applyImportReviewScopeSearchParams } from "@/src/lib/importReviewSnapshot";

import type { ImportReviewEntitySlug } from "../config/types";

export type ImportReviewEntityUrlFilters = {
    match_status?: string;
    auto_action?: string;
    review_status?: string;
    review_decision?: string;
    promotion_status?: string;
    class_code?: string;
    q?: string;
    sort?: string;
    limit?: number | string;
    offset?: number | string;
    include_promoted?: boolean;
    latest?: boolean;
};

export type BuildImportReviewEntityUrlInput = {
    review_batch_id?: string;
    source_snapshot_version?: string;
    filters?: ImportReviewEntityUrlFilters;
};

/**
 * Build `/import-review/{slug}` with batch-preferred scope and optional list filters.
 * Never sets both review_batch_id and source_snapshot_version (XOR scope).
 */
export function buildImportReviewEntityUrl(
    slug: ImportReviewEntitySlug | string,
    input: BuildImportReviewEntityUrlInput = {}
): string {
    const pathSlug = slug.trim().toLowerCase();
    const params = new URLSearchParams();
    const batch = input.review_batch_id?.trim() ?? "";
    const snap = input.source_snapshot_version?.trim() ?? "";

    applyImportReviewScopeSearchParams(params, snap, batch);

    const filters = input.filters;
    if (filters) {
        if (filters.latest && !batch) {
            params.set("latest", "true");
        }
        const stringKeys = [
            "match_status",
            "auto_action",
            "review_status",
            "review_decision",
            "promotion_status",
            "class_code",
            "q",
            "sort",
        ] as const;
        for (const key of stringKeys) {
            const val = filters[key]?.trim();
            if (val) {
                params.set(key, val);
            }
        }
        if (filters.limit !== undefined && String(filters.limit).trim() !== "") {
            params.set("limit", String(filters.limit));
        }
        if (filters.offset !== undefined && String(filters.offset).trim() !== "") {
            params.set("offset", String(filters.offset));
        }
        if (filters.include_promoted) {
            params.set("include_promoted", "true");
        }
    }

    const qs = params.toString();
    const base = importReviewPath(pathSlug);
    return qs ? `${base}?${qs}` : base;
}
