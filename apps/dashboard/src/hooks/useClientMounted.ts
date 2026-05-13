"use client";

import { startTransition, useEffect, useState } from "react";

/**
 * `false` on the server and the first client paint; `true` after mount.
 * Use so MapLibre / browser-only UI matches SSR HTML and avoids hydration mismatches.
 */
export function useClientMounted(): boolean {
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        startTransition(() => {
            setMounted(true);
        });
    }, []);
    return mounted;
}
