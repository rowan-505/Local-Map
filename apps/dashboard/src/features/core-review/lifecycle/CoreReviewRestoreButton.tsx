"use client";

import { useState } from "react";

import type { CoreReviewEntitySlug } from "@/src/lib/api";

import CoreReviewConfirmDialog from "./CoreReviewConfirmDialog";
import { coreReviewEntityLabel } from "./coreReviewLifecycleUtils";
import { useCoreReviewLifecycleMutation } from "./useCoreReviewLifecycleMutation";

const BUTTON_CLASS =
    "rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-60";

export default function CoreReviewRestoreButton({
    apiSlug,
    recordId,
    disabled,
    compact,
    onSuccess,
    onError,
}: {
    apiSlug: CoreReviewEntitySlug;
    recordId: string;
    disabled?: boolean;
    compact?: boolean;
    onSuccess?: (message: string) => void;
    onError?: (message: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const { isBusy, runRestore } = useCoreReviewLifecycleMutation(apiSlug);
    const label = coreReviewEntityLabel(apiSlug);

    async function handleConfirm() {
        const result = await runRestore(recordId);
        if (result.ok) {
            setOpen(false);
            onSuccess?.(result.message);
        } else {
            onError?.(result.message);
        }
    }

    return (
        <>
            <button
                type="button"
                disabled={disabled || isBusy}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(true);
                }}
                className={compact ? `${BUTTON_CLASS} px-2 py-1 text-xs` : BUTTON_CLASS}
            >
                {isBusy ? "Restoring…" : "Restore"}
            </button>
            <CoreReviewConfirmDialog
                open={open}
                title={`Restore this ${label}?`}
                description="This makes the record active again."
                confirmLabel="Restore"
                confirmTone="restore"
                isBusy={isBusy}
                onConfirm={() => void handleConfirm()}
                onCancel={() => setOpen(false)}
            />
        </>
    );
}
