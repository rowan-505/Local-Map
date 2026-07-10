"use client";

import type { ReviewMapActionToastState } from "./reviewMapActionFeedback";

/**
 * Small floating toast for review-map actions (save, remove, archive, etc.).
 */
export default function ReviewMapActionToast({
    toast,
}: {
    readonly toast: ReviewMapActionToastState;
}) {
    if (!toast) {
        return null;
    }

    const success = toast.kind === "success";

    return (
        <div
            className={`pointer-events-none absolute left-1/2 top-3 z-[60] max-w-[min(92vw,28rem)] -translate-x-1/2 rounded-md border px-3 py-2 text-sm font-medium shadow-sm ${
                success
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-red-200 bg-red-50 text-red-900"
            }`}
            role="status"
            aria-live="polite"
        >
            {toast.message}
        </div>
    );
}
