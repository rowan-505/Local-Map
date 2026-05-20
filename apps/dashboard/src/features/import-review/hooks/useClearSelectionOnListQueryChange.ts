"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

/** Clears row selection when filters, pagination, or scope change — not on background refetches. */
export function useClearSelectionOnListQueryChange(
    listQueryKey: string,
    setSelectedIds: Dispatch<SetStateAction<Set<string>>>
) {
    const prevKey = useRef(listQueryKey);

    useEffect(() => {
        if (prevKey.current !== listQueryKey) {
            setSelectedIds(new Set());
            prevKey.current = listQueryKey;
        }
    }, [listQueryKey, setSelectedIds]);
}
