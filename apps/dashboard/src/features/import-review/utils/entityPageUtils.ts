import type { ImportReviewBuildingListItem } from "@/src/lib/api";
import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";

import type { ImportReviewTableColumn } from "../config/types";
import {
    formatLandAreaClassTableCell,
    formatLandAreaSourceClassCell,
} from "./importReviewLandAreaListDisplay";
import {
    formatCandidateName,
    isImportReviewNameTableColumn,
} from "./importReviewNaming";

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

/** Stable string for React Query keys — avoids refetch from object identity churn. */
export function serializeImportReviewListFilters(filters: ImportReviewListFilters): string {
    return [
        filters.match_status,
        filters.auto_action,
        filters.review_status,
        filters.review_decision,
        filters.promotion_status,
        filters.class_code,
    ].join("|");
}

/** Stable key for list fetches — selection clears only when this changes. */
export function buildImportReviewListQueryKey(input: {
    apiScopeQuery: ImportReviewScopeQueryParams | null;
    limit: number;
    offset: number;
    sort: string;
    filters: Record<string, string>;
    qApplied: string;
    promotionState?: string;
    apiFamily?: string;
}): string {
    return JSON.stringify({
        scope: input.apiScopeQuery,
        limit: input.limit,
        offset: input.offset,
        sort: input.sort,
        filters: input.filters,
        q: input.qApplied,
        promotionState: input.promotionState ?? "all_active",
        apiFamily: input.apiFamily ?? "",
    });
}

export function readImportReviewListFilters(sp: URLSearchParams): ImportReviewListFilters {
    // Default conflict queue: pending decisions (API maps pending → NULL review_decision).
    const hasDecision = sp.has("review_decision");
    return {
        match_status: sp.get("match_status")?.trim() ?? "",
        auto_action: sp.get("auto_action")?.trim() ?? "",
        review_status: sp.get("review_status")?.trim() ?? "",
        review_decision: hasDecision
            ? (sp.get("review_decision")?.trim() ?? "")
            : "pending",
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

import {
    formatImportReviewBuildingTypeLabel,
    formatImportReviewBuildingTypeLabel as formatBuildingTypeLabel,
} from "@/src/lib/building-type/display";
import { displayImportReviewRoadClassColumn } from "./importReviewRoadClassDisplay";

export { formatBuildingTypeLabel };

export function importReviewRowHasOverrides(row: ImportReviewBuildingListItem): boolean {
    return row.has_overrides === true;
}

export function importReviewCellValue(row: ImportReviewBuildingListItem, col: ImportReviewTableColumn): string {
    if (col.key === "imported_entity") {
        const r = row as Record<string, unknown>;
        return dash(
            (r.display_name as string | null | undefined) ??
                (r.primary_name as string | null | undefined) ??
                row.canonical_name ??
                row.name ??
                row.external_id
        );
    }
    if (col.key === "matched_core_entity") {
        const core = row.matched_core_data;
        if (core && typeof core === "object" && !Array.isArray(core)) {
            const o = core as Record<string, unknown>;
            const name = o.primary_name ?? o.display_name ?? o.name ?? o.canonical_name;
            if (typeof name === "string" && name.trim()) return name.trim();
        }
        return dash(row.matched_core_id);
    }
    if (col.key === "protection") {
        const m = (row.match_status ?? "").trim().toLowerCase();
        const a = (row.auto_action ?? "").trim().toLowerCase();
        if (m === "manual_protected" || a === "protect_manual") return "manual";
        if (m === "verified_conflict") return "verified";
        return "—";
    }
    if (col.key === "match_status") {
        return dash(row.comparison_status ?? row.match_status);
    }
    if (col.key === "promotion_status") {
        return dash(row.apply_status ?? row.promotion_status);
    }
    if (col.key === "review_decision") {
        const d = (row.review_decision_meaning ?? row.review_decision ?? "pending").trim();
        return d || "pending";
    }
    // Typed direct-edit columns win over source/legacy names — see docs/import-review/naming-contract.md
    if (isImportReviewNameTableColumn(col.key)) {
        return formatCandidateName(row, col.key);
    }
    if (col.key === "building_type_display") {
        return dash(formatBuildingTypeLabel(row));
    }
    if (col.key === "land_area_class_display") {
        return formatLandAreaClassTableCell(row);
    }
    if (col.key === "imported_class_code") {
        return formatLandAreaSourceClassCell(row);
    }
    if (col.key === "road_class_display") {
        return displayImportReviewRoadClassColumn(row);
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
