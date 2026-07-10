"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { toAuthoritativeStopRouteUsage } from "./authoritativeStopRouteUsage";
import { getTransportStopRouteUsageDetail } from "./api";
import { ROUTE_USAGE_LOAD_ERROR } from "./routeUsageSummaryDisplay";
import type { TransportStopRouteUsageDetailResponse } from "./types";

export function useTransportStopRouteUsageDetail({
    stopPublicId,
    enabled,
    reloadNonce = 0,
}: {
    readonly stopPublicId: string | null;
    readonly enabled: boolean;
    readonly reloadNonce?: number;
}) {
    const [data, setData] = useState<TransportStopRouteUsageDetailResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const requestIdRef = useRef(0);

    const clear = useCallback(() => {
        requestIdRef.current += 1;
        setData(null);
        setLoading(false);
        setError("");
    }, []);

    useEffect(() => {
        if (!enabled || !stopPublicId) {
            clear();
            return;
        }

        const controller = new AbortController();
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setData(null);
        setLoading(true);
        setError("");

        void (async () => {
            try {
                const result = await getTransportStopRouteUsageDetail(stopPublicId, {
                    signal: controller.signal,
                });
                if (requestId !== requestIdRef.current) {
                    return;
                }
                setData(result);
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                if (requestId !== requestIdRef.current) {
                    return;
                }
                setData(null);
                setError(ROUTE_USAGE_LOAD_ERROR);
            } finally {
                if (requestId === requestIdRef.current) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            controller.abort();
        };
    }, [clear, enabled, reloadNonce, stopPublicId]);

    const usage = useMemo(
        () => (data ? toAuthoritativeStopRouteUsage(data) : null),
        [data],
    );

    return {
        data,
        usage,
        loading,
        error,
        summary: data?.summary ?? null,
        items: data?.routes ?? [],
    };
}
