"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { replaceImportReviewSearchParams } from "@/src/features/import-review/navigation/replaceImportReviewSearchParams";
import { logImportReviewUserAction } from "@/src/features/import-review/utils/importReviewRequestDebug";
import type { ImportReviewBatchChoice } from "@/src/lib/api";
import { applyImportReviewScopeSearchParams } from "@/src/lib/importReviewSnapshot";

function formatTimestamp(iso: string | undefined): string {
    if (!iso) {
        return "—";
    }
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function ImportReviewBatchPicker({
    sourceSnapshotVersion,
    batches,
    onSelectBatch,
    onUseLatest,
}: {
    sourceSnapshotVersion: string;
    batches: ImportReviewBatchChoice[];
    /** When set, called instead of updating the URL directly (overview page reloads summary). */
    onSelectBatch?: (batchId: string) => void;
    /** When set, shows a power-user shortcut to retry with `latest=true`. */
    onUseLatest?: () => void;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    function selectBatch(batchId: string) {
        if (onSelectBatch) {
            onSelectBatch(batchId);
            return;
        }
        logImportReviewUserAction({
            action: "select_batch",
            source: "ImportReviewBatchPicker:select_batch",
        });
        replaceImportReviewSearchParams(
            router,
            pathname ?? "",
            searchParams,
            (params) => {
                applyImportReviewScopeSearchParams(params, "", batchId);
            },
            { source: "ImportReviewBatchPicker:select_batch" }
        );
    }

    return (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="font-semibold">Multiple review batches found. Choose one batch to continue.</div>
            <p className="mt-1 text-amber-900">
                Snapshot{" "}
                <code className="rounded bg-amber-100/80 px-1 font-mono text-xs">{sourceSnapshotVersion}</code>{" "}
                has {batches.length} active batches.
            </p>
            <div className="mt-4 overflow-x-auto rounded-md border border-amber-200 bg-white">
                <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                            <th className="px-3 py-2 font-medium">ID</th>
                            <th className="px-3 py-2 font-medium">Batch name</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 font-medium">Created</th>
                            <th className="px-3 py-2 font-medium">Updated</th>
                            <th className="px-3 py-2 font-medium">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {batches.map((b) => (
                            <tr key={b.id} className="text-gray-900">
                                <td className="px-3 py-2 font-mono">{b.id}</td>
                                <td className="px-3 py-2">{b.batch_name}</td>
                                <td className="px-3 py-2">{b.status}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                                    {formatTimestamp(b.created_at ?? b.uploaded_at)}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                                    {formatTimestamp(b.updated_at ?? b.uploaded_at)}
                                </td>
                                <td className="px-3 py-2">
                                    <button
                                        type="button"
                                        onClick={() => selectBatch(b.id)}
                                        className="rounded-md border border-gray-900 bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800"
                                    >
                                        Select batch
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {onUseLatest ? (
                <div className="mt-3">
                    <button
                        type="button"
                        onClick={onUseLatest}
                        className="text-xs font-medium text-amber-900 underline hover:text-amber-950"
                    >
                        Use latest upload instead
                    </button>
                </div>
            ) : null}
        </div>
    );
}
