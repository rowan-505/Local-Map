"use client";

import { ImportReviewTableFrame } from "@/src/app/(admin)/import-review/_components/importReviewTableUi";

export default function ImportReviewSkeletonTable({
    columnCount = 8,
    rowCount = 10,
    message,
}: {
    columnCount?: number;
    rowCount?: number;
    message?: string;
}) {
    return (
        <ImportReviewTableFrame>
            {message ? (
                <div className="border-b border-gray-100 px-4 py-2">
                    <p className="text-xs font-medium text-gray-600" role="status">
                        {message}
                    </p>
                </div>
            ) : null}
            <div className="divide-y divide-gray-100" aria-hidden>
                {Array.from({ length: rowCount }, (_, rowIdx) => (
                    <div key={rowIdx} className="flex gap-3 px-4 py-3">
                        {Array.from({ length: columnCount }, (_, colIdx) => (
                            <div
                                key={colIdx}
                                className="h-4 flex-1 animate-pulse rounded bg-gray-200"
                                style={{ maxWidth: colIdx === 0 ? "4rem" : undefined }}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </ImportReviewTableFrame>
    );
}
