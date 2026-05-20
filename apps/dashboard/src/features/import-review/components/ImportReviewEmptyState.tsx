"use client";

export default function ImportReviewEmptyState({
    title,
    description,
}: {
    title: string;
    description?: string;
}) {
    return (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center shadow-sm">
            <p className="text-sm font-medium text-gray-900">{title}</p>
            {description ? <p className="mt-1 text-sm text-gray-600">{description}</p> : null}
        </div>
    );
}
