"use client";

import { useEffect, useState } from "react";

import { promotionFamilyFromApiFamily } from "@/src/features/import-review/utils/promotableFamilies";
import {
    getImportReviewPromotionEligibilityDetails,
    isAbortError,
    type ImportReviewBuildingListItem,
} from "@/src/lib/api";

import {
    SELECTED_PROMOTION_BLOCKING_BATCH_STATUSES,
    shouldLookupActivePublishBatch,
} from "./candidatePromotionUiState";

export type CandidateActivePublishBatch = {
    id: string;
    status: string | null;
};

export function useCandidateActivePublishBatch(args: {
    apiFamily: string;
    row: ImportReviewBuildingListItem;
    reviewBatchId: string | null;
}): { loading: boolean; activeBatch: CandidateActivePublishBatch | null } {
    const { apiFamily, row, reviewBatchId } = args;
    const [loading, setLoading] = useState(false);
    const [activeBatch, setActiveBatch] = useState<CandidateActivePublishBatch | null>(null);

    useEffect(() => {
        if (!shouldLookupActivePublishBatch(row) || !reviewBatchId?.trim()) {
            setLoading(false);
            setActiveBatch(null);
            return;
        }

        const controller = new AbortController();
        setLoading(true);
        setActiveBatch(null);

        void getImportReviewPromotionEligibilityDetails(
            {
                review_batch_id: reviewBatchId,
                family: promotionFamilyFromApiFamily(apiFamily),
                bucket: "batched",
                limit: 20,
                search: row.id,
            },
            { signal: controller.signal }
        )
            .then((res) => {
                const match = res.items.find((item) => String(item.id) === row.id);
                if (!match?.publish_batch_id) {
                    setActiveBatch(null);
                    return;
                }
                const status = (match.publish_batch_status ?? "").trim().toLowerCase();
                if (!SELECTED_PROMOTION_BLOCKING_BATCH_STATUSES.has(status)) {
                    setActiveBatch(null);
                    return;
                }
                setActiveBatch({
                    id: String(match.publish_batch_id),
                    status: match.publish_batch_status,
                });
            })
            .catch((err: unknown) => {
                if (!isAbortError(err)) {
                    setActiveBatch(null);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            });

        return () => controller.abort();
    }, [apiFamily, reviewBatchId, row.id, row.promotion_status, row.review_status, row.promoted_core_id]);

    return { loading, activeBatch };
}
