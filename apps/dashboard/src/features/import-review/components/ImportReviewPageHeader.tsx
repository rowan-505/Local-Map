"use client";

import Link from "next/link";

export default function ImportReviewPageHeader({
    pluralLabel,
    batchId,
    selectedBy,
    overviewHref,
}: {
    pluralLabel: string;
    batchId: string | null;
    selectedBy: string | null | undefined;
    overviewHref: string;
}) {
    return (
        <header className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:flex-row lg:items-start lg:justify-between">
            <div>
                <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Import review — {pluralLabel}</h1>
                <p className="mt-1 text-sm text-gray-600">
                    {batchId ? (
                        <>
                            Batch <span className="font-mono font-medium">{batchId}</span>
                            {selectedBy ? <span className="text-gray-500"> · {selectedBy}</span> : null}
                        </>
                    ) : (
                        "Set review_batch_id or source_snapshot_version to load candidates."
                    )}
                </p>
            </div>
            <Link
                href={overviewHref}
                className="inline-flex shrink-0 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
            >
                Back to overview
            </Link>
        </header>
    );
}
