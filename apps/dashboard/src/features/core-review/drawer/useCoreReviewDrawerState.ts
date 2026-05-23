"use client";

import { useCallback, useMemo, useState } from "react";

import type { CoreReviewDrawerMode } from "./types";

export type UseCoreReviewDrawerStateOptions = {
    rowId: string | null;
    open: boolean;
    startInEditMode?: boolean;
};

type DrawerSession = {
    rowId: string | null;
    mode: CoreReviewDrawerMode;
};

export function useCoreReviewDrawerState({
    rowId,
    open,
    startInEditMode = false,
}: UseCoreReviewDrawerStateOptions) {
    const [session, setSession] = useState<DrawerSession>({ rowId: null, mode: "view" });

    const mode: CoreReviewDrawerMode = useMemo(() => {
        if (!open || !rowId) {
            return "view";
        }
        if (session.rowId === rowId) {
            return session.mode;
        }
        if (startInEditMode) {
            return "edit";
        }
        return "view";
    }, [open, rowId, session.rowId, session.mode, startInEditMode]);

    const enterEdit = useCallback(() => {
        if (!rowId) {
            return;
        }
        setSession({ rowId, mode: "edit" });
    }, [rowId]);

    const cancelEdit = useCallback(() => {
        if (!rowId) {
            return;
        }
        setSession({ rowId, mode: "view" });
    }, [rowId]);

    const returnToView = useCallback(() => {
        if (!rowId) {
            return;
        }
        setSession({ rowId, mode: "view" });
    }, [rowId]);

    return {
        mode,
        enterEdit,
        cancelEdit,
        returnToView,
        isEditing: mode === "edit",
    };
}
