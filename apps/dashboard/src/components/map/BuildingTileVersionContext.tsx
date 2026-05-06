"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
    type ReactNode,
} from "react";

export type BuildingTileVersionContextValue = {
    buildingTileVersion: number;
    setBuildingTileVersion: (v: number) => void;
    /** Advances to `Date.now()` for Martin `tiles_buildings_v` cache-bust; returns the new version. */
    bumpBuildingTileVersion: () => number;
};

const BuildingTileVersionContext = createContext<BuildingTileVersionContextValue | null>(null);

export function BuildingTileVersionProvider({ children }: { children: ReactNode }) {
    const [buildingTileVersion, setBuildingTileVersion] = useState(0);

    const bumpBuildingTileVersion = useCallback((): number => {
        const v = Date.now();
        setBuildingTileVersion(v);
        return v;
    }, []);

    const value = useMemo(
        () => ({ buildingTileVersion, setBuildingTileVersion, bumpBuildingTileVersion }),
        [buildingTileVersion, bumpBuildingTileVersion]
    );

    return (
        <BuildingTileVersionContext.Provider value={value}>{children}</BuildingTileVersionContext.Provider>
    );
}

export function useBuildingTileVersion(): BuildingTileVersionContextValue {
    const ctx = useContext(BuildingTileVersionContext);

    if (!ctx) {
        throw new Error("useBuildingTileVersion must be used within BuildingTileVersionProvider");
    }

    return ctx;
}
