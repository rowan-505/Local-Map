"use client";

import ImportReviewPromotionEligibilityCountCell from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewPromotionEligibilityCountCell";
import ImportReviewSkeletonTable from "@/src/features/import-review/components/ImportReviewSkeletonTable";
import { IMPORT_REVIEW_LOADING } from "@/src/features/import-review/utils/loadingMessages";
import type {
    ImportReviewPromotionEligibilityBucket,
    ImportReviewPromotionEligibilityResponse,
} from "@/src/lib/api";

export type PromotionEligibilityTableRow = {
    family: string;
    label: string;
    target: string;
    ready: number;
    warnings: number;
    blocked: number;
    batched: number;
    promoted: number;
};

type ImportReviewPromotionEligibilityPanelProps = {
    reviewBatchId: string;
    selectedFamilyCount: number;
    isLoading: boolean;
    errorMessage: string;
    eligibility: ImportReviewPromotionEligibilityResponse | null;
    rows: PromotionEligibilityTableRow[];
    onRetry: () => void;
    onOpenDetails: (
        family: string,
        label: string,
        bucket: ImportReviewPromotionEligibilityBucket
    ) => void;
};

export default function ImportReviewPromotionEligibilityPanel({
    reviewBatchId,
    selectedFamilyCount,
    isLoading,
    errorMessage,
    eligibility,
    rows,
    onRetry,
    onOpenDetails,
}: ImportReviewPromotionEligibilityPanelProps) {
    const panelMinHeight = "min-h-[14rem]";

    if (!reviewBatchId.trim()) {
        return (
            <p className={`mt-4 text-sm text-gray-600 ${panelMinHeight}`}>
                Select a review batch to see eligibility counts.
            </p>
        );
    }

    if (selectedFamilyCount === 0) {
        return (
            <p className={`mt-4 text-sm text-gray-600 ${panelMinHeight}`}>
                Select at least one entity family to see eligibility counts.
            </p>
        );
    }

    if (isLoading) {
        return (
            <div className={`mt-4 ${panelMinHeight}`}>
                <ImportReviewSkeletonTable
                    columnCount={7}
                    rowCount={5}
                    message={IMPORT_REVIEW_LOADING.loadingEligibility}
                />
            </div>
        );
    }

    if (errorMessage) {
        return (
            <div
                className={`mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-950 ${panelMinHeight}`}
                role="alert"
            >
                <p className="font-semibold">{IMPORT_REVIEW_LOADING.failedToLoadEligibility}</p>
                <p className="mt-1 text-red-900">{errorMessage}</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-50"
                >
                    Retry
                </button>
            </div>
        );
    }

    if (!eligibility || rows.length === 0) {
        return (
            <p className={`mt-4 text-sm text-gray-600 ${panelMinHeight}`}>
                No eligibility data found for the selected families in review batch #{reviewBatchId}.
            </p>
        );
    }

    return (
        <div className={`mt-4 space-y-3 ${panelMinHeight}`}>
            <div className="overflow-x-auto rounded-md border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                            <th className="px-4 py-3">Family</th>
                            <th className="px-4 py-3">Target</th>
                            <th className="px-4 py-3 text-right">Ready</th>
                            <th className="px-4 py-3 text-right">Warnings</th>
                            <th className="px-4 py-3 text-right">Blocked</th>
                            <th className="px-4 py-3 text-right">Batched</th>
                            <th className="px-4 py-3 text-right">Promoted</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {rows.map((row) => (
                            <tr key={row.family}>
                                <td className="px-4 py-3 font-medium text-gray-900">{row.label}</td>
                                <td className="px-4 py-3 font-mono text-xs text-gray-600">{row.target}</td>
                                <td className="px-4 py-3 text-right">
                                    <ImportReviewPromotionEligibilityCountCell
                                        count={row.ready}
                                        onOpen={
                                            row.ready > 0
                                                ? () => onOpenDetails(row.family, row.label, "ready")
                                                : undefined
                                        }
                                    />
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <ImportReviewPromotionEligibilityCountCell
                                        count={row.warnings}
                                        onOpen={
                                            row.warnings > 0
                                                ? () => onOpenDetails(row.family, row.label, "warnings")
                                                : undefined
                                        }
                                    />
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <ImportReviewPromotionEligibilityCountCell
                                        count={row.blocked}
                                        onOpen={
                                            row.blocked > 0
                                                ? () => onOpenDetails(row.family, row.label, "blocked")
                                                : undefined
                                        }
                                    />
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <ImportReviewPromotionEligibilityCountCell
                                        count={row.batched}
                                        onOpen={
                                            row.batched > 0
                                                ? () => onOpenDetails(row.family, row.label, "batched")
                                                : undefined
                                        }
                                    />
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <ImportReviewPromotionEligibilityCountCell
                                        count={row.promoted}
                                        onOpen={
                                            row.promoted > 0
                                                ? () => onOpenDetails(row.family, row.label, "promoted")
                                                : undefined
                                        }
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-gray-50 text-sm font-medium text-gray-900">
                        <tr>
                            <td className="px-4 py-3" colSpan={2}>
                                Totals
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">{eligibility.totals.ready}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{eligibility.totals.warnings}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{eligibility.totals.blocked}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{eligibility.totals.batched}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{eligibility.totals.promoted}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            {!eligibility.can_create_batch && eligibility.messages.length > 0 ? (
                <ul className="list-inside list-disc text-sm text-amber-900">
                    {eligibility.messages.map((msg) => (
                        <li key={msg}>{msg}</li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
