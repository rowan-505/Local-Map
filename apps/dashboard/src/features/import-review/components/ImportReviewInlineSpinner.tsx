"use client";

export default function ImportReviewInlineSpinner({
    label,
    size = "sm",
    className = "",
}: {
    label?: string;
    size?: "sm" | "md";
    className?: string;
}) {
    const dim = size === "md" ? "h-4 w-4" : "h-3 w-3";
    return (
        <span
            className={`inline-flex items-center gap-2 text-gray-600 ${size === "md" ? "text-sm" : "text-xs"} ${className}`}
            role="status"
            aria-live="polite"
        >
            <span
                className={`inline-block animate-spin rounded-full border-2 border-gray-300 border-t-gray-700 ${dim}`}
                aria-hidden
            />
            {label ? <span>{label}</span> : null}
        </span>
    );
}
