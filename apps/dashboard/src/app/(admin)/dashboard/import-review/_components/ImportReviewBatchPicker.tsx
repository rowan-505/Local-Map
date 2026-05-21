"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { ImportReviewBatchChoice } from "@/src/lib/api";
import { applyImportReviewScopeSearchParams } from "@/src/lib/importReviewSnapshot";

function formatUploadedAt(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function ImportReviewBatchPicker({
    sourceSnapshotVersion,
    batches,
    onUseLatest,
}: {
    sourceSnapshotVersion: string;
    batches: ImportReviewBatchChoice[];
    /** When set, shows a power-user shortcut to retry with `latest=true`. */
    onUseLatest?: () => void;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    function selectBatch(batchId: string) {
        const params = new URLSearchParams(searchParams.toString());
        applyImportReviewScopeSearchParams(params, "", batchId);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }

    return (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="font-semibold">Multiple review batches match this snapshot</div>
            <p className="mt-1 text-amber-900">
                Snapshot{" "}
                <code className="rounded bg-amber-100/80 px-1 font-mono text-xs">{sourceSnapshotVersion}</code>{" "}
                has {batches.length} active batches. Select one to continue.
            </p>
            <div className="mt-4 overflow-x-auto rounded-md border border-amber-200 bg-white">
                <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                            <th className="px-3 py-2 font-medium">ID</th>
                            <th className="px-3 py-2 font-medium">Batch name</th>
                            <th className="px-3 py-2 font-medium">Families</th>
                            <th className="px-3 py-2 font-medium">Candidates</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 font-medium">Uploaded</th>
                            <th className="px-3 py-2 font-medium">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {batches.map((b) => (
                            <tr key={b.id} className="text-gray-900">
                                <td className="px-3 py-2 font-mono">{b.id}</td>
                                <td className="px-3 py-2">{b.batch_name}</td>
                                <td className="px-3 py-2 text-gray-700">{b.entity_families.join(", ") || "—"}</td>
                                <td className="px-3 py-2 tabular-nums">{b.total_candidate_count.toLocaleString()}</td>
                                <td className="px-3 py-2">{b.status}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                                    {formatUploadedAt(b.uploaded_at)}
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
