"use client";

import type { ImportReviewStatusBannerTone } from "../utils/importReviewMessageTone";

export type { ImportReviewStatusBannerTone };

const TONE_CLASS: Record<ImportReviewStatusBannerTone, string> = {
    info: "border-blue-200 bg-blue-50 text-blue-950",
    success: "border-emerald-200 bg-emerald-50 text-emerald-950",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    error: "border-red-200 bg-red-50 text-red-950",
};

export default function ImportReviewStatusBanner({
    message,
    tone = "info",
    compact = false,
    className = "",
}: {
    message: string;
    tone?: ImportReviewStatusBannerTone;
    compact?: boolean;
    className?: string;
}) {
    if (!message.trim()) {
        return null;
    }

    return (
        <div
            role="status"
            aria-live="polite"
            className={`rounded-xl border shadow-sm ${compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"} ${TONE_CLASS[tone]} ${className}`}
        >
            {message}
        </div>
    );
}
