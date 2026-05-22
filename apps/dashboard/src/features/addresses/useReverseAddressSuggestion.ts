"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getAdminReverseAddressDebug } from "@/src/lib/api";
import type { ReverseAddressDebugResponse } from "./reverseAddress.types";

export function useReverseAddressSuggestion(enabled: boolean) {
    const [data, setData] = useState<ReverseAddressDebugResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const requestIdRef = useRef(0);

    const fetchAt = useCallback(
        async (lat: number, lng: number, lang: "en" | "my" = "en") => {
            if (!enabled || !Number.isFinite(lat) || !Number.isFinite(lng)) {
                setData(null);
                setError("");
                return null;
            }

            const requestId = ++requestIdRef.current;
            setLoading(true);
            setError("");

            try {
                const res = await getAdminReverseAddressDebug(lat, lng, lang);
                if (requestId !== requestIdRef.current) {
                    return null;
                }
                setData(res);
                return res;
            } catch (err: unknown) {
                if (requestId !== requestIdRef.current) {
                    return null;
                }
                setData(null);
                setError(err instanceof Error ? err.message : "Reverse address lookup failed");
                return null;
            } finally {
                if (requestId === requestIdRef.current) {
                    setLoading(false);
                }
            }
        },
        [enabled]
    );

    const clear = useCallback(() => {
        requestIdRef.current += 1;
        setData(null);
        setError("");
        setLoading(false);
    }, []);

    useEffect(() => () => {
        requestIdRef.current += 1;
    }, []);

    return { data, loading, error, fetchAt, clear };
}
