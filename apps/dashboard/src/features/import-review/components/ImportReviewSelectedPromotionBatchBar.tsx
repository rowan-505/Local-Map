"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { formatImportReviewPromotionError } from "@/src/features/import-review/promotion/formatPromotionError";
import {
    analyzeSelectedPromotionBatch,
    selectedPromotionBatchBlockedReason,
} from "@/src/features/import-review/promotion/selectedPromotionBatchAnalysis";
import {
    evaluatePublishBatchLimits,
    type PublishBatchLimitsConfirmationState,
} from "@/src/features/import-review/promotion/batchLimits";
import {
    isHighRiskPromotableFamily,
    promotionFamilyFromApiFamily,
} from "@/src/features/import-review/utils/promotableFamilies";
import {
    logCreatePublishBatchResponseDev,
    resolveCreatedPublishBatchId,
} from "@/src/features/import-review/utils/createPublishBatchResponse";
import { postImportReviewPromotionBatch, type ImportReviewBuildingListItem } from "@/src/lib/api";

const btnBase =
    "rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";

export default function ImportReviewSelectedPromotionBatchBar({
    apiFamily,
    items,
    selectedIds,
    reviewBatchId,
    canEdit,
    onClearSelection,
}: {
    apiFamily: string;
    items: ImportReviewBuildingListItem[];
    selectedIds: Set<string>;
    reviewBatchId: string | null;
    canEdit: boolean;
    onClearSelection: () => void;
}) {
    const router = useRouter();
    const [isCreating, setIsCreating] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [limitsConfirmation, setLimitsConfirmation] = useState<PublishBatchLimitsConfirmationState>(
        {
            confirmLargeBatch: false,
            allowHighRiskFamilies: false,
            mixedHighRiskConfirm: false,
        }
    );

    const promotionFamily = promotionFamilyFromApiFamily(apiFamily);
    const analysis = useMemo(
        () => analyzeSelectedPromotionBatch(items, selectedIds),
        [items, selectedIds]
    );
    const blockReason = selectedPromotionBatchBlockedReason(analysis);
    const limitsEvaluation = useMemo(
        () =>
            evaluatePublishBatchLimits({
                families: [promotionFamily],
                totalItems: analysis.selectedCount,
                confirmation: limitsConfirmation,
            }),
        [promotionFamily, analysis.selectedCount, limitsConfirmation]
    );

    const needsHighRisk = limitsEvaluation.needsHighRiskConfirm;
    const canCreate =
        canEdit &&
        Boolean(reviewBatchId?.trim()) &&
        blockReason === null &&
        limitsEvaluation.canProceed &&
        !isCreating;

    const handleCreateBatch = useCallback(async () => {
        if (!canCreate || !reviewBatchId?.trim()) {
            return;
        }
        setIsCreating(true);
        setErrorMessage(null);

        const candidateIds = analysis.selectedRows.map((r) => r.id);
        const requestPayload = {
            review_batch_id: reviewBatchId,
            mode: "selected" as const,
            families: [promotionFamily],
            candidate_ids_by_family: {
                [promotionFamily]: candidateIds,
            },
            filters: {
                review_decision: "approved" as const,
                include_warnings: false,
            },
            batch_name: `${apiFamily}-selected-${candidateIds.length}-${Date.now()}`,
            dry_run: false,
            allow_high_risk_families: isHighRiskPromotableFamily(apiFamily),
            confirm_large_batch: limitsConfirmation.confirmLargeBatch,
            mixed_high_risk_confirm: limitsConfirmation.mixedHighRiskConfirm,
        };

        try {
            const result = await postImportReviewPromotionBatch(requestPayload);
            if ("dry_run" in result && result.dry_run) {
                setErrorMessage("Unexpected dry-run response. Publish batch was not created.");
                return;
            }
            const batchId = resolveCreatedPublishBatchId(result);
            logCreatePublishBatchResponseDev(
                `createPublishBatch(selected ${apiFamily})`,
                requestPayload,
                result,
                batchId
            );
            if (!batchId) {
                setErrorMessage("Failed to create promotion batch.");
                return;
            }
            const href = `/dashboard/import-review/promotion/${encodeURIComponent(batchId)}?review_batch_id=${encodeURIComponent(reviewBatchId)}`;
            router.push(href);
        } catch (err: unknown) {
            logCreatePublishBatchResponseDev(
                "createPublishBatch(selected roads) failed",
                requestPayload,
                err,
                null
            );
            setErrorMessage(
                formatImportReviewPromotionError(err) ||
                    "Failed to create promotion batch for selected roads."
            );
        } finally {
            setIsCreating(false);
        }
    }, [
        analysis.selectedRows,
        apiFamily,
        canCreate,
        limitsConfirmation.confirmLargeBatch,
        limitsConfirmation.mixedHighRiskConfirm,
        promotionFamily,
        reviewBatchId,
        router,
    ]);

    if (selectedIds.size === 0) {
        return null;
    }

    return (
        <div
            className="sticky top-0 z-20 rounded-xl border border-indigo-200 bg-indigo-50/90 shadow-md backdrop-blur-sm"
            role="region"
            aria-label={`Create promotion batch from selected ${apiFamily}`}
        >
            <div className="flex flex-wrap items-end gap-3 p-4">
                <div className="min-w-[140px]">
                    <p className="text-sm font-semibold text-gray-900">
                        {selectedIds.size.toLocaleString()} selected for promotion
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                        Creates a publish batch with only these roads. Next: Validate → Road dry-run →
                        Promote on the batch page.
                    </p>
                    {analysis.batchedCount > 0 ? (
                        <p className="mt-1 text-xs text-amber-800">
                            {analysis.batchedCount} row(s) are already batched elsewhere — creation may
                            fail for those ids.
                        </p>
                    ) : null}
                </div>

                <div className="flex flex-1 flex-wrap items-center gap-3">
                    {needsHighRisk ? (
                        <label className="flex items-center gap-2 text-xs text-gray-800">
                            <input
                                type="checkbox"
                                checked={limitsConfirmation.allowHighRiskFamilies}
                                onChange={(e) =>
                                    setLimitsConfirmation((prev) => ({
                                        ...prev,
                                        allowHighRiskFamilies: e.target.checked,
                                    }))
                                }
                                disabled={!canEdit || isCreating}
                            />
                            I confirm road promotion (high-risk family)
                        </label>
                    ) : null}
                    {limitsEvaluation.needsLargeBatchConfirm ? (
                        <label className="flex items-center gap-2 text-xs text-gray-800">
                            <input
                                type="checkbox"
                                checked={limitsConfirmation.confirmLargeBatch}
                                onChange={(e) =>
                                    setLimitsConfirmation((prev) => ({
                                        ...prev,
                                        confirmLargeBatch: e.target.checked,
                                    }))
                                }
                                disabled={!canEdit || isCreating}
                            />
                            Confirm large batch ({analysis.selectedCount} items)
                        </label>
                    ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        className={`${btnBase} border border-gray-300 bg-white text-gray-800`}
                        onClick={onClearSelection}
                        disabled={isCreating}
                    >
                        Clear selection
                    </button>
                    <button
                        type="button"
                        className={`${btnBase} bg-indigo-600 text-white hover:bg-indigo-700`}
                        disabled={!canCreate}
                        onClick={() => void handleCreateBatch()}
                    >
                        {isCreating
                            ? "Creating batch…"
                            : `Create publish batch (${selectedIds.size})`}
                    </button>
                    {isCreating ? (
                        <ImportReviewInlineSpinner label="Creating promotion batch…" />
                    ) : null}
                </div>
            </div>

            {blockReason ? (
                <p className="border-t border-indigo-100 px-4 py-2 text-xs text-amber-950">{blockReason}</p>
            ) : null}
            {!blockReason && !limitsEvaluation.canProceed ? (
                <p className="border-t border-indigo-100 px-4 py-2 text-xs text-amber-950">
                    Confirm the checkboxes above before creating the batch.
                </p>
            ) : null}
            {errorMessage ? (
                <div className="border-t border-indigo-100 px-4 py-2">
                    <ImportReviewStatusBanner message={errorMessage} tone="error" compact />
                </div>
            ) : null}
        </div>
    );
}
