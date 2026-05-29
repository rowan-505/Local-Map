"use client";

import ReviewEmptyState from "@/src/components/review/ReviewEmptyState";

export default function ImportTransportEmptyState({
    title,
    description,
}: {
    title: string;
    description?: string;
}) {
    return <ReviewEmptyState palette="import" title={title} description={description} />;
}
