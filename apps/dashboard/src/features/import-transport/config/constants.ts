import { importTransportPath } from "@/src/lib/dashboardPaths";

import type { ImportTransportEntitySlug, ImportTransportFilterField } from "./types";

export const IMPORT_TRANSPORT_DEFAULT_SORT = "updated_at_desc";

export const IMPORT_TRANSPORT_SELECT_CLASS =
    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-100";

export const IMPORT_TRANSPORT_FAMILY_FILTER_FIELDS: Record<
    ImportTransportEntitySlug,
    readonly ImportTransportFilterField[]
> = {
    routes: ["review_status", "validation_status", "promotion_status", "mode_type", "q", "sort", "limit", "offset"],
    stops: ["review_status", "validation_status", "promotion_status", "q", "sort", "limit", "offset"],
    variants: ["review_status", "validation_status", "promotion_status", "mode_type", "q", "sort", "limit", "offset"],
    "route-stops": [
        "review_status",
        "validation_status",
        "promotion_status",
        "mode_type",
        "q",
        "sort",
        "limit",
        "offset",
    ],
};

export const IMPORT_TRANSPORT_SORT_OPTIONS: { value: string; label: string }[] = [
    { value: "updated_at_desc", label: "Updated (newest)" },
    { value: "updated_at_asc", label: "Updated (oldest)" },
    { value: "confidence_score_desc", label: "Confidence (high)" },
    { value: "confidence_score_asc", label: "Confidence (low)" },
    { value: "stop_sequence_asc", label: "Stop sequence (low)" },
    { value: "stop_sequence_desc", label: "Stop sequence (high)" },
    { value: "id_desc", label: "ID (high)" },
    { value: "id_asc", label: "ID (low)" },
];

export const IMPORT_TRANSPORT_LIMIT_CHOICES = [25, 50, 100, 200] as const;

export const IMPORT_TRANSPORT_SEARCH_PLACEHOLDERS: Partial<Record<ImportTransportEntitySlug, string>> = {
    routes: "Route code or public name",
    stops: "Stop name or stop code",
    variants: "Route code, variant code, or direction",
    "route-stops": "Route code, variant code, or stop name",
};

export function importTransportRoutePath(slug: string): string {
    return importTransportPath(slug);
}

export function importTransportSortOptionsForSlug(slug: ImportTransportEntitySlug) {
    if (slug === "route-stops") {
        return IMPORT_TRANSPORT_SORT_OPTIONS;
    }
    return IMPORT_TRANSPORT_SORT_OPTIONS.filter(
        (opt) => !opt.value.startsWith("stop_sequence_")
    );
}
