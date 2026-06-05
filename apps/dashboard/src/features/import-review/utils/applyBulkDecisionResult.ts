import type { Dispatch, SetStateAction } from "react";

import type {
    ImportReviewBulkDecisionResponse,
    ImportReviewBulkSkippedReason,
    ImportReviewDecision,
    ImportReviewReviewStatus,
} from "@/src/lib/api";

export function reviewStatusForBulkDecision(decision: ImportReviewDecision): ImportReviewReviewStatus {
    if (decision === "needs_more_review") {
        return "needs_review";
    }
    return decision;
}

export type BulkDecisionApplyOutcome = "updated" | "no_update" | "preview";

export function formatBulkSkippedReasons(skippedReasons: ImportReviewBulkSkippedReason[]): string | null {
    if (skippedReasons.length === 0) {
        return null;
    }
    const lines = skippedReasons.map((r) => `${r.reason}: ${r.count.toLocaleString()}`);
    return `Skipped: ${lines.join("; ")}`;
}

export function removeUpdatedIdsFromSelection(
    selectedIds: Set<string>,
    updatedIds: readonly number[] | undefined
): Set<string> {
    if (!updatedIds || updatedIds.length === 0) {
        return selectedIds;
    }
    const updatedIdStrings = new Set(updatedIds.map((id) => String(id)));
    const next = new Set<string>();
    for (const id of selectedIds) {
        if (!updatedIdStrings.has(id)) {
            next.add(id);
        }
    }
    return next;
}

export function applyBulkDecisionResult(args: {
    dryRun: boolean;
    usedSelectionIds: boolean;
    response: ImportReviewBulkDecisionResponse;
    selectedIds: Set<string>;
    setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
    onListRefresh: () => void;
}): { outcome: BulkDecisionApplyOutcome; message: string } {
    const { response, dryRun, usedSelectionIds } = args;

    if (dryRun) {
        const processed = response.updated_count + response.skipped_count;
        let message = `Preview: would update ${response.updated_count.toLocaleString()} of ${processed.toLocaleString()} (${response.skipped_count.toLocaleString()} skipped).`;
        const skipped = formatBulkSkippedReasons(response.skipped_reasons);
        if (skipped) {
            message = `${message} ${skipped}`;
        }
        return { outcome: "preview", message };
    }

    if (response.updated_count === 0) {
        let message =
            "No rows were updated. Check filters, candidate status, or duplicate force approval.";
        const skipped = formatBulkSkippedReasons(response.skipped_reasons);
        if (skipped) {
            message = `${message} ${skipped}`;
        }
        return { outcome: "no_update", message };
    }

    args.onListRefresh();

    if (usedSelectionIds) {
        args.setSelectedIds((prev) => removeUpdatedIdsFromSelection(prev, response.updated_ids));
    }

    let message = `Updated ${response.updated_count.toLocaleString()} candidate(s).`;
    const skipped = formatBulkSkippedReasons(response.skipped_reasons);
    if (skipped) {
        message = `${message} ${skipped}`;
    }
    return { outcome: "updated", message };
}

export function isBulkDuplicateApprovalError(err: unknown): boolean {
    if (!(err instanceof Error)) {
        return false;
    }
    const marker = "BULK_DUPLICATE_APPROVAL_REQUIRED";
    return err.message.includes(marker) || err.message.includes("Duplicate candidates require force approval");
}

export function formatBulkDuplicateApprovalError(err: unknown, fallback: string): string {
    if (isBulkDuplicateApprovalError(err)) {
        return "Duplicate candidates require force approval.";
    }
    return fallback;
}
