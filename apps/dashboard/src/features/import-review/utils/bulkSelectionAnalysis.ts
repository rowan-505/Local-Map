import type { ImportReviewBuildingListItem } from "@/src/lib/api";
import { validationMessagesFromReviewJson } from "@/src/lib/importReviewValidationMessages";

export type BulkSelectionAnalysis = {
    selectedCount: number;
    selectedRows: ImportReviewBuildingListItem[];
    hasPromoted: boolean;
    hasManualProtected: boolean;
    hasDuplicateCandidate: boolean;
    hasValidationErrors: boolean;
    validationMessages: string[];
};

export function analyzeBulkSelection(
    items: ImportReviewBuildingListItem[],
    selectedIds: Set<string>
): BulkSelectionAnalysis {
    const map = new Map(items.map((r) => [r.id, r]));
    const selectedRows: ImportReviewBuildingListItem[] = [];
    let hasPromoted = false;
    let hasManualProtected = false;
    let hasDuplicateCandidate = false;
    let hasValidationErrors = false;
    const validationMessages: string[] = [];

    for (const id of selectedIds) {
        const row = map.get(id);
        if (!row) {
            continue;
        }
        selectedRows.push(row);
        if ((row.promotion_status ?? "").toLowerCase() === "promoted") {
            hasPromoted = true;
        }
        if (row.match_status === "duplicate_candidate") {
            hasDuplicateCandidate = true;
        }
        if (row.match_status === "manual_protected" || row.auto_action === "protect_manual") {
            hasManualProtected = true;
        }
        const errs = validationMessagesFromReviewJson(row.validation_errors);
        if (errs.length > 0) {
            hasValidationErrors = true;
            for (const m of errs) {
                if (!validationMessages.includes(m)) {
                    validationMessages.push(m);
                }
            }
        }
    }

    return {
        selectedCount: selectedIds.size,
        selectedRows,
        hasPromoted,
        hasManualProtected,
        hasDuplicateCandidate,
        hasValidationErrors: validationMessages.length > 0,
        validationMessages,
    };
}

export function bulkApproveBlockedReason(
    analysis: BulkSelectionAnalysis,
    dangerForceEnabled: boolean
): string | null {
    if (analysis.selectedCount === 0) {
        return "No rows selected.";
    }
    if (analysis.hasPromoted) {
        return "Selection includes promoted rows. Remove them before bulk approve.";
    }
    if (analysis.hasValidationErrors) {
        return "Selection includes validation errors. Fix overrides or deselect those rows.";
    }
    if (analysis.hasManualProtected && !dangerForceEnabled) {
        return "Selection includes manual_protected / protect_manual. Enable a danger override in Advanced.";
    }
    if (analysis.hasDuplicateCandidate && !dangerForceEnabled) {
        return "Selection includes duplicate_candidate rows. Enable duplicate override in Advanced.";
    }
    return null;
}
