"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
    CollapsibleJson,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewHistoryUi";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import { publishEntityFamilyLabel } from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import {
    getImportReviewHistoryPublishBatchItems,
    isAbortError,
    type ImportReviewHistoryPublishBatchItem,
    type ImportReviewPromotionFailureSample,
} from "@/src/lib/api";

import { mergePromotionFailureRows } from "./formatPromotionFailure";
import { publishBatchFailedItemDetailRow, type PublishBatchFailedItemDetailRow } from "./publishBatchItemDetail";
import { buildPublishBatchFailedItemsQuery } from "./publishBatchItemsQuery";
import {
    shouldShowFailedItemsFetchError,
    shouldShowFailedItemsTable,
    shouldShowMissingStoredDetailsMessage,
    type PublishBatchFailedPanelFetchState,
} from "./publishBatchFailedPanelState";

type Props = {
    batchId: string;
    failedCount: number;
    sampleFailures?: readonly ImportReviewPromotionFailureSample[];
    /** When set, panel copy reflects validation-phase failures (not promotion). */
    failurePhase?: "validation" | "promotion";
};

export default function ImportReviewPromotionFailedItemsPanel({
    batchId,
    failedCount,
    sampleFailures = [],
    failurePhase = "promotion",
}: Props) {
    const failureVerb = failurePhase === "validation" ? "validation" : "promotion";
    const [open, setOpen] = useState(false);
    const [fetchState, setFetchState] = useState<PublishBatchFailedPanelFetchState>("idle");
    const [loadError, setLoadError] = useState<string | null>(null);
    const [historyItems, setHistoryItems] = useState<ImportReviewHistoryPublishBatchItem[]>([]);
    const previewRows = useMemo(
        () => mergePromotionFailureRows(sampleFailures, []),
        [sampleFailures]
    );

    const detailRows = useMemo(
        () => historyItems.map((item) => publishBatchFailedItemDetailRow(item)),
        [historyItems]
    );

    const loadFailures = useCallback(
        async (signal?: AbortSignal) => {
            setFetchState("loading");
            setLoadError(null);
            try {
                const res = await getImportReviewHistoryPublishBatchItems(
                    batchId,
                    buildPublishBatchFailedItemsQuery(),
                    signal ? { signal } : undefined
                );
                const failedItems = res.items.filter((item) => item.publish_status === "failed");
                setHistoryItems(failedItems);
                setFetchState("loaded");
            } catch (err) {
                if (!isAbortError(err)) {
                    setLoadError(err instanceof Error ? err.message : "Failed to load failed items.");
                    setFetchState("error");
                    setHistoryItems([]);
                }
            }
        },
        [batchId]
    );

    useEffect(() => {
        if (!open || failedCount <= 0) {
            return;
        }
        const controller = new AbortController();
        void loadFailures(controller.signal);
        return () => controller.abort();
    }, [open, failedCount, loadFailures]);

    const handleToggle = () => {
        setOpen((prev) => !prev);
    };

    if (failedCount <= 0) {
        return null;
    }

    const showPanelBody = open;
    const showTable = showPanelBody && shouldShowFailedItemsTable(fetchState, detailRows.length);
    const showMissingStoredDetails =
        showPanelBody &&
        shouldShowMissingStoredDetailsMessage(fetchState, detailRows.length, failedCount);
    const showLoading = showPanelBody && fetchState === "loading";
    const showFetchError = showPanelBody && shouldShowFailedItemsFetchError(fetchState, loadError);

    return (
        <div className="rounded-md border border-red-200 bg-red-50/80 p-3 text-sm text-red-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                    {failedCount.toLocaleString()} item{failedCount === 1 ? "" : "s"} failed during{" "}
                    {failureVerb}.
                    {!open && previewRows[0] ? (
                        <span className="mt-1 block text-xs text-red-800">
                            Example ({previewRows[0].error_code}): {previewRows[0].error_message}
                        </span>
                    ) : null}
                </p>
                <button
                    type="button"
                    className="shrink-0 rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-900 hover:bg-red-100"
                    onClick={handleToggle}
                    aria-expanded={open}
                >
                    {open ? "Hide failed item details" : "View failed item details"}
                </button>
            </div>

            {showPanelBody ? (
                <div className="mt-3 space-y-2">
                    {showLoading ? (
                        <ImportReviewInlineSpinner label="Loading failed items…" />
                    ) : null}
                    {showFetchError ? (
                        <p className="rounded border border-red-300 bg-white px-2 py-1.5 text-xs text-red-900">
                            {loadError}
                        </p>
                    ) : null}
                    {showTable ? (
                        <div className="overflow-x-auto rounded border border-red-200 bg-white">
                            <table className="min-w-full divide-y divide-red-100 text-left text-xs">
                                <thead className="bg-red-50/90 text-red-900">
                                    <tr>
                                        <th className="px-2 py-1.5 font-medium">Family</th>
                                        <th className="px-2 py-1.5 font-medium">Candidate</th>
                                        <th className="px-2 py-1.5 font-medium">Publish status</th>
                                        <th className="px-2 py-1.5 font-medium">Validation</th>
                                        <th className="px-2 py-1.5 font-medium">Error</th>
                                        <th className="px-2 py-1.5 font-medium">Detail</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 text-gray-800">
                                    {detailRows.map((row) => (
                                        <FailedItemRow key={row.publish_item_id} row={row} />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                    {showMissingStoredDetails ? (
                        <p className="text-xs text-red-800">
                            Failed items exist, but item-level error details were not stored.
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function FailedItemRow({ row }: { row: PublishBatchFailedItemDetailRow }) {
    return (
        <tr className="align-top">
            <td className="px-2 py-1.5">{publishEntityFamilyLabel(row.entity_family)}</td>
            <td className="px-2 py-1.5 font-mono tabular-nums">
                {row.review_candidate_id ?? "—"}
            </td>
            <td className="px-2 py-1.5 font-mono text-[11px]">{row.publish_status}</td>
            <td className="px-2 py-1.5 font-mono text-[11px]">
                {row.validation_status ?? "—"}
            </td>
            <td className="px-2 py-1.5 max-w-xs">
                <div className="font-mono text-[10px] uppercase tracking-wide text-red-700">
                    {row.error_code}
                </div>
                <div className="whitespace-pre-wrap break-words">{row.error_message}</div>
            </td>
            <td className="px-2 py-1.5 min-w-[8rem]">
                {row.error_detail_json != null ? (
                    <CollapsibleJson label="Result JSON" value={row.error_detail_json} />
                ) : (
                    <span className="text-gray-500">—</span>
                )}
            </td>
        </tr>
    );
}
