"use client";

import ImportReviewInlineSpinner from "./ImportReviewInlineSpinner";

export type ImportReviewOperationLogEntry = {
    id: string;
    label: string;
    message?: string | null;
    status?: string | null;
    at?: string | null;
};

export default function ImportReviewOperationLogPanel({
    title = "Activity log",
    entries,
    isLoading = false,
    loadingMessage = "Loading logs…",
    emptyMessage = "No log entries yet.",
}: {
    title?: string;
    entries: ImportReviewOperationLogEntry[];
    isLoading?: boolean;
    loadingMessage?: string;
    emptyMessage?: string;
}) {
    return (
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">{title}</h3>
            </div>
            <div className="max-h-64 overflow-y-auto px-4 py-3">
                {isLoading ? (
                    <ImportReviewInlineSpinner label={loadingMessage} />
                ) : entries.length === 0 ? (
                    <p className="text-xs text-gray-500">{emptyMessage}</p>
                ) : (
                    <ol className="space-y-2">
                        {entries.map((entry) => (
                            <li
                                key={entry.id}
                                className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2 text-xs"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-semibold text-gray-900">{entry.label}</span>
                                    {entry.status ? (
                                        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 font-mono text-[10px] text-gray-700">
                                            {entry.status}
                                        </span>
                                    ) : null}
                                </div>
                                {entry.message ? (
                                    <p className="mt-1 text-gray-700">{entry.message}</p>
                                ) : null}
                                {entry.at ? (
                                    <p className="mt-0.5 font-mono text-[10px] text-gray-500">{entry.at}</p>
                                ) : null}
                            </li>
                        ))}
                    </ol>
                )}
            </div>
        </section>
    );
}
