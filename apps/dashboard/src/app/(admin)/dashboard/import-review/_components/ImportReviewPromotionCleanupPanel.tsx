"use client";

import { useMemo, useState } from "react";

import {
    PromotionSectionHeading,
    publishEntityFamilyLabel,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewPromotionUi";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import {
    postImportReviewCleanupPromotedDryRun,
    postImportReviewCleanupPromotedExecute,
    type ImportReviewCleanupPromotedDryRunResult,
    type ImportReviewCleanupPromotedExecuteResult,
} from "@/src/lib/api";

const ALL_CLEANUP_FAMILIES = [
    "buildings",
    "places",
    "landuse",
    "water_lines",
    "water_polygons",
    "bus_stops",
    "roads",
    "addresses",
    "admin_areas",
    "routing_barriers",
] as const;

const REASON_LABELS: Record<string, string> = {
    already_cleaned: "Already cleaned (candidate row missing)",
    not_promoted: "Not fully promoted",
    missing_promoted_core_id: "Missing promoted_core_id",
    missing_publish_item: "Missing publish item",
    publish_item_not_success: "Publish item not success / target mismatch",
    publish_batch_not_promoted: "Publish batch not promoted",
    core_row_missing: "Core row missing or inactive",
    lineage_missing: "Core lineage incomplete",
    failed_item_exists: "Failed publish item in same batch",
    verification_failed: "Batch verification failed",
    unsupported_entity_family: "Unsupported entity family",
};

function DryRunResults({ result }: { result: ImportReviewCleanupPromotedDryRunResult }) {
    const eligibleTotal = Object.values(result.eligible_counts_by_entity).reduce((a, b) => a + b, 0);
    const blockedEntries = Object.entries(result.not_eligible_counts_by_reason).sort((a, b) => b[1] - a[1]);

    return (
        <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
            <div>
                <p className="font-semibold">Dry-run result</p>
                <p className="mt-1 text-xs opacity-90">{result.message}</p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                    <dt className="text-xs uppercase tracking-wide opacity-75">Eligible rows</dt>
                    <dd className="text-lg font-semibold tabular-nums">{eligibleTotal.toLocaleString()}</dd>
                </div>
                <div>
                    <dt className="text-xs uppercase tracking-wide opacity-75">Geometry values</dt>
                    <dd className="text-lg font-semibold tabular-nums">
                        {result.estimated_geometry_rows_to_delete.toLocaleString()}
                    </dd>
                </div>
            </dl>
            {Object.keys(result.eligible_counts_by_entity).length > 0 ? (
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">Eligible by entity</p>
                    <ul className="mt-1 space-y-0.5">
                        {Object.entries(result.eligible_counts_by_entity).map(([family, count]) => (
                            <li key={family} className="flex justify-between gap-4">
                                <span>{publishEntityFamilyLabel(family)}</span>
                                <span className="tabular-nums font-medium">{count.toLocaleString()}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
            {blockedEntries.length > 0 ? (
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">Blocked reasons</p>
                    <ul className="mt-1 space-y-0.5">
                        {blockedEntries.map(([reason, count]) => (
                            <li key={reason} className="flex justify-between gap-4">
                                <span>{REASON_LABELS[reason] ?? reason}</span>
                                <span className="tabular-nums font-medium">{count.toLocaleString()}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
            {result.example_eligible_rows.length > 0 ? (
                <details className="text-xs">
                    <summary className="cursor-pointer font-medium">Example eligible rows</summary>
                    <pre className="mt-2 overflow-auto rounded bg-white/60 p-2">
                        {JSON.stringify(result.example_eligible_rows, null, 2)}
                    </pre>
                </details>
            ) : null}
            {result.example_blocked_rows.length > 0 ? (
                <details className="text-xs">
                    <summary className="cursor-pointer font-medium">Example blocked rows</summary>
                    <pre className="mt-2 overflow-auto rounded bg-white/60 p-2">
                        {JSON.stringify(result.example_blocked_rows, null, 2)}
                    </pre>
                </details>
            ) : null}
        </div>
    );
}

type Props = {
    reviewBatchId: string;
    publishBatchId?: string;
    defaultEntityFamilies?: string[];
    formatError?: (err: unknown) => string;
};

export default function ImportReviewPromotionCleanupPanel({
    reviewBatchId,
    publishBatchId,
    defaultEntityFamilies,
    formatError = (err) => (err instanceof Error ? err.message : "Request failed."),
}: Props) {
    const [selectedFamilies, setSelectedFamilies] = useState<string[]>(
        defaultEntityFamilies?.length ? [...defaultEntityFamilies] : [...ALL_CLEANUP_FAMILIES]
    );
    const [olderThanDays, setOlderThanDays] = useState("");
    const [dryRunResult, setDryRunResult] = useState<ImportReviewCleanupPromotedDryRunResult | null>(null);
    const [executeResult, setExecuteResult] = useState<ImportReviewCleanupPromotedExecuteResult | null>(null);
    const [isDryRunning, setIsDryRunning] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmText, setConfirmText] = useState("");

    const requestBody = useMemo(
        () => ({
            review_batch_id: reviewBatchId,
            entity_families: selectedFamilies,
            ...(publishBatchId ? { publish_batch_id: publishBatchId } : {}),
            ...(olderThanDays.trim()
                ? { older_than_days: Number.parseInt(olderThanDays.trim(), 10) }
                : {}),
        }),
        [reviewBatchId, publishBatchId, selectedFamilies, olderThanDays]
    );

    const canConfirmExecute = confirmText === "DELETE PROMOTED REVIEW DATA";
    const executeEnabled = dryRunResult?.execute_enabled === true;

    async function handleDryRun() {
        setIsDryRunning(true);
        setError(null);
        setExecuteResult(null);
        try {
            setDryRunResult(await postImportReviewCleanupPromotedDryRun(requestBody));
        } catch (err) {
            setError(formatError(err));
            setDryRunResult(null);
        } finally {
            setIsDryRunning(false);
        }
    }

    async function handleExecute() {
        setIsExecuting(true);
        setError(null);
        try {
            const result = await postImportReviewCleanupPromotedExecute({
                ...requestBody,
                confirmation_text: "DELETE PROMOTED REVIEW DATA",
            });
            setExecuteResult(result);
            setConfirmOpen(false);
            setConfirmText("");
            setDryRunResult(null);
        } catch (err) {
            setError(formatError(err));
        } finally {
            setIsExecuting(false);
        }
    }

    function toggleFamily(family: string) {
        setSelectedFamilies((prev) =>
            prev.includes(family) ? prev.filter((f) => f !== family) : [...prev, family]
        );
    }

    return (
        <section className="border-t border-gray-100 pt-6">
            <PromotionSectionHeading
                title="Permanent cleanup"
                subtitle="Dry-run reports promoted import_review rows eligible for physical deletion. Core rows and system publish history are never deleted."
            />

            <div className="mt-4 space-y-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    <p className="font-medium">Destructive when enabled</p>
                    <p className="mt-1 text-xs">
                        Execute permanently deletes eligible import_review candidate rows only. Requires{" "}
                        <code className="rounded bg-amber-100 px-1">ENABLE_IMPORT_REVIEW_PERMANENT_CLEANUP=true</code>{" "}
                        on the API server.
                    </p>
                </div>

                <div className="flex flex-wrap gap-2">
                    {ALL_CLEANUP_FAMILIES.map((family) => (
                        <label
                            key={family}
                            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
                        >
                            <input
                                type="checkbox"
                                checked={selectedFamilies.includes(family)}
                                onChange={() => toggleFamily(family)}
                            />
                            {publishEntityFamilyLabel(family)}
                        </label>
                    ))}
                </div>

                <label className="block text-sm text-gray-700">
                    Older than (days, optional)
                    <input
                        type="number"
                        min={0}
                        value={olderThanDays}
                        onChange={(e) => setOlderThanDays(e.target.value)}
                        className="mt-1 w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
                        placeholder="e.g. 7"
                    />
                </label>

                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        disabled={isDryRunning || selectedFamilies.length === 0}
                        onClick={() => void handleDryRun()}
                        className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                        {isDryRunning ? (
                            <span className="inline-flex items-center gap-2">
                                <ImportReviewInlineSpinner label="Dry-running cleanup…" />
                            </span>
                        ) : (
                            "Dry-run cleanup"
                        )}
                    </button>
                    <button
                        type="button"
                        disabled={!executeEnabled || isExecuting || !dryRunResult}
                        onClick={() => setConfirmOpen(true)}
                        className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                        title={
                            executeEnabled
                                ? "Permanently delete eligible import_review rows"
                                : "Execute disabled until ENABLE_IMPORT_REVIEW_PERMANENT_CLEANUP=true"
                        }
                    >
                        Execute cleanup
                    </button>
                </div>

                {!executeEnabled && dryRunResult ? (
                    <p className="text-xs text-gray-500">
                        Execute is disabled on the API. Run dry-run to preview; enable the env flag to allow deletion.
                    </p>
                ) : null}

                {error ? (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

                {dryRunResult ? <DryRunResults result={dryRunResult} /> : null}

                {executeResult ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                        <p className="font-semibold">Cleanup executed</p>
                        <p className="mt-1">
                            Deleted {executeResult.deleted_count.toLocaleString()} candidate row(s).
                        </p>
                        <p className="mt-1 text-xs opacity-90">{executeResult.message}</p>
                    </div>
                ) : null}
            </div>

            {confirmOpen ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    role="dialog"
                    aria-modal="true"
                >
                    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-red-900">Permanently delete review data</h3>
                        <p className="mt-2 text-sm text-gray-600">
                            This will permanently delete eligible import_review candidate rows for review batch{" "}
                            {reviewBatchId}
                            {publishBatchId ? ` (publish batch ${publishBatchId})` : ""}. Core rows and system
                            publish batches/items/logs will be preserved.
                        </p>
                        {dryRunResult ? (
                            <p className="mt-3 text-sm font-medium text-gray-900">
                                Estimated deletions: {dryRunResult.estimated_rows_to_delete.toLocaleString()} row(s)
                            </p>
                        ) : null}
                        <p className="mt-4 text-sm text-gray-600">
                            Type{" "}
                            <span className="font-mono font-semibold">DELETE PROMOTED REVIEW DATA</span> to confirm.
                        </p>
                        <input
                            type="text"
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setConfirmOpen(false);
                                    setConfirmText("");
                                }}
                                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!canConfirmExecute || isExecuting}
                                onClick={() => void handleExecute()}
                                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                            >
                                {isExecuting ? "Deleting…" : "Confirm delete"}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
