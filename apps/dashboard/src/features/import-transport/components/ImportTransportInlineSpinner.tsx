"use client";

export default function ImportTransportInlineSpinner({
    label,
    className,
}: {
    label: string;
    className?: string;
}) {
    return (
        <span className={`inline-flex items-center gap-2 text-sm text-gray-600 ${className ?? ""}`}>
            <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700"
                aria-hidden
            />
            {label}
        </span>
    );
}
