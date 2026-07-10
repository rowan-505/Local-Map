"use client";

import { useCallback, useEffect, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { getTransportStopDeleteEligibility } from "./api";
import type { TransportStopDeleteEligibility } from "./types";

/**
 * Permanent-delete eligibility for the selected stop. Checks all backend reference
 * paths (routes, variant endpoints, child stops, terminals, fares) and protected
 * review statuses.
 */
export function useSelectedStopRouteUsage(stopPublicId: string | null) {
    const [eligibility, setEligibility] = useState<TransportStopDeleteEligibility | null>(null);
    const [loading, setLoading] = useState(false);
    const [checked, setChecked] = useState(false);
    const [reloadNonce, setReloadNonce] = useState(0);

    const reload = useCallback(() => {
        setReloadNonce((value) => value + 1);
    }, []);

    useEffect(() => {
        if (!stopPublicId) {
            setEligibility(null);
            setLoading(false);
            setChecked(false);
            return;
        }

        const controller = new AbortController();
        setLoading(true);
        setChecked(false);
        void (async () => {
            try {
                const result = await getTransportStopDeleteEligibility(stopPublicId, {
                    signal: controller.signal,
                });
                setEligibility(result);
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                setEligibility(null);
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                    setChecked(true);
                }
            }
        })();

        return () => controller.abort();
    }, [stopPublicId, reloadNonce]);

    const deleteAllowed = checked && !loading && (eligibility?.can_delete ?? false);

    return {
        routeCount: eligibility?.route_count ?? null,
        loading,
        checked,
        deleteAllowed,
        hasRouteUsage: eligibility?.has_route_usage ?? false,
        blockMessage: eligibility?.can_delete ? null : (eligibility?.message ?? null),
        eligibility,
        reload,
    };
}
