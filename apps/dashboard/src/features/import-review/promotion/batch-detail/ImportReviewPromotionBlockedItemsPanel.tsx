"use client";

import { useCallback, useEffect, useState } from "react";

import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import { PublishEntityFamilyLabel } from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import { buildPublishBatchBlockedItemsQuery } from "@/src/features/import-review/promotion/publishBatchItemsQuery";
import {
    PUBLISH_BATCH_NOT_BATCHED_LIFECYCLE_ERROR_CODE,
    PUBLISH_BATCH_NOT_BATCHED_LIFECYCLE_MESSAGE,
    publishBatchLifecycleErrorFromValidation,
    validationErrorCodeFromItem,
} from "@/src/features/import-review/promotion/publishBatchLifecycleErrors";
import {
    getImportReviewHistoryPublishBatchItems,
    isAbortError,
    type ImportReviewHistoryPublishBatchItem,
} from "@/src/lib/api";

type Props = {
    batchId: string;
    blockedCount: number;
};

function validationStatusFromItem(item: ImportReviewHistoryPublishBatchItem): string {
    const vr = item.validation_result;
    if (vr && typeof vr === "object" && !Array.isArray(vr)) {
        const s = (vr as Record<string, unknown>).status;
        if (typeof s === "string") {
            return s;
        }
    }
    return "blocked";
}

function errorMessageFromItem(item: ImportReviewHistoryPublishBatchItem): string {
    const vr = item.validation_result;
    const code = validationErrorCodeFromItem(vr);
    if (vr && typeof vr === "object" && !Array.isArray(vr)) {
        const errors = (vr as Record<string, unknown>).errors;
        if (Array.isArray(errors) && errors[0] && typeof errors[0] === "object") {
            const msg = (errors[0] as Record<string, unknown>).message;
            if (typeof msg === "string") {
                return (
                    publishBatchLifecycleErrorFromValidation(code, msg) ??
                    msg
                );
            }
        }
    }
    return (
        publishBatchLifecycleErrorFromValidation(code, item.error_message ?? "—") ??
        item.error_message ??
        "—"
    );
}

export function ImportReviewPromotionBlockedItemsPanel({ batchId, blockedCount }: Props) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [items, setItems] = useState<ImportReviewHistoryPublishBatchItem[]>([]);

    const load = useCallback(
        async (signal?: AbortSignal) => {
            setLoading(true);
            setError(null);
            try {
                const res = await getImportReviewHistoryPublishBatchItems(
                    batchId,
                    buildPublishBatchBlockedItemsQuery(),
                    signal ? { signal } : undefined
                );
                setItems(res.items);
            } catch (err) {
                if (!isAbortError(err)) {
                    setError(err instanceof Error ? err.message : "Failed to load blocked items.");
                    setItems([]);
                }
            } finally {
                setLoading(false);
            }
        },
        [batchId]
    );

    useEffect(() => {
        if (!open || blockedCount <= 0) {
            return;
        }
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [open, blockedCount, load]);

    const hasNotBatchedLifecycleError = items.some(
        (item) =>
            validationErrorCodeFromItem(item.validation_result) ===
            PUBLISH_BATCH_NOT_BATCHED_LIFECYCLE_ERROR_CODE
    );

    if (blockedCount <= 0) {
        return null;
    }

    return (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
            {hasNotBatchedLifecycleError ? (
                <p className="mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-950">
                    {PUBLISH_BATCH_NOT_BATCHED_LIFECYCLE_MESSAGE}
                </p>
            ) : null}
            <p className="text-sm text-amber-950">
                Blocked items will remain in import-review ({blockedCount.toLocaleString()} blocked).
            </p>
            <details
                className="mt-3"
                open={open}
                onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
            >
                <summary className="cursor-pointer text-sm font-medium text-amber-950">
                    Blocked item details
                </summary>
                {loading ? (
                    <div className="mt-3">
                        <ImportReviewInlineSpinner label="Loading blocked items…" />
                    </div>
                ) : null}
                {error ? <p className="mt-2 text-xs text-red-800">{error}</p> : null}
                {!loading && items.length > 0 ? (
                    <div className="mt-3 overflow-x-auto rounded-md border border-amber-200 bg-white">
                        <table className="min-w-full text-left text-xs text-gray-700">
                            <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
                                <tr>
                                    <th className="px-3 py-2 font-medium">Family</th>
                                    <th className="px-3 py-2 font-medium">Candidate</th>
                                    <th className="px-3 py-2 font-medium">External ID</th>
                                    <th className="px-3 py-2 font-medium">Validation</th>
                                    <th className="px-3 py-2 font-medium">Message</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item) => (
                                    <tr key={item.id} className="border-b border-gray-100">
                                        <td className="px-3 py-2">
                                            <PublishEntityFamilyLabel family={item.entity_family} />
                                        </td>
                                        <td className="px-3 py-2 font-mono">
                                            {item.review_candidate_id ?? item.id}
                                        </td>
                                        <td className="px-3 py-2 font-mono">{item.external_id ?? "—"}</td>
                                        <td className="px-3 py-2">{validationStatusFromItem(item)}</td>
                                        <td className="px-3 py-2">{errorMessageFromItem(item)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : null}
                {!loading && open && items.length === 0 && !error ? (
                    <p className="mt-2 text-xs text-gray-600">
                        No blocked rows returned. Counts may reflect validation summary only.
                    </p>
                ) : null}
            </details>
        </section>
    );
}
