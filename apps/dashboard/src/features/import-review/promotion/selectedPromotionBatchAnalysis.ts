import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import { isCandidateActiveLockedBatched } from "../utils/importReviewPromotionListState";
import { isCandidateAlreadyPromoted, isCandidateReviewApproved } from "./candidatePromotionUiState";

export type SelectedPromotionBatchAnalysis = {
    selectedCount: number;
    selectedRows: ImportReviewBuildingListItem[];
    notApprovedCount: number;
    promotedCount: number;
    manualProtectedCount: number;
    batchedCount: number;
};

export function analyzeSelectedPromotionBatch(
    items: ImportReviewBuildingListItem[],
    selectedIds: Set<string>
): SelectedPromotionBatchAnalysis {
    const map = new Map(items.map((r) => [r.id, r]));
    const selectedRows: ImportReviewBuildingListItem[] = [];
    let notApprovedCount = 0;
    let promotedCount = 0;
    let manualProtectedCount = 0;
    let batchedCount = 0;

    for (const id of selectedIds) {
        const row = map.get(id);
        if (!row) {
            continue;
        }
        selectedRows.push(row);
        if (!isCandidateReviewApproved(row)) {
            notApprovedCount += 1;
        }
        if (isCandidateAlreadyPromoted(row)) {
            promotedCount += 1;
        }
        if (row.match_status === "manual_protected" || row.auto_action === "protect_manual") {
            manualProtectedCount += 1;
        }
        if (isCandidateActiveLockedBatched(row)) {
            batchedCount += 1;
        }
    }

    return {
        selectedCount: selectedIds.size,
        selectedRows,
        notApprovedCount,
        promotedCount,
        manualProtectedCount,
        batchedCount,
    };
}

export function selectedPromotionBatchBlockedReason(
    analysis: SelectedPromotionBatchAnalysis
): string | null {
    if (analysis.selectedCount === 0) {
        return "Select at least one road.";
    }
    if (analysis.promotedCount > 0) {
        return "Selection includes already promoted roads. Deselect them first.";
    }
    if (analysis.notApprovedCount > 0) {
        return "All selected roads must be approved before creating a publish batch.";
    }
    if (analysis.manualProtectedCount > 0) {
        return "Selection includes manual_protected roads.";
    }
    if (analysis.batchedCount > 0) {
        return "Selection includes candidates locked in an active publish batch. Deselect them or wait for the batch to finish.";
    }
    return null;
}
