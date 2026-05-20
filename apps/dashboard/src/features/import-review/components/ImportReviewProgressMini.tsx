"use client";

export default function ImportReviewProgressMini({
    processed,
    total,
    label = "Processed",
}: {
    processed: number;
    total: number;
    label?: string;
}) {
    const safeTotal = Math.max(total, 0);
    const safeProcessed = Math.min(Math.max(processed, 0), safeTotal || processed);
    const pct = safeTotal > 0 ? Math.round((safeProcessed / safeTotal) * 100) : 0;

    return (
        <div className="text-xs text-gray-800" role="status" aria-live="polite">
            <span className="font-medium">
                {label}: {safeProcessed.toLocaleString()} / {safeTotal.toLocaleString()}
                {safeTotal > 0 ? ` (${pct}%)` : ""}
            </span>
            {safeTotal > 0 ? (
                <div
                    className="mt-1.5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-200"
                    aria-hidden
                >
                    <div
                        className="h-full rounded-full bg-blue-600 transition-[width] duration-300"
                        style={{ width: `${pct}%` }}
                    />
                </div>
            ) : null}
        </div>
    );
}
