"use client";

import type { CoreReviewEntitySlug } from "@/src/lib/api";

import CoreReviewRestoreButton from "./CoreReviewRestoreButton";
import CoreReviewSoftDeleteButton from "./CoreReviewSoftDeleteButton";
import { isCoreReviewRowDeleted } from "./coreReviewLifecycleUtils";

export default function CoreReviewLifecycleDrawerActions({
    apiSlug,
    row,
    recordId,
    onSuccess,
    onError,
    onAfterLifecycle,
    beforeAction,
}: {
    apiSlug: CoreReviewEntitySlug;
    row: Record<string, unknown>;
    recordId: string;
    onSuccess?: (message: string) => void;
    onError?: (message: string) => void;
    onAfterLifecycle?: () => void;
    beforeAction?: (proceed: () => void) => void;
}) {
    const deleted = isCoreReviewRowDeleted(row);

    const handleSuccess = (message: string) => {
        onSuccess?.(message);
        onAfterLifecycle?.();
    };

    if (deleted) {
        return (
            <CoreReviewRestoreButton
                apiSlug={apiSlug}
                recordId={recordId}
                beforeOpen={beforeAction}
                onSuccess={handleSuccess}
                onError={onError}
            />
        );
    }

    return (
        <CoreReviewSoftDeleteButton
            apiSlug={apiSlug}
            recordId={recordId}
            beforeOpen={beforeAction}
            onSuccess={handleSuccess}
            onError={onError}
        />
    );
}
