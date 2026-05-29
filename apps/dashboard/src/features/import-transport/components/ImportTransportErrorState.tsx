"use client";

import ReviewErrorState from "@/src/components/review/ReviewErrorState";

export default function ImportTransportErrorState({
    message,
    compact = false,
}: {
    message: string;
    compact?: boolean;
}) {
    return <ReviewErrorState message={message} compact={compact} />;
}
