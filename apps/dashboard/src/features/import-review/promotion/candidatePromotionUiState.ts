import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import { candidateCoreReviewHref } from "./candidateCoreReviewHref";

export const SELECTED_PROMOTION_BLOCKING_BATCH_STATUSES = new Set([
    "draft",
    "validating",
    "promoting",
]);

export type CandidatePromotionUiState =
    | {
          kind: "already_promoted";
          promotedCoreId: string | null;
          promotedAt: string | null;
          coreReviewHref: string | null;
      }
    | {
          kind: "not_approved";
          reviewDecision: string;
      }
    | {
          kind: "active_publish_batch";
          publishBatchId: string;
          publishBatchStatus: string | null;
      }
    | {
          kind: "retry_failed";
      }
    | {
          kind: "ready";
          buttonLabel: "Promote this candidate";
      }
    | {
          kind: "unavailable";
          reason: string;
      };

function norm(value: string | null | undefined): string {
    return (value ?? "").trim().toLowerCase();
}

export function isCandidateAlreadyPromoted(row: ImportReviewBuildingListItem): boolean {
    if (norm(row.promotion_status) === "promoted") {
        return true;
    }
    return Boolean(row.promoted_core_id?.trim());
}

export function isCandidateFailedPromotionRetry(row: ImportReviewBuildingListItem): boolean {
    if (isCandidateAlreadyPromoted(row)) {
        return false;
    }
    const promotionStatus = norm(row.promotion_status);
    const reviewStatus = norm(row.review_status);
    return promotionStatus === "failed" || reviewStatus === "promotion_failed";
}

export function isCandidateReviewApproved(row: ImportReviewBuildingListItem): boolean {
    return norm(row.review_decision) === "approved";
}

export function shouldLookupActivePublishBatch(row: ImportReviewBuildingListItem): boolean {
    if (isCandidateAlreadyPromoted(row) || isCandidateFailedPromotionRetry(row)) {
        return false;
    }
    return norm(row.promotion_status) === "batched";
}

export function resolveCandidatePromotionUiState(args: {
    apiFamily: string;
    row: ImportReviewBuildingListItem;
    reviewBatchId: string | null;
    canEdit: boolean;
    promotable: boolean;
    activePublishBatch?: { id: string; status: string | null } | null;
    activePublishBatchLoading?: boolean;
}): CandidatePromotionUiState {
    const {
        apiFamily,
        row,
        reviewBatchId,
        canEdit,
        promotable,
        activePublishBatch,
        activePublishBatchLoading,
    } = args;

    if (!promotable) {
        return {
            kind: "unavailable",
            reason: "This entity family cannot be promoted from import review.",
        };
    }

    if (!reviewBatchId?.trim()) {
        return {
            kind: "unavailable",
            reason: "Open this list with a review batch selected to promote a candidate.",
        };
    }

    if (!canEdit) {
        return {
            kind: "unavailable",
            reason: "You do not have permission to create promotion batches.",
        };
    }

    if (isCandidateAlreadyPromoted(row)) {
        const promotedCoreId = row.promoted_core_id?.trim() || null;
        return {
            kind: "already_promoted",
            promotedCoreId,
            promotedAt: row.promoted_at?.trim() || null,
            coreReviewHref: candidateCoreReviewHref(apiFamily, promotedCoreId),
        };
    }

    if (!isCandidateReviewApproved(row)) {
        return {
            kind: "not_approved",
            reviewDecision: (row.review_decision ?? "").trim() || "(empty)",
        };
    }

    if (activePublishBatchLoading) {
        return {
            kind: "unavailable",
            reason: "Checking publish batch status…",
        };
    }

    if (activePublishBatch?.id) {
        const status = (activePublishBatch.status ?? "").trim().toLowerCase();
        if (SELECTED_PROMOTION_BLOCKING_BATCH_STATUSES.has(status)) {
            return {
                kind: "active_publish_batch",
                publishBatchId: activePublishBatch.id,
                publishBatchStatus: activePublishBatch.status,
            };
        }
    }

    if (isCandidateFailedPromotionRetry(row)) {
        return { kind: "retry_failed" };
    }

    if (shouldLookupActivePublishBatch(row) && !activePublishBatch) {
        return {
            kind: "ready",
            buttonLabel: "Promote this candidate",
        };
    }

    return {
        kind: "ready",
        buttonLabel: "Promote this candidate",
    };
}

export function promotionButtonLabel(state: CandidatePromotionUiState): string {
    switch (state.kind) {
        case "retry_failed":
            return "Create new promotion batch";
        case "ready":
            return state.buttonLabel;
        case "already_promoted":
            return "Already promoted";
        case "not_approved":
            return "Promote this candidate";
        case "active_publish_batch":
            return "In active publish batch";
        case "unavailable":
            return "Promote this candidate";
    }
}

export function isPromotionActionDisabled(state: CandidatePromotionUiState): boolean {
    return (
        state.kind === "already_promoted" ||
        state.kind === "not_approved" ||
        state.kind === "active_publish_batch" ||
        state.kind === "unavailable"
    );
}
