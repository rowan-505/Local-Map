import type { ImportReviewBuildingListItem } from "@/src/lib/api";
import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";

import type { ImportReviewTableColumn } from "../config/types";

export const IMPORT_REVIEW_UNREVIEWED_FILTER = "__unreviewed__";

export const IMPORT_REVIEW_SORT_OPTIONS: { value: string; label: string }[] = [
    { value: "updated_at_desc", label: "Updated (newest)" },
    { value: "updated_at_asc", label: "Updated (oldest)" },
    { value: "created_at_desc", label: "Created (newest)" },
    { value: "created_at_asc", label: "Created (oldest)" },
    { value: "confidence_score_desc", label: "Confidence (high)" },
    { value: "confidence_score_asc", label: "Confidence (low)" },
    { value: "canonical_name_asc", label: "Name A–Z" },
    { value: "canonical_name_desc", label: "Name Z–A" },
    { value: "external_id_asc", label: "External ID A–Z" },
    { value: "external_id_desc", label: "External ID Z–A" },
    { value: "id_desc", label: "ID (high)" },
    { value: "id_asc", label: "ID (low)" },
];

export const IMPORT_REVIEW_LIMIT_CHOICES = [25, 50, 100, 200] as const;

export type ImportReviewListFilters = {
    match_status: string;
    auto_action: string;
    review_status: string;
    review_decision: string;
    promotion_status: string;
    class_code: string;
};

/** Stable key for list fetches — selection clears only when this changes. */
export function buildImportReviewListQueryKey(input: {
    apiScopeQuery: ImportReviewScopeQueryParams | null;
    limit: number;
    offset: number;
    sort: string;
    filters: Record<string, string>;
    qApplied: string;
    showPromoted?: boolean;
    apiFamily?: string;
}): string {
    return JSON.stringify({
        scope: input.apiScopeQuery,
        limit: input.limit,
        offset: input.offset,
        sort: input.sort,
        filters: input.filters,
        q: input.qApplied,
        showPromoted: input.showPromoted ?? false,
        apiFamily: input.apiFamily ?? "",
    });
}

export function readImportReviewListFilters(sp: URLSearchParams): ImportReviewListFilters {
    return {
        match_status: sp.get("match_status")?.trim() ?? "",
        auto_action: sp.get("auto_action")?.trim() ?? "",
        review_status: sp.get("review_status")?.trim() ?? "",
        review_decision: sp.get("review_decision")?.trim() ?? "",
        promotion_status: sp.get("promotion_status")?.trim() ?? "",
        class_code: sp.get("class_code")?.trim() ?? "",
    };
}

export function dash(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
        return "—";
    }
    if (typeof value === "string" && value.trim() === "") {
        return "—";
    }
    return String(value);
}

export function formatImportReviewTs(value: string | null | undefined): string {
    if (!value?.trim()) {
        return "—";
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function normPick(data: unknown, key: string): unknown {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return undefined;
    }
    const o = data as Record<string, unknown>;
    if (key in o) {
        return o[key];
    }
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camel in o) {
        return o[camel];
    }
    return undefined;
}

export function formatBuildingTypeLabel(row: ImportReviewBuildingListItem): string {
    const code = row.building_type_code?.trim();
    const name = row.building_type_name?.trim();
    if (code && name) {
        return `${code} — ${name}`;
    }
    return code || name || row.building_type?.trim() || "";
}

export function importReviewRowHasOverrides(row: ImportReviewBuildingListItem): boolean {
    return row.has_overrides === true;
}

export function importReviewCellValue(row: ImportReviewBuildingListItem, col: ImportReviewTableColumn): string {
    if (col.key === "building_type_display") {
        return dash(formatBuildingTypeLabel(row));
    }
    if (col.source === "normalized") {
        const v = normPick(row.normalized_data, col.key);
        if (v === null || v === undefined) {
            return "—";
        }
        if (typeof v === "object") {
            try {
                return JSON.stringify(v);
            } catch {
                return "—";
            }
        }
        return String(v);
    }
    if (col.key === "updated_at" || col.key === "created_at") {
        return formatImportReviewTs((row as Record<string, unknown>)[col.key] as string | null | undefined);
    }
    const raw = (row as Record<string, unknown>)[col.key];
    return dash(raw as string | number | null | undefined);
}

export const IMPORT_REVIEW_SELECT_CLASS =
    "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-800";
