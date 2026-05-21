"use client";

import { REVIEW_PALETTE, type ReviewPalette } from "./reviewPalette";

export function ReviewLoadingCard({
    message,
    palette = "core",
}: {
    message: string;
    palette?: ReviewPalette;
}) {
    const p = REVIEW_PALETTE[palette];
    return (
        <div className={`rounded-xl border ${p.cardBorder} ${p.cardBg} p-6 text-sm ${p.body} shadow-sm`}>
            {message}
        </div>
    );
}

export function ReviewLoadingBannerWithSpinner({ message }: { message: string }) {
    return (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 shadow-sm">
            <span
                className="inline-flex items-center gap-2 text-sm text-sky-950"
                role="status"
                aria-live="polite"
            >
                <span
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-sky-300 border-t-sky-800"
                    aria-hidden
                />
                {message}
            </span>
        </div>
    );
}

/** Full-width info banner (blocking loads). */
export default function ReviewLoadingState({ message }: { message: string }) {
    return <ReviewLoadingBannerWithSpinner message={message} />;
}
