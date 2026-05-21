"use client";

import ImportReviewInlineSpinner from "./ImportReviewInlineSpinner";
import ReviewLoadingBanner from "@/src/components/review/ReviewLoadingState";

/** Full-width info banner (initial / blocking loads). */
export default function ImportReviewLoadingState({ message }: { message: string }) {
    return <ReviewLoadingBanner message={message} />;
}

export function ImportReviewLoadingBannerWithSpinner({ message }: { message: string }) {
    return (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 shadow-sm">
            <ImportReviewInlineSpinner label={message} size="md" className="text-blue-950" />
        </div>
    );
}
