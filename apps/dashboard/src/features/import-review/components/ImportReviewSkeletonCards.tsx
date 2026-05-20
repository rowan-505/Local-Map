"use client";

export default function ImportReviewSkeletonCards({
    count = 4,
    message,
    columns = 4,
}: {
    count?: number;
    message?: string;
    columns?: 2 | 3 | 4;
}) {
    const colClass =
        columns === 2
            ? "sm:grid-cols-2"
            : columns === 3
              ? "sm:grid-cols-2 lg:grid-cols-3"
              : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

    return (
        <div className="space-y-3">
            {message ? (
                <p className="text-xs font-medium text-gray-600" role="status">
                    {message}
                </p>
            ) : null}
            <div className={`grid grid-cols-1 gap-4 ${colClass}`} aria-hidden>
                {Array.from({ length: count }, (_, i) => (
                    <div
                        key={i}
                        className="animate-pulse rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
                    >
                        <div className="mb-3 h-4 w-1/3 rounded bg-gray-200" />
                        <div className="mb-2 h-8 w-1/2 rounded bg-gray-200" />
                        <div className="h-3 w-2/3 rounded bg-gray-100" />
                    </div>
                ))}
            </div>
        </div>
    );
}
