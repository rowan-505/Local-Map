"use client";

export default function ImportTransportSkeletonCards({
    count = 6,
    columns = 3,
}: {
    count?: number;
    columns?: number;
}) {
    const gridClass =
        columns === 2
            ? "md:grid-cols-2"
            : columns === 4
              ? "md:grid-cols-2 xl:grid-cols-4"
              : "md:grid-cols-2 xl:grid-cols-3";

    return (
        <div className={`grid grid-cols-1 gap-4 ${gridClass}`} aria-hidden>
            {Array.from({ length: count }, (_, index) => (
                <div key={index} className="animate-pulse rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="h-3 w-24 rounded bg-gray-200" />
                    <div className="mt-3 h-8 w-16 rounded bg-gray-200" />
                    <div className="mt-3 h-3 w-full rounded bg-gray-100" />
                </div>
            ))}
        </div>
    );
}
