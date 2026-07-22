import type {
    ImportReviewFilterField,
    ImportReviewReviewField,
    ImportReviewStatusColorRules,
    ImportReviewTableColumn,
} from "./types";

export const IMPORT_REVIEW_DEFAULT_SORT = "updated_at_desc";

export const IMPORT_REVIEW_REVIEW_EDITABLE_FIELDS: readonly ImportReviewReviewField[] = [
    "review_decision",
    "review_note",
];

export const IMPORT_REVIEW_STANDARD_FILTER_FIELDS: readonly ImportReviewFilterField[] = [
    "match_status",
    "review_decision",
    "promotion_status",
    "q",
    "sort",
    "limit",
    "offset",
];

export const IMPORT_REVIEW_BUILDINGS_EXTRA_FILTER_FIELDS: readonly ImportReviewFilterField[] = [];

export const IMPORT_REVIEW_COMMON_TABLE_COLUMNS: readonly ImportReviewTableColumn[] = [
    { key: "imported_entity", label: "Imported", source: "row" },
    { key: "matched_core_entity", label: "Matched core", source: "row" },
    { key: "match_status", label: "Comparison", source: "row" },
    { key: "confidence_score", label: "Confidence", source: "row" },
    { key: "protection", label: "Protection", source: "row" },
    { key: "review_decision", label: "Decision", source: "row" },
    { key: "promotion_status", label: "Apply", source: "row" },
];

export const IMPORT_REVIEW_DEFAULT_ID_COLUMNS: readonly ImportReviewTableColumn[] = [
    { key: "id", label: "ID", source: "row", mono: true },
    { key: "external_id", label: "External ID", source: "row", mono: true },
];

/** Mirrors importReviewRowSurface in importReviewTableUi.tsx. */
export const IMPORT_REVIEW_DEFAULT_STATUS_COLOR_RULES: ImportReviewStatusColorRules = {
    manualProtectedMatchStatus: "manual_protected",
    rules: [
        { when: { field: "review_decision", value: "keep_existing" }, tone: "approved" },
        { when: { field: "review_decision", value: "replace_existing" }, tone: "approved" },
        { when: { field: "review_decision", value: "merge_fields" }, tone: "merged" },
        { when: { field: "review_decision", value: "insert_separate" }, tone: "approved" },
        { when: { field: "review_decision", value: "confirm_soft_delete" }, tone: "rejected" },
        { when: { field: "review_decision", value: "mark_duplicate" }, tone: "merged" },
        { when: { field: "review_decision", value: "ignore_import" }, tone: "ignored" },
        { when: { field: "review_decision", value: "needs_more_review" }, tone: "needs_review" },
        { when: { field: "review_decision", value: "approved" }, tone: "approved" },
        { when: { field: "review_decision", value: "rejected" }, tone: "rejected" },
        { when: { field: "review_decision", value: "ignored" }, tone: "ignored" },
        { when: { field: "review_decision", value: "merged" }, tone: "merged" },
    ],
};

import { importReviewPath } from "@/src/lib/dashboardPaths";

export function importReviewRoutePath(slug: string): string {
    return importReviewPath(slug);
}
