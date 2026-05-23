"use client";

import { useState } from "react";

import type { CoreReviewEntitySlug } from "@/src/lib/api";

import CoreReviewConfirmDialog from "./CoreReviewConfirmDialog";
import { coreReviewEntityLabel } from "./coreReviewLifecycleUtils";
import { useCoreReviewLifecycleMutation } from "./useCoreReviewLifecycleMutation";

const BUTTON_CLASS =
    "rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60";

export default function CoreReviewSoftDeleteButton({
    apiSlug,
    recordId,
    disabled,
    compact,
    onSuccess,
    onError,
    beforeOpen,
}: {
    apiSlug: CoreReviewEntitySlug;
    recordId: string;
    disabled?: boolean;
    compact?: boolean;
    onSuccess?: (message: string) => void;
    onError?: (message: string) => void;
    /** When set, called before opening the confirm dialog (e.g. unsaved-edit guard). */
    beforeOpen?: (proceed: () => void) => void;
}) {
    const [open, setOpen] = useState(false);
    const { isBusy, runSoftDelete } = useCoreReviewLifecycleMutation(apiSlug);
    const label = coreReviewEntityLabel(apiSlug);

    async function handleConfirm() {
        const result = await runSoftDelete(recordId);
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
                    const openDialog = () => setOpen(true);
                    if (beforeOpen) {
                        beforeOpen(openDialog);
                    } else {
                        openDialog();
                    }
                }}
                className={compact ? `${BUTTON_CLASS} px-2 py-1 text-xs` : BUTTON_CLASS}
            >
                {isBusy ? "Deleting…" : "Soft delete"}
            </button>
            <CoreReviewConfirmDialog
                open={open}
                title={`Soft delete this ${label}?`}
                description="This hides the record from normal Core Review lists and public map output, but keeps it in the database so it can be restored later."
                confirmLabel="Soft delete"
                confirmTone="danger"
                isBusy={isBusy}
                onConfirm={() => void handleConfirm()}
                onCancel={() => setOpen(false)}
            />
        </>
    );
}
