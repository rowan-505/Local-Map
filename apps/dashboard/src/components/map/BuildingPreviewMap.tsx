"use client";

/**
 * Buildings list/detail preview (dashboard `/buildings`).
 *
 * PMTiles = stable snapshot (may show stale footprints until rebuild).
 * API GeoJSON live overlay = truth for the selected row — see {@link addBuildingLiveOverlay}.
 */
import area from "@turf/area";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";

import { createPreviewBaseMap } from "./createPreviewBaseMap";
import { MAP_PREVIEW_VIEWPORT_PLACES_SIDEBAR } from "./mapPreviewUi";
import { PLACE_MAP_DEFAULT_CENTER } from "./placeMapConfig";
import type { BuildingGeometry } from "@/src/lib/api";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import { dashDevLog } from "@/src/lib/dashDevLog";
import {
    addBuildingLiveOverlay,
    clearLiveOverlay,
    LIVE_BUILDING_SOURCE_ID,
} from "@/src/lib/map/liveOverlays";

export type BuildingPreviewMapProps = {
    geometry: BuildingGeometry | null | undefined;
    /** Shown when `geometry` is missing (after loading or if API has no footprint). */
    emptyHint?: string;
    className?: string;
    /** When the map instance is ready, assigned so the parent can call `refreshBuildingTiles` after mutations. */
    mapSurfaceRef?: MutableRefObject<MaplibreMap | null>;
};

const DEFAULT_ZOOM = 12;
const SMALL_BUILDING_ZOOM = 19;
const LARGE_FIT_MAX_ZOOM = 18;

/** Above this planar area (m²), treat footprint as "large" and use {@link LARGE_FIT_MAX_ZOOM}. */
const LARGE_FOOTPRINT_AREA_M2 = 8_000;

const IS_DEV = process.env.NODE_ENV === "development";

function emptyFeatureCollection() {
    return {
        type: "FeatureCollection" as const,
        features: [],
    };
}

function footprintFeatureCollection(geometry: BuildingGeometry | null | undefined) {
    if (!geometry) {
        return emptyFeatureCollection();
    }

    return {
        type: "FeatureCollection" as const,
        features: [
            {
                type: "Feature" as const,
                properties: {},
                geometry,
            },
        ],
    };
}

function footprintAreaSqM(geometry: BuildingGeometry): number {
    const feature: Feature<Polygon | MultiPolygon> = {
        type: "Feature",
        properties: {},
        geometry,
    };

    return area(feature);
}

function getFootprintBounds(
    geometry: BuildingGeometry | null | undefined
): maplibregl.LngLatBounds | null {
    if (!geometry) {
        return null;
    }

    const bounds = new maplibregl.LngLatBounds();

    if (geometry.type === "Polygon") {
        for (const ring of geometry.coordinates) {
            for (const c of ring) {
                if (typeof c[0] === "number" && typeof c[1] === "number") {
                    bounds.extend([c[0], c[1]]);
                }
            }
        }
    } else {
        for (const polygon of geometry.coordinates) {
            for (const ring of polygon) {
                for (const c of ring) {
                    if (typeof c[0] === "number" && typeof c[1] === "number") {
                        bounds.extend([c[0], c[1]]);
                    }
                }
            }
        }
    }

    return bounds.isEmpty() ? null : bounds;
}

function exposeBuildingPreviewMapForDev(map: maplibregl.Map) {
    if (typeof window === "undefined" || !IS_DEV) {
        return;
    }

    const w = window as unknown as { __buildingPreviewMap?: maplibregl.Map };
    w.__buildingPreviewMap = map;
}

export default function BuildingPreviewMap({
    geometry,
    emptyHint = "No geometry available for this building.",
    className,
    mapSurfaceRef,
}: BuildingPreviewMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [isMapReady, setIsMapReady] = useState(false);
    const clientMounted = useClientMounted();

    useEffect(() => {
        if (!clientMounted || !containerRef.current || mapRef.current) {
            return;
        }

        let cancelled = false;

        void (async () => {
            let map: maplibregl.Map;
            try {
                map = await createPreviewBaseMap(containerRef.current!, {
                    zoom: DEFAULT_ZOOM,
                    onLoad: (loadedMap) => {
                        exposeBuildingPreviewMapForDev(loadedMap);
                        if (mapSurfaceRef) {
                            mapSurfaceRef.current = loadedMap;
                        }
                        setIsMapReady(true);
                    },
                });
            } catch (err) {
                console.error("BuildingPreviewMap map init failed:", err);
                return;
            }

            if (cancelled) {
                map.remove();
                return;
            }

            mapRef.current = map;
        })();

        return () => {
            cancelled = true;
            if (typeof window !== "undefined" && IS_DEV) {
                delete (window as unknown as { __buildingPreviewMap?: maplibregl.Map }).__buildingPreviewMap;
            }
            setIsMapReady(false);
            if (mapSurfaceRef?.current === mapRef.current) {
                mapSurfaceRef.current = null;
            }
            mapRef.current?.remove();
            mapRef.current = null;
        };
    }, [clientMounted, mapSurfaceRef]);

    useEffect(() => {
        if (!isMapReady || !containerRef.current || !mapRef.current) {
            return;
        }

        const map = mapRef.current;

        const ro = new ResizeObserver(() => {
            map.resize();
        });

        ro.observe(containerRef.current);

        return () => ro.disconnect();
    }, [isMapReady]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !isMapReady || !map.isStyleLoaded()) {
            return;
        }

        if (geometry) {
            dashDevLog("building:preview:loaded-api-geometry", geometry);
            addBuildingLiveOverlay(map, footprintFeatureCollection(geometry));
            dashDevLog("building:preview:live-overlay-updated");
        } else {
            clearLiveOverlay(map, LIVE_BUILDING_SOURCE_ID);
            dashDevLog("building:preview:live-overlay-cleared-no-selection");
        }

        const bounds = getFootprintBounds(geometry ?? null);

        if (!bounds || !geometry) {
            map.flyTo({
                center: PLACE_MAP_DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
                duration: 450,
            });
            return;
        }

        const areaM2 = footprintAreaSqM(geometry);
        const isLargeFootprint = areaM2 >= LARGE_FOOTPRINT_AREA_M2;

        if (isLargeFootprint) {
            map.fitBounds(bounds, {
                padding: 56,
                maxZoom: LARGE_FIT_MAX_ZOOM,
                duration: 650,
            });
            return;
        }

        const center = bounds.getCenter();

        map.flyTo({
            center: [center.lng, center.lat],
            zoom: SMALL_BUILDING_ZOOM,
            duration: 650,
        });
    }, [isMapReady, geometry]);

    const showEmptyHint = !geometry;

    const viewportClass = className ?? MAP_PREVIEW_VIEWPORT_PLACES_SIDEBAR;

    return (
        <div className="relative">
            {clientMounted ? (
                <div
                    ref={containerRef}
                    className={viewportClass}
                />
            ) : (
                <div className={viewportClass} aria-hidden />
            )}
            {showEmptyHint ? (
                <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded bg-white/90 px-3 py-2 text-sm text-gray-700 shadow">
                    {emptyHint}
                </div>
            ) : null}
        </div>
    );
}
