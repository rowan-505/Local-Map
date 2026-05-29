"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { ImportTransportBatchListItem } from "@/src/features/import-transport/config/types";
import { applyImportTransportScopeSearchParams } from "@/src/features/import-transport/utils/importTransportScope";

function formatTimestamp(iso: string | undefined | null): string {
    if (!iso) {
        return "—";
    }
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function ImportTransportBatchPicker({
    sourceSnapshotVersion,
    batches,
    onSelectBatch,
    onUseLatest,
}: {
    sourceSnapshotVersion: string;
    batches: ImportTransportBatchListItem[];
    onSelectBatch?: (batchId: string) => void;
    onUseLatest?: () => void;
}) {
    const router = useRouter();
    const pathname = usePathname() ?? "";
    const searchParams = useSearchParams();

    function selectBatch(batchId: string) {
        if (onSelectBatch) {
            onSelectBatch(batchId);
            return;
        }
        const next = applyImportTransportScopeSearchParams(new URLSearchParams(searchParams.toString()), {
            snapshotInput: "",
            batchInput: batchId,
        });
        router.replace(`${pathname}?${next.toString()}`);
    }

    return (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="font-semibold">Multiple import batches found. Choose one batch to continue.</div>
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
                            <th className="px-3 py-2 font-medium">Import status</th>
                            <th className="px-3 py-2 font-medium">Validation</th>
                            <th className="px-3 py-2 font-medium">Created</th>
                            <th className="px-3 py-2 font-medium">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {batches.map((b) => (
                            <tr key={b.id} className="text-gray-900">
                                <td className="px-3 py-2 font-mono">{b.id}</td>
                                <td className="px-3 py-2">{b.batch_name}</td>
                                <td className="px-3 py-2">{b.import_status}</td>
                                <td className="px-3 py-2">{b.validation_status}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                                    {formatTimestamp(b.created_at)}
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
                        Use latest import batch instead
                    </button>
                </div>
            ) : null}
        </div>
    );
}
