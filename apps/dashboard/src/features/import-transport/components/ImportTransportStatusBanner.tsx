"use client";

export function ImportTransportStatusBanner({
    message,
    tone = "info",
    compact = false,
}: {
    message: string;
    tone?: "info" | "warning" | "error";
    compact?: boolean;
}) {
    if (!message.trim()) {
        return null;
    }
    const toneClass =
        tone === "warning"
            ? "border-amber-200 bg-amber-50 text-amber-950"
            : tone === "error"
              ? "border-red-200 bg-red-50 text-red-950"
              : "border-sky-200 bg-sky-50 text-sky-950";

    return (
        <div
            className={`rounded-lg border px-4 text-sm shadow-sm ${toneClass} ${compact ? "py-2" : "py-3"}`}
            role="status"
        >
            {message}
        </div>
    );
}
