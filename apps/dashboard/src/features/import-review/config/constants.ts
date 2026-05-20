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
    "auto_action",
    "review_status",
    "review_decision",
    "promotion_status",
    "q",
    "sort",
    "limit",
    "offset",
    "include_promoted",
];

export const IMPORT_REVIEW_BUILDINGS_EXTRA_FILTER_FIELDS: readonly ImportReviewFilterField[] = [
    "class_code",
];

export const IMPORT_REVIEW_COMMON_TABLE_COLUMNS: readonly ImportReviewTableColumn[] = [
    { key: "confidence_score", label: "Confidence", source: "row" },
    { key: "match_status", label: "Match", source: "row" },
    { key: "auto_action", label: "Auto", source: "row" },
    { key: "review_status", label: "Review status", source: "row" },
    { key: "review_decision", label: "Decision", source: "row" },
    { key: "promotion_status", label: "Promotion", source: "row" },
    { key: "updated_at", label: "Updated", source: "row" },
];

export const IMPORT_REVIEW_DEFAULT_ID_COLUMNS: readonly ImportReviewTableColumn[] = [
    { key: "id", label: "ID", source: "row", mono: true },
    { key: "external_id", label: "External ID", source: "row", mono: true },
];

/** Mirrors importReviewRowSurface in importReviewTableUi.tsx. */
export const IMPORT_REVIEW_DEFAULT_STATUS_COLOR_RULES: ImportReviewStatusColorRules = {
    manualProtectedMatchStatus: "manual_protected",
    rules: [
        { when: { field: "review_decision", value: "approved" }, tone: "approved" },
        { when: { field: "review_status", value: "approved" }, tone: "approved" },
        { when: { field: "review_decision", value: "rejected" }, tone: "rejected" },
        { when: { field: "review_status", value: "rejected" }, tone: "rejected" },
        { when: { field: "review_decision", value: "needs_more_review" }, tone: "needs_review" },
        { when: { field: "review_status", value: "needs_review" }, tone: "needs_review" },
        { when: { field: "review_status", value: "needs_more_review" }, tone: "needs_review" },
        { when: { field: "review_decision", value: "ignored" }, tone: "ignored" },
        { when: { field: "review_status", value: "ignored" }, tone: "ignored" },
        { when: { field: "review_decision", value: "merged" }, tone: "merged" },
        { when: { field: "review_status", value: "merged" }, tone: "merged" },
    ],
};

export function importReviewRoutePath(slug: string): string {
    return `/import-review/${slug}`;
}
