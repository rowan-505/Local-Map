"use client";

import ImportReviewStatusBanner from "./ImportReviewStatusBanner";

/** Error banner — always visible when message is set. */
export default function ImportReviewErrorState({ message }: { message: string }) {
    return <ImportReviewStatusBanner message={message} tone="error" />;
}
