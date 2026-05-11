"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

import { registerDashboardTileDebugBumps } from "@/src/lib/mapLibreDebug";

export type DashboardTileVersionContextValue = {
    buildingTileVersion: number;
    setBuildingTileVersion: (v: number) => void;
    /** Advances to `Date.now()` for Martin `tiles_buildings_v` cache-bust; returns the new version. */
    bumpBuildingTileVersion: () => number;
    streetTileVersion: number;
    setStreetTileVersion: (v: number) => void;
    /** Advances to `Date.now()` for Martin `tiles_streets_v` cache-bust; returns the new version. */
    bumpStreetTileVersion: () => number;
    placeTileVersion: number;
    setPlaceTileVersion: (v: number) => void;
    /** Advances to `Date.now()` for Martin `tiles_places_v` cache-bust; returns the new version. */
    bumpPlaceTileVersion: () => number;
    roadLabelTileVersion: number;
    setRoadLabelTileVersion: (v: number) => void;
    /** Advances to `Date.now()` for Martin `tiles_road_labels_v` cache-bust; returns the new version. */
    bumpRoadLabelTileVersion: () => number;
};

export type BuildingTileVersionContextValue = DashboardTileVersionContextValue;

const DashboardTileVersionContext = createContext<DashboardTileVersionContextValue | null>(null);

export function BuildingTileVersionProvider({ children }: { children: ReactNode }) {
    const [buildingTileVersion, setBuildingTileVersion] = useState(0);
    const [streetTileVersion, setStreetTileVersion] = useState(0);
    const [placeTileVersion, setPlaceTileVersion] = useState(0);
    const [roadLabelTileVersion, setRoadLabelTileVersion] = useState(0);

    const bumpBuildingTileVersion = useCallback((): number => {
        const v = Date.now();
        setBuildingTileVersion(v);
        return v;
    }, []);

    const bumpStreetTileVersion = useCallback((): number => {
        const v = Date.now();
        setStreetTileVersion(v);
        return v;
    }, []);

    const bumpPlaceTileVersion = useCallback((): number => {
        const v = Date.now();
        setPlaceTileVersion(v);
        return v;
    }, []);

    const bumpRoadLabelTileVersion = useCallback((): number => {
        const v = Date.now();
        setRoadLabelTileVersion(v);
        return v;
    }, []);

    useEffect(() => {
        if (process.env.NODE_ENV === "production") {
            return;
        }

        registerDashboardTileDebugBumps(() => {
            const v = Date.now();
            setBuildingTileVersion(v);
            setStreetTileVersion(v);
            setPlaceTileVersion(v);
            setRoadLabelTileVersion(v);
            return v;
        });

        return () => {
            registerDashboardTileDebugBumps(null);
        };
    }, []);

    const value = useMemo(
        () => ({
            buildingTileVersion,
            setBuildingTileVersion,
            bumpBuildingTileVersion,
            streetTileVersion,
            setStreetTileVersion,
            bumpStreetTileVersion,
            placeTileVersion,
            setPlaceTileVersion,
            bumpPlaceTileVersion,
            roadLabelTileVersion,
            setRoadLabelTileVersion,
            bumpRoadLabelTileVersion,
        }),
        [
            buildingTileVersion,
            bumpBuildingTileVersion,
            streetTileVersion,
            bumpStreetTileVersion,
            placeTileVersion,
            bumpPlaceTileVersion,
            roadLabelTileVersion,
            bumpRoadLabelTileVersion,
        ]
    );

    return (
        <DashboardTileVersionContext.Provider value={value}>{children}</DashboardTileVersionContext.Provider>
    );
}

export const DashboardTileVersionProvider = BuildingTileVersionProvider;

export function useDashboardTileVersions(): DashboardTileVersionContextValue {
    const ctx = useContext(DashboardTileVersionContext);

    if (!ctx) {
        throw new Error("useDashboardTileVersions must be used within DashboardTileVersionProvider");
    }

    return ctx;
}

export function useBuildingTileVersion(): BuildingTileVersionContextValue {
    return useDashboardTileVersions();
}
