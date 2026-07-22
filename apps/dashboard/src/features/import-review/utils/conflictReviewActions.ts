import type { ImportReviewBuildingListItem, ImportReviewDecision } from "@/src/lib/api";

export type ConflictReviewAction = {
    decision: ImportReviewDecision;
    label: string;
    description: string;
};

const ALL_ACTIONS: ConflictReviewAction[] = [
    {
        decision: "keep_existing",
        label: "Keep existing",
        description: "Leave the matched core row unchanged and close this conflict.",
    },
    {
        decision: "replace_existing",
        label: "Replace existing",
        description: "Overwrite the matched core row with imported values.",
    },
    {
        decision: "merge_fields",
        label: "Merge fields",
        description: "Choose per field: existing, imported, or leave for apply.",
    },
    {
        decision: "insert_separate",
        label: "Insert separately",
        description: "Insert imported as a new core row; keep the matched core.",
    },
    {
        decision: "ignore_import",
        label: "Ignore imported",
        description: "Discard this import candidate with no core write.",
    },
    {
        decision: "mark_duplicate",
        label: "Mark duplicate",
        description: "Record as duplicate of the matched (or selected) core target.",
    },
    {
        decision: "confirm_soft_delete",
        label: "Confirm soft delete",
        description: "Soft-delete the matched core row for an OSM deletion candidate.",
    },
    {
        decision: "needs_more_review",
        label: "Needs more review",
        description: "Leave in queue for another pass.",
    },
];

export function comparisonStatusOf(row: Pick<ImportReviewBuildingListItem, "match_status" | "comparison_status">): string {
    const fromApi = (row.comparison_status ?? "").trim().toLowerCase();
    if (fromApi) return fromApi;
    const m = (row.match_status ?? "").trim().toLowerCase();
    if (m === "duplicate_candidate" || m === "possible_duplicate") return "duplicate";
    if (m === "delete_candidate") return "possible_delete";
    if (m === "needs_review") return "conflict";
    return m;
}

export function applyStatusOf(row: Pick<ImportReviewBuildingListItem, "promotion_status" | "apply_status">): string {
    const fromApi = (row.apply_status ?? "").trim().toLowerCase();
    if (fromApi) return fromApi;
    const p = (row.promotion_status ?? "").trim().toLowerCase();
    if (p === "not_ready") return "not_applied";
    if (p === "batched" || p === "promoting") return "applying";
    if (p === "promoted" || p === "skipped") return "applied";
    return p || "not_applied";
}

export function isManualOrVerifiedProtected(row: Pick<ImportReviewBuildingListItem, "match_status" | "auto_action">): boolean {
    const comparison = comparisonStatusOf(row);
    if (comparison === "manual_protected" || comparison === "verified_conflict") return true;
    const auto = (row.auto_action ?? "").trim().toLowerCase();
    return auto === "protect_manual";
}

export function hasMatchedCore(row: Pick<ImportReviewBuildingListItem, "matched_core_id">): boolean {
    return Boolean((row.matched_core_id ?? "").toString().trim());
}

/**
 * Conditional review actions for conflict-only workspace.
 */
export function availableConflictReviewActions(
    row: Pick<ImportReviewBuildingListItem, "match_status" | "comparison_status" | "matched_core_id" | "auto_action">
): ConflictReviewAction[] {
    const comparison = comparisonStatusOf(row);
    const matched = hasMatchedCore(row);
    const out: ConflictReviewAction[] = [];

    const add = (decision: ImportReviewDecision) => {
        const item = ALL_ACTIONS.find((a) => a.decision === decision);
        if (item) out.push(item);
    };

    add("needs_more_review");
    add("ignore_import");

    if (comparison === "possible_delete") {
        if (matched) add("confirm_soft_delete");
        add("keep_existing");
        return out;
    }

    if (matched) {
        add("keep_existing");
        add("replace_existing");
        add("merge_fields");
        add("mark_duplicate");
    }

    if (comparison === "duplicate" || comparison === "conflict" || comparison === "verified_conflict") {
        add("insert_separate");
    }

    if (comparison === "manual_protected" && matched) {
        // Keep / merge / replace already added when matched; insert rarely needed.
    }

    // Deduplicate while preserving order
    const seen = new Set<string>();
    return out.filter((a) => {
        if (seen.has(a.decision)) return false;
        seen.add(a.decision);
        return true;
    });
}

export function conflictDecisionLabel(decision: string | null | undefined): string {
    const d = (decision ?? "").trim().toLowerCase();
    if (!d || d === "pending") return "pending";
    return ALL_ACTIONS.find((a) => a.decision === d)?.label ?? d;
}

export const CONFLICT_COMPARISON_FILTER_OPTIONS = [
    "duplicate",
    "conflict",
    "manual_protected",
    "verified_conflict",
    "possible_delete",
] as const;

export const CONFLICT_DECISION_FILTER_OPTIONS = [
    "pending",
    "keep_existing",
    "replace_existing",
    "merge_fields",
    "insert_separate",
    "ignore_import",
    "mark_duplicate",
    "confirm_soft_delete",
    "needs_more_review",
] as const;

export const CONFLICT_APPLY_FILTER_OPTIONS = [
    "not_applied",
    "ready",
    "applying",
    "applied",
    "failed",
] as const;
