"use client";

import ReviewErrorState from "@/src/components/review/ReviewErrorState";

/** Error banner — always visible when message is set. */
export default function ImportReviewErrorState({ message }: { message: string }) {
    return <ReviewErrorState message={message} />;
}
