"use client";

const TONE_CLASS: Record<string, string> = {
    approved: "border-emerald-200 bg-emerald-50 text-emerald-900",
    rejected: "border-red-200 bg-red-50 text-red-900",
    needs_more_review: "border-amber-200 bg-amber-50 text-amber-950",
    needs_review: "border-amber-200 bg-amber-50 text-amber-950",
    ignored: "border-gray-200 bg-gray-50 text-gray-800",
    merged: "border-sky-200 bg-sky-50 text-sky-900",
    manual_protected: "border-violet-200 bg-violet-50 text-violet-900",
    duplicate_candidate: "border-orange-200 bg-orange-50 text-orange-950",
    new_auto: "border-blue-200 bg-blue-50 text-blue-900",
};

export default function ImportReviewStatusBadge({ value }: { value: string }) {
    const key = value.trim().toLowerCase();
    const cls = TONE_CLASS[key] ?? "border-gray-200 bg-gray-50 text-gray-800";

    return (
        <span
            className={`inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
            title={value}
        >
            {value}
        </span>
    );
}
