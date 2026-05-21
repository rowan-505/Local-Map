"use client";

/** Error banner — visible when message is set. */
export default function ReviewErrorState({
    message,
    compact = false,
}: {
    message: string;
    compact?: boolean;
}) {
    if (!message.trim()) {
        return null;
    }
    return (
        <div
            role="alert"
            className={`rounded-xl border border-red-200 bg-red-50 text-red-950 shadow-sm ${compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"}`}
        >
            {message}
        </div>
    );
}
