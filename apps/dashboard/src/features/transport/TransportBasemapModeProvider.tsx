"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import type { DataReviewBasemapMode } from "@/src/components/map/dataReviewBasemap";
import { isDashboardSatelliteImageryAvailable } from "@/src/lib/basemaps/satelliteRasterConfig";

import {
    isValidTransportBasemapMode,
    readStoredTransportBasemapMode,
    TransportBasemapModeContext,
    TRANSPORT_DASHBOARD_BASEMAP_MODE_STORAGE_KEY,
    writeStoredTransportBasemapMode,
} from "./transportBasemapMode";

export function TransportBasemapModeProvider({ children }: { readonly children: ReactNode }) {
    const satelliteAvailable = isDashboardSatelliteImageryAvailable();
    const [basemapMode, setBasemapModeState] = useState<DataReviewBasemapMode>(
        readStoredTransportBasemapMode,
    );

    const setBasemapMode = useCallback(
        (mode: DataReviewBasemapMode) => {
            if ((mode === "satellite" || mode === "hybrid") && !satelliteAvailable) {
                return;
            }
            setBasemapModeState(mode);
            writeStoredTransportBasemapMode(mode);
        },
        [satelliteAvailable],
    );

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== TRANSPORT_DASHBOARD_BASEMAP_MODE_STORAGE_KEY) {
                return;
            }
            const next = event.newValue;
            if (!next || !isValidTransportBasemapMode(next)) {
                return;
            }
            if ((next === "satellite" || next === "hybrid") && !satelliteAvailable) {
                setBasemapModeState("map");
                return;
            }
            setBasemapModeState(next);
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, [satelliteAvailable]);

    const value = useMemo(
        () => ({ basemapMode, setBasemapMode, satelliteAvailable }),
        [basemapMode, setBasemapMode, satelliteAvailable],
    );

    return (
        <TransportBasemapModeContext.Provider value={value}>
            {children}
        </TransportBasemapModeContext.Provider>
    );
}
