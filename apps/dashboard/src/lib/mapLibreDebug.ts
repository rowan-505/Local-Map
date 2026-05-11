import type { Map as MaplibreMap, StyleSpecification } from "maplibre-gl";

import {
    BUILDINGS_MARTIN_MIN_ZOOM,
    MAP_BUILDINGS_VECTOR_SOURCE_ID,
    MAP_PLACES_VECTOR_SOURCE_ID,
    MAP_ROAD_LABELS_VECTOR_SOURCE_ID,
    MAP_STREETS_VECTOR_SOURCE_ID,
    mapBuildingsTileUrl,
    mapPlacesTileUrl,
    mapRoadLabelsTileUrl,
    mapStreetsTileUrl,
    scheduleBuildingTileRefresh,
    schedulePlaceTileRefresh,
    scheduleRoadLabelTileRefresh,
    scheduleStreetTileRefresh,
} from "@/src/components/map/placeMapConfig";

declare global {
    interface Window {
        map?: MaplibreMap;
        refreshDynamicTiles?: () => void;
        debugSources?: () => void;
        __localMapMapLibreDebugHelpersInstalled?: boolean;
    }
}

const INSTALL_FLAG = "__localMapMapLibreDebugHelpersInstalled" as const;

let bumpAllDynamicTileVersions: (() => number) | null = null;

/** Called from {@link BuildingTileVersionProvider} in development so `refreshDynamicTiles` bumps React tile versions. */
export function registerDashboardTileDebugBumps(fn: (() => number) | null): void {
    bumpAllDynamicTileVersions = fn;
}

function isDevClient(): boolean {
    return typeof window !== "undefined" && process.env.NODE_ENV !== "production";
}

function installWindowMapLibreDebugHelpersOnce(): void {
    if (!isDevClient()) {
        return;
    }

    if (window[INSTALL_FLAG]) {
        return;
    }

    window[INSTALL_FLAG] = true;

    window.debugSources = () => {
        const map = window.map;

        if (!map) {
            console.log("[MapLibre debug] window.map is not set — open a dashboard map first.");
            return;
        }

        if (!map.isStyleLoaded()) {
            console.log("[MapLibre debug] Style not loaded yet; try again after the map finishes loading.");
            return;
        }

        const style = map.getStyle();
        const entries = Object.entries(style.sources ?? {});

        const rows = entries.map(([id, spec]) => {
            if (!spec || typeof spec !== "object") {
                return { id, type: "unknown", tileUrls: "" };
            }

            const o = spec as Record<string, unknown>;
            const type = typeof o.type === "string" ? o.type : "unknown";

            let tileUrls: string[] = [];

            if (Array.isArray(o.tiles)) {
                tileUrls = o.tiles.filter((t): t is string => typeof t === "string");
            }

            if (tileUrls.length === 0 && typeof o.url === "string") {
                tileUrls = [o.url];
            }

            return {
                id,
                type,
                tileUrls: tileUrls.join("\n"),
            };
        });

        console.log("[MapLibre debug] debugSources — all sources (id, type, tile URLs)");
        console.table(rows);
        console.log("[MapLibre debug] debugSources — raw rows:", rows);
    };

    window.refreshDynamicTiles = () => {
        const v = bumpAllDynamicTileVersions?.() ?? Date.now();
        const map = window.map;

        console.log("[MapLibre debug] refreshDynamicTiles — bumping tile versions and refreshing MVT", {
            version: v,
            hasWindowMap: Boolean(map),
            styleLoaded: Boolean(map?.isStyleLoaded()),
        });

        if (!map?.isStyleLoaded()) {
            console.log(
                "[MapLibre debug] refreshDynamicTiles — no window.map or style not loaded; tile versions were still bumped for other mounted maps."
            );
            return;
        }

        const dynamicIds = [
            MAP_BUILDINGS_VECTOR_SOURCE_ID,
            MAP_STREETS_VECTOR_SOURCE_ID,
            MAP_PLACES_VECTOR_SOURCE_ID,
            MAP_ROAD_LABELS_VECTOR_SOURCE_ID,
        ] as const;

        function runSchedules(): Record<string, boolean> {
            return {
                buildings: scheduleBuildingTileRefresh(map, v),
                streets: scheduleStreetTileRefresh(map, v),
                places: schedulePlaceTileRefresh(map, v),
                roadLabels: scheduleRoadLabelTileRefresh(map, v),
            };
        }

        let results = runSchedules();
        console.log("[MapLibre debug] refreshDynamicTiles — schedule results (pass 1):", results);

        const missing = dynamicIds.filter((id) => !map.getSource(id));

        if (missing.length > 0) {
            console.warn(
                "[MapLibre debug] refreshDynamicTiles — missing vector sources (will try to re-add):",
                missing
            );

            for (const id of missing) {
                try {
                    const url =
                        id === MAP_BUILDINGS_VECTOR_SOURCE_ID
                            ? mapBuildingsTileUrl(v)
                            : id === MAP_STREETS_VECTOR_SOURCE_ID
                              ? mapStreetsTileUrl(v)
                              : id === MAP_PLACES_VECTOR_SOURCE_ID
                                ? mapPlacesTileUrl(v)
                                : mapRoadLabelsTileUrl(v);

                    map.addSource(id, {
                        type: "vector",
                        tiles: [url],
                        minzoom: id === MAP_BUILDINGS_VECTOR_SOURCE_ID ? BUILDINGS_MARTIN_MIN_ZOOM : 0,
                        maxzoom: 22,
                    });
                    console.log(`[MapLibre debug] refreshDynamicTiles — re-added missing source "${id}"`);
                } catch (err) {
                    console.warn(`[MapLibre debug] refreshDynamicTiles — could not re-add source "${id}"`, err);
                }
            }

            results = runSchedules();
            console.log("[MapLibre debug] refreshDynamicTiles — schedule results (pass 2 after re-add):", results);
        }

        const anyScheduleFailed = Object.values(results).some((ok) => !ok);

        if (anyScheduleFailed) {
            try {
                const current = map.getStyle() as StyleSpecification;
                map.setStyle(current);
                console.log("[MapLibre debug] refreshDynamicTiles — reloaded style via setStyle(getStyle())");

                const afterReload = runSchedules();
                console.log("[MapLibre debug] refreshDynamicTiles — schedule results (pass 3 after style reload):", afterReload);
            } catch (err) {
                console.warn("[MapLibre debug] refreshDynamicTiles — style reload failed", err);
            }
        }
    };

    console.log("MapLibre debug helpers attached to window");
}

/**
 * Development-only: sets `window.map` and installs `window.debugSources` / `window.refreshDynamicTiles` once.
 * Call from each MapLibre `load` handler (or central factory) so the last focused map wins.
 */
export function attachMapLibreDevDebugMap(map: MaplibreMap): void {
    if (!isDevClient()) {
        return;
    }

    installWindowMapLibreDebugHelpersOnce();
    window.map = map;
}
