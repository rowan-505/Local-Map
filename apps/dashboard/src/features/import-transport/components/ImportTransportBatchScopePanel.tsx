"use client";

import { useMemo, useState } from "react";

import ImportTransportBatchPicker from "@/src/app/(admin)/dashboard/import-transport/_components/ImportTransportBatchPicker";
import { Card, CardContent } from "@/src/components/ui/card";

import { useImportTransportBatchContext } from "../hooks/useImportTransportBatchContext";
import { useImportTransportBatches } from "../hooks/useImportTransportOverview";
import { IMPORT_TRANSPORT_LOADING } from "../utils/loadingMessages";

import ImportTransportEmptyState from "./ImportTransportEmptyState";
import ImportTransportErrorState from "./ImportTransportErrorState";
import { ImportTransportLoadingBannerWithSpinner } from "./ImportTransportLoadingState";
import ImportTransportStatusBadge from "./ImportTransportStatusBadge";

function formatBatchDate(iso: string | null | undefined): string {
    if (!iso) {
        return "—";
    }
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

export default function ImportTransportBatchScopePanel({
    disabled = false,
    className = "",
}: {
    disabled?: boolean;
    className?: string;
}) {
    const batchContext = useImportTransportBatchContext();
    const [changeOpen, setChangeOpen] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [batchDraft, setBatchDraft] = useState("");
    const [snapshotDraft, setSnapshotDraft] = useState("");

    const batchesQuery = useImportTransportBatches({ limit: 100, offset: 0 }, changeOpen);

    const displayDate = useMemo(() => {
        const batch = batchContext.currentBatch;
        if (!batch) {
            return "—";
        }
        return formatBatchDate(batch.imported_at || batch.created_at);
    }, [batchContext.currentBatch]);

    if (batchContext.status === "loading") {
        return (
            <div className={className}>
                <ImportTransportLoadingBannerWithSpinner
                    message={IMPORT_TRANSPORT_LOADING.loadingBatchContext}
                />
            </div>
        );
    }

    if (batchContext.status === "no_batches") {
        return (
            <div className={className}>
                <ImportTransportEmptyState
                    title="No import transport batch found"
                    description="Import transport data first."
                />
            </div>
        );
    }

    if (batchContext.status === "multiple_batches" && batchContext.ambiguousBatches) {
        return (
            <div className={className}>
                <ImportTransportBatchPicker
                    sourceSnapshotVersion={batchContext.ambiguousSnapshot}
                    batches={batchContext.ambiguousBatches}
                    onSelectBatch={batchContext.selectBatch}
                    onUseLatest={batchContext.selectLatestForSnapshot}
                />
            </div>
        );
    }

    return (
        <div className={`space-y-3 ${className}`.trim()}>
            <ImportTransportErrorState message={batchContext.error} compact />

            {batchContext.currentBatch ? (
                <Card className="border-gray-200 shadow-sm">
                    <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
                        <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-sm font-semibold text-gray-900">
                                    #{batchContext.currentBatch.id}
                                </span>
                                <span className="text-sm font-medium text-gray-900">
                                    {batchContext.currentBatch.batch_name}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <ImportTransportStatusBadge
                                    value={batchContext.currentBatch.import_status}
                                />
                                <ImportTransportStatusBadge
                                    value={batchContext.currentBatch.validation_status}
                                />
                            </div>
                            <p className="text-xs text-gray-500">
                                Imported {displayDate}
                                {batchContext.currentBatch.source_snapshot_version ? (
                                    <>
                                        {" "}
                                        · snapshot{" "}
                                        <span className="font-mono">
                                            {batchContext.currentBatch.source_snapshot_version}
                                        </span>
                                    </>
                                ) : null}
                            </p>
                        </div>
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                                setBatchDraft(batchContext.importBatchId ?? "");
                                setSnapshotDraft("");
                                setShowAdvanced(false);
                                setChangeOpen((open) => !open);
                            }}
                            className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                        >
                            {changeOpen ? "Close" : "Change batch"}
                        </button>
                    </CardContent>
                </Card>
            ) : null}

            {changeOpen ? (
                <Card className="border-gray-200 shadow-sm">
                    <CardContent className="space-y-4 p-4">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-900">Select import batch</h3>
                            <p className="mt-1 text-xs text-gray-600">
                                Choose a recent import batch. The URL updates to{" "}
                                <code className="rounded bg-gray-100 px-1">?import_batch_id=…</code>.
                            </p>
                        </div>

                        {batchesQuery.isLoading ? (
                            <ImportTransportLoadingBannerWithSpinner message="Loading import batches…" />
                        ) : null}

                        <ImportTransportErrorState message={batchesQuery.error} compact />

                        {batchesQuery.data?.items.length ? (
                            <div className="max-h-64 overflow-auto rounded-lg border border-gray-200">
                                <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                                    <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                                        <tr>
                                            <th className="px-3 py-2 font-medium">ID</th>
                                            <th className="px-3 py-2 font-medium">Name</th>
                                            <th className="px-3 py-2 font-medium">Status</th>
                                            <th className="px-3 py-2 font-medium">Imported</th>
                                            <th className="px-3 py-2 font-medium" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {batchesQuery.data.items.map((batch) => (
                                            <tr key={batch.id}>
                                                <td className="px-3 py-2 font-mono text-xs">{batch.id}</td>
                                                <td className="px-3 py-2">{batch.batch_name}</td>
                                                <td className="px-3 py-2">
                                                    <ImportTransportStatusBadge value={batch.import_status} />
                                                </td>
                                                <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                                                    {formatBatchDate(batch.imported_at || batch.created_at)}
                                                </td>
                                                <td className="px-3 py-2 text-right">
                                                    <button
                                                        type="button"
                                                        disabled={disabled}
                                                        onClick={() => {
                                                            batchContext.selectBatch(batch.id);
                                                            setChangeOpen(false);
                                                        }}
                                                        className="rounded-md border border-gray-900 bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                                                    >
                                                        Use batch
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <ImportTransportEmptyState
                                title="No import batches"
                                description="Import transport data first."
                            />
                        )}

                        <div className="border-t border-gray-100 pt-3">
                            <button
                                type="button"
                                onClick={() => setShowAdvanced((open) => !open)}
                                className="text-xs font-medium text-gray-600 underline-offset-2 hover:underline"
                            >
                                {showAdvanced ? "Hide advanced scope" : "Advanced: resolve by snapshot version"}
                            </button>
                        </div>

                        {showAdvanced ? (
                            <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50/80 p-3">
                                <label className="block text-sm">
                                    <span className="text-xs font-semibold uppercase text-gray-500">
                                        Source snapshot version
                                    </span>
                                    <input
                                        value={snapshotDraft}
                                        onChange={(e) => setSnapshotDraft(e.target.value)}
                                        disabled={disabled || Boolean(batchDraft.trim())}
                                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                                        placeholder="Optional — resolves to import batch"
                                    />
                                </label>
                                <label className="block text-sm">
                                    <span className="text-xs font-semibold uppercase text-gray-500">
                                        Import batch ID
                                    </span>
                                    <input
                                        value={batchDraft}
                                        onChange={(e) => setBatchDraft(e.target.value)}
                                        disabled={disabled || Boolean(snapshotDraft.trim())}
                                        inputMode="numeric"
                                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm disabled:bg-gray-100"
                                    />
                                </label>
                                <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => {
                                        batchContext.applyScopeToUrl({
                                            batchInput: batchDraft,
                                            snapshotInput: snapshotDraft,
                                        });
                                        setChangeOpen(false);
                                    }}
                                    className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-50"
                                >
                                    Apply scope
                                </button>
                            </div>
                        ) : null}
                    </CardContent>
                </Card>
            ) : null}
        </div>
    );
}
