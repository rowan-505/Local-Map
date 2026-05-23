"use client";

import { useCallback, useRef, useState } from "react";

export type CoreReviewInlineEditGuard = (action: () => void) => void;

export function useCoreReviewInlineEditDiscardGuard({
    enabled,
    isEditing,
    isDirty,
    onDiscard,
}: {
    enabled: boolean;
    isEditing: boolean;
    isDirty: boolean;
    onDiscard: () => void;
}) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const pendingActionRef = useRef<(() => void) | null>(null);

    const guardAction = useCallback<CoreReviewInlineEditGuard>(
        (action) => {
            if (!enabled || !isEditing) {
                action();
                return;
            }

            const run = () => {
                onDiscard();
                action();
            };

            if (!isDirty) {
                run();
                return;
            }

            pendingActionRef.current = run;
            setDialogOpen(true);
        },
        [enabled, isEditing, isDirty, onDiscard],
    );

    const confirmDiscard = useCallback(() => {
        setDialogOpen(false);
        const pending = pendingActionRef.current;
        pendingActionRef.current = null;
        pending?.();
    }, []);

    const cancelDiscard = useCallback(() => {
        setDialogOpen(false);
        pendingActionRef.current = null;
    }, []);

    return {
        guardAction,
        dialogOpen,
        confirmDiscard,
        cancelDiscard,
    };
}
