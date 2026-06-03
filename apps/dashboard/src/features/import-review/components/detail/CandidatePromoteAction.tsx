"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import { formatImportReviewPromotionError } from "@/src/features/import-review/promotion/formatPromotionError";
import {
    isPromotionActionDisabled,
    promotionButtonLabel,
    resolveCandidatePromotionUiState,
} from "@/src/features/import-review/promotion/candidatePromotionUiState";
import { useCandidateActivePublishBatch } from "@/src/features/import-review/promotion/useCandidateActivePublishBatch";
import {
    logCreatePublishBatchResponseDev,
    resolveCreatedPublishBatchId,
} from "@/src/features/import-review/utils/createPublishBatchResponse";
import {
    isHighRiskPromotableFamily,
    isImportReviewPromotableApiFamily,
    promotionFamilyFromApiFamily,
} from "@/src/features/import-review/utils/promotableFamilies";
import {
    postImportReviewPromotionBatch,
    type ImportReviewBuildingListItem,
} from "@/src/lib/api";
import { importReviewPath } from "@/src/lib/dashboardNavigation";

export default function CandidatePromoteAction({
    apiFamily,
    row,
    reviewBatchId,
    canEdit,
}: {
    apiFamily: string;
    row: ImportReviewBuildingListItem;
    reviewBatchId: string | null;
    canEdit: boolean;
}) {
    const router = useRouter();
    const [isCreating, setIsCreating] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const promotionFamily = promotionFamilyFromApiFamily(apiFamily);
    const promotable = isImportReviewPromotableApiFamily(apiFamily);
    const { loading: activeBatchLoading, activeBatch } = useCandidateActivePublishBatch({
        apiFamily,
        row,
        reviewBatchId,
    });

    const uiState = useMemo(
        () =>
            resolveCandidatePromotionUiState({
                apiFamily,
                row,
                reviewBatchId,
                canEdit,
                promotable,
                activePublishBatch: activeBatch,
                activePublishBatchLoading: activeBatchLoading,
            }),
        [apiFamily, row, reviewBatchId, canEdit, promotable, activeBatch, activeBatchLoading]
    );

    const disabled = isPromotionActionDisabled(uiState) || isCreating;
    const buttonLabel = promotionButtonLabel(uiState);

    const promotionBatchHref =
        uiState.kind === "active_publish_batch" && reviewBatchId?.trim()
            ? `${importReviewPath("promotion")}/${encodeURIComponent(uiState.publishBatchId)}?review_batch_id=${encodeURIComponent(reviewBatchId)}`
            : null;

    const handlePromote = useCallback(async () => {
        if (
            disabled ||
            !reviewBatchId?.trim() ||
            (uiState.kind !== "ready" && uiState.kind !== "retry_failed")
        ) {
            return;
        }
        setIsCreating(true);
        setErrorMessage(null);

        const requestPayload = {
            review_batch_id: reviewBatchId,
            mode: "selected" as const,
            families: [promotionFamily],
            candidate_ids_by_family: {
                [promotionFamily]: [row.id],
            },
            filters: {
                review_decision: "approved" as const,
                include_warnings: false,
            },
            dry_run: false,
            allow_high_risk_families: isHighRiskPromotableFamily(apiFamily),
            confirm_large_batch: false,
            mixed_high_risk_confirm: false,
        };

        try {
            const result = await postImportReviewPromotionBatch(requestPayload);
            if ("dry_run" in result && result.dry_run) {
                setErrorMessage("Unexpected dry-run response. Promotion batch was not created.");
                return;
            }

            const batchId = resolveCreatedPublishBatchId(result);
            logCreatePublishBatchResponseDev(
                "createPublishBatch(selected candidate)",
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
                "createPublishBatch(selected candidate) failed",
                requestPayload,
                err,
                null
            );
            setErrorMessage(
                formatImportReviewPromotionError(err) ||
                    "Failed to create promotion batch for this candidate."
            );
        } finally {
            setIsCreating(false);
        }
    }, [apiFamily, disabled, promotionFamily, reviewBatchId, row.id, router, uiState]);

    if (!promotable) {
        return null;
    }

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Promotion</h3>

            {uiState.kind === "already_promoted" ? (
                <div className="mt-3 space-y-2">
                    <ImportReviewStatusBanner message="Already promoted" tone="success" compact />
                    {uiState.promotedCoreId ? (
                        <p className="text-sm text-gray-700">
                            Core id: <span className="font-mono">{uiState.promotedCoreId}</span>
                        </p>
                    ) : null}
                    {uiState.promotedAt ? (
                        <p className="text-sm text-gray-700">
                            Promoted at: <span className="font-mono text-xs">{uiState.promotedAt}</span>
                        </p>
                    ) : null}
                    {uiState.coreReviewHref ? (
                        <p className="text-sm">
                            <Link
                                href={uiState.coreReviewHref}
                                prefetch={false}
                                className="font-medium text-emerald-800 hover:underline"
                            >
                                View in core review
                            </Link>
                        </p>
                    ) : null}
                </div>
            ) : null}

            {uiState.kind === "not_approved" ? (
                <div className="mt-3">
                    <ImportReviewStatusBanner
                        message="Approve this candidate before promotion."
                        tone="warning"
                        compact
                    />
                    <p className="mt-2 text-xs text-gray-500">
                        Current review_decision: {uiState.reviewDecision}
                    </p>
                </div>
            ) : null}

            {uiState.kind === "active_publish_batch" ? (
                <div className="mt-3 space-y-2">
                    <ImportReviewStatusBanner
                        message="This candidate is already in an active publish batch."
                        tone="warning"
                        compact
                    />
                    {promotionBatchHref ? (
                        <p className="text-sm">
                            <Link
                                href={promotionBatchHref}
                                prefetch={false}
                                className="font-medium text-indigo-700 hover:underline"
                            >
                                Open publish batch #{uiState.publishBatchId}
                                {uiState.publishBatchStatus
                                    ? ` (${uiState.publishBatchStatus})`
                                    : ""}
                            </Link>
                        </p>
                    ) : null}
                </div>
            ) : null}

            {uiState.kind === "retry_failed" ? (
                <p className="mt-2 text-sm text-gray-600">
                    A previous publish attempt failed without writing to core. You can create a new
                    promotion batch and try again.
                </p>
            ) : uiState.kind === "ready" ? (
                <p className="mt-1 text-sm text-gray-600">
                    Create a publish batch with only this candidate, then validate and promote from the
                    batch page. Core data is not written until you run promote.
                </p>
            ) : uiState.kind === "unavailable" ? (
                <p className="mt-2 text-xs text-gray-500">{uiState.reason}</p>
            ) : null}

            {errorMessage ? (
                <div className="mt-3">
                    <ImportReviewStatusBanner message={errorMessage} tone="error" compact />
                </div>
            ) : null}

            {uiState.kind === "ready" || uiState.kind === "retry_failed" ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void handlePromote()}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isCreating ? "Creating batch…" : buttonLabel}
                    </button>
                    {isCreating ? (
                        <ImportReviewInlineSpinner label="Creating promotion batch…" />
                    ) : null}
                </div>
            ) : (
                <div className="mt-3">
                    <button
                        type="button"
                        disabled
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white opacity-50"
                    >
                        {buttonLabel}
                    </button>
                </div>
            )}
        </section>
    );
}
