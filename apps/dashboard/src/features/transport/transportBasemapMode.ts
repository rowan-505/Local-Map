"use client";

import { createContext, useContext } from "react";

import type { DataReviewBasemapMode } from "@/src/components/map/dataReviewBasemap";

export const TRANSPORT_DASHBOARD_BASEMAP_MODE_STORAGE_KEY = "transport-dashboard-basemap-mode";

const VALID_MODES = new Set<DataReviewBasemapMode>(["map", "satellite", "hybrid"]);

export function readStoredTransportBasemapMode(): DataReviewBasemapMode {
    if (typeof window === "undefined") {
        return "map";
    }
    try {
        const raw = window.localStorage.getItem(TRANSPORT_DASHBOARD_BASEMAP_MODE_STORAGE_KEY);
        if (raw && VALID_MODES.has(raw as DataReviewBasemapMode)) {
            return raw as DataReviewBasemapMode;
        }
    } catch {
        // ignore quota / private mode
    }
    return "map";
}

export function writeStoredTransportBasemapMode(mode: DataReviewBasemapMode): void {
    try {
        window.localStorage.setItem(TRANSPORT_DASHBOARD_BASEMAP_MODE_STORAGE_KEY, mode);
    } catch {
        // ignore
    }
}

export function isValidTransportBasemapMode(value: string): value is DataReviewBasemapMode {
    return VALID_MODES.has(value as DataReviewBasemapMode);
}

export type TransportBasemapModeContextValue = {
    readonly basemapMode: DataReviewBasemapMode;
    readonly setBasemapMode: (mode: DataReviewBasemapMode) => void;
    readonly satelliteAvailable: boolean;
};

export const TransportBasemapModeContext = createContext<TransportBasemapModeContextValue | null>(
    null,
);

/** Shared basemap mode for all Transport dashboard maps (persisted in localStorage). */
export function useTransportDashboardBasemapMode(): TransportBasemapModeContextValue {
    const ctx = useContext(TransportBasemapModeContext);
    if (!ctx) {
        throw new Error(
            "useTransportDashboardBasemapMode must be used within TransportBasemapModeProvider",
        );
    }
    return ctx;
}
