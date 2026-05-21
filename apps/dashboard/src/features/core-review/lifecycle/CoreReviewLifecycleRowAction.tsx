"use client";

import type { CoreReviewEntitySlug } from "@/src/lib/api";

import CoreReviewRestoreButton from "./CoreReviewRestoreButton";
import CoreReviewSoftDeleteButton from "./CoreReviewSoftDeleteButton";
import {
    coreReviewRowLifecycleAction,
    type CoreReviewLifecycleStatusFilter,
} from "./coreReviewLifecycleUtils";

export default function CoreReviewLifecycleRowAction({
    apiSlug,
    row,
    rowId,
    listStatus,
    onSuccess,
    onError,
}: {
    apiSlug: CoreReviewEntitySlug;
    row: Record<string, unknown>;
    rowId: string;
    listStatus: CoreReviewLifecycleStatusFilter;
    onSuccess?: (message: string) => void;
    onError?: (message: string) => void;
}) {
    const action = coreReviewRowLifecycleAction(row, listStatus);
    if (!action) {
        return <span className="text-xs text-slate-400">—</span>;
    }

    if (action === "restore") {
        return (
            <CoreReviewRestoreButton
                apiSlug={apiSlug}
                recordId={rowId}
                compact
                onSuccess={onSuccess}
                onError={onError}
            />
        );
    }

    return (
        <CoreReviewSoftDeleteButton
            apiSlug={apiSlug}
            recordId={rowId}
            compact
            onSuccess={onSuccess}
            onError={onError}
        />
    );
}
