"use client";

import ImportReviewStatusBanner from "@/src/features/import-review/components/ImportReviewStatusBanner";
import {
    IMPORT_REVIEW_PROMOTION_FIRST_TEST_RECOMMENDATIONS,
    type PublishBatchLimitsConfirmationState,
    type PublishBatchLimitsEvaluation,
} from "@/src/features/import-review/promotion/batchLimits";

type Props = {
    evaluation: PublishBatchLimitsEvaluation;
    confirmation: PublishBatchLimitsConfirmationState;
    onConfirmationChange: (next: PublishBatchLimitsConfirmationState) => void;
    actionLabel?: string;
};

export default function ImportReviewPromotionBatchLimitsConfirm({
    evaluation,
    confirmation,
    onConfirmationChange,
    actionLabel = "Create or validate this batch",
}: Props) {
    const { totalItems, maxItems } = evaluation;

    return (
        <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <div>
                <p className="text-sm font-medium text-gray-900">
                    Batch size:{" "}
                    <span className="tabular-nums">{totalItems.toLocaleString()}</span> item
                    {totalItems === 1 ? "" : "s"}
                </p>
                {evaluation.needsLargeBatchConfirm ? (
                    <p className="mt-1 text-sm text-amber-900">
                        Exceeds the default limit of {maxItems.toLocaleString()} items. Confirm below to
                        proceed.
                    </p>
                ) : (
                    <p className="mt-1 text-xs text-gray-600">
                        Within the default limit ({maxItems.toLocaleString()} items).
                    </p>
                )}
            </div>

            <div className="text-xs text-gray-600">
                <p className="font-medium text-gray-800">Recommended first tests</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {IMPORT_REVIEW_PROMOTION_FIRST_TEST_RECOMMENDATIONS.map((line) => (
                        <li key={line}>{line}</li>
                    ))}
                </ul>
            </div>

            {evaluation.needsLargeBatchConfirm ? (
                <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={confirmation.confirmLargeBatch}
                        onChange={(e) =>
                            onConfirmationChange({
                                ...confirmation,
                                confirmLargeBatch: e.target.checked,
                            })
                        }
                    />
                    <span>
                        I confirm this batch has more than {maxItems.toLocaleString()} items (
                        <code className="text-xs">confirm_large_batch</code>).
                    </span>
                </label>
            ) : null}

            {evaluation.needsHighRiskConfirm ? (
                <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={confirmation.allowHighRiskFamilies}
                        onChange={(e) =>
                            onConfirmationChange({
                                ...confirmation,
                                allowHighRiskFamilies: e.target.checked,
                            })
                        }
                    />
                    <span>
                        This batch includes high-risk families (
                        {evaluation.highRiskFamiliesPresent.join(", ")}). I confirm (
                        <code className="text-xs">allow_high_risk_families</code>).
                    </span>
                </label>
            ) : null}

            {evaluation.needsMixedHighRiskConfirm ? (
                <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={confirmation.mixedHighRiskConfirm}
                        onChange={(e) =>
                            onConfirmationChange({
                                ...confirmation,
                                mixedHighRiskConfirm: e.target.checked,
                            })
                        }
                    />
                    <span>
                        Roads are mixed with other simple families. Prefer a roads-only batch for early
                        tests. I confirm (
                        <code className="text-xs">mixed_high_risk_confirm</code>).
                    </span>
                </label>
            ) : null}

            {!evaluation.canProceed ? (
                <ImportReviewStatusBanner
                    message={`Check all required confirmations before you ${actionLabel.toLowerCase()}.`}
                    tone="warning"
                    compact
                />
            ) : null}
        </div>
    );
}
