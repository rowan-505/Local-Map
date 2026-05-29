import { importTransportPath } from "@/src/lib/dashboardPaths";

import type { ImportTransportEntitySlug } from "../config/types";
import { applyImportTransportScopeSearchParams } from "../utils/importTransportScope";

export type ImportTransportEntityUrlFilters = {
    review_status?: string;
    review_decision?: string;
    promotion_status?: string;
    validation_status?: string;
    mode_type?: string;
    q?: string;
    sort?: string;
    limit?: number | string;
    offset?: number | string;
    include_promoted?: boolean;
    latest?: boolean;
};

export type BuildImportTransportEntityUrlInput = {
    import_batch_id?: string;
    source_snapshot_version?: string;
    filters?: ImportTransportEntityUrlFilters;
};

/**
 * Build `/dashboard/import-transport/{slug}` with batch-preferred scope and optional list filters.
 * Never sets both import_batch_id and source_snapshot_version (XOR scope).
 */
export function buildImportTransportEntityUrl(
    slug: ImportTransportEntitySlug | string,
    input: BuildImportTransportEntityUrlInput = {}
): string {
    const pathSlug = slug.trim().toLowerCase();
    const params = new URLSearchParams();
    applyImportTransportScopeSearchParams(params, {
        snapshotInput: input.source_snapshot_version?.trim() ?? "",
        batchInput: input.import_batch_id?.trim() ?? "",
    });

    const filters = input.filters;
    if (filters) {
        if (filters.latest && !input.import_batch_id?.trim()) {
            params.set("latest", "true");
        }
        for (const key of [
            "review_status",
            "review_decision",
            "promotion_status",
            "validation_status",
            "mode_type",
            "q",
            "sort",
        ] as const) {
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
    const base = importTransportPath(pathSlug);
    return qs ? `${base}?${qs}` : base;
}
