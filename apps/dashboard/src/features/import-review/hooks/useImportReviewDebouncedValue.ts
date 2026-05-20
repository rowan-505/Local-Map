"use client";

import { useEffect, useState } from "react";

/** Debounce a string value (e.g. search `q` draft) before applying to list fetch. */
export function useImportReviewDebouncedValue(value: string, delayMs = 400): string {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const t = window.setTimeout(() => setDebounced(value), delayMs);
        return () => window.clearTimeout(t);
    }, [value, delayMs]);

    return debounced;
}
