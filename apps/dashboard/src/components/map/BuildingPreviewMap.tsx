"use client";

/**
 * Buildings list preview map (dashboard `/buildings`): basemap polygons + GeoJSON footprint overlay.
 *
 * Footprint pipelines on this widget:
 * - Vector MVT: style source id {@link MAP_BUILDINGS_VECTOR_SOURCE_ID} (`tiles_buildings_v`),
 *   fill layer id `buildings` → DB view `tiles.tiles_buildings_v` via Martin.
 * - Selected footprint GeoJSON overlay: {@link BUILDING_PREVIEW_FOOTPRINT_SOURCE_ID}, layers
 *   {@link BUILDING_PREVIEW_FILL_LAYER_ID} / {@link BUILDING_PREVIEW_OUTLINE_LAYER_ID}.
 * Edit pages use BuildingEditorMap `current-building-geometry*` — not rendered here.
 */
import area from "@turf/area";
import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as MaplibreMap } from "maplibre-gl";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import { createPlaceBaseMap } from "./createPlaceBaseMap";
import { MAP_PREVIEW_VIEWPORT_PLACES_SIDEBAR } from "./mapPreviewUi";
import {
    BUILDING_PREVIEW_FILL_LAYER_ID,
    BUILDING_PREVIEW_FOOTPRINT_SOURCE_ID,
    BUILDING_PREVIEW_OUTLINE_LAYER_ID,
    PLACE_MAP_DEFAULT_CENTER,
} from "./placeMapConfig";
import type { BuildingGeometry } from "@/src/lib/api";

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

const SOURCE_ID = BUILDING_PREVIEW_FOOTPRINT_SOURCE_ID;
const FILL_LAYER_ID = BUILDING_PREVIEW_FILL_LAYER_ID;
const LINE_LAYER_ID = BUILDING_PREVIEW_OUTLINE_LAYER_ID;

const IS_DEV = process.env.NODE_ENV === "development";

/** Same palette as `PLACE_MAP_STYLE` `buildings` fill — slightly higher opacity + stronger outline for focus. */
const PREVIEW_FILL_COLOR = "#ded8cf";
const PREVIEW_FILL_OPACITY = 0.82;
const PREVIEW_LINE_COLOR = "#a39282";
const PREVIEW_LINE_WIDTH = 2;

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

/**
 * Admin **Buildings** preview: same vector basemap as Places (`PLACE_MAP_STYLE`), no satellite.
 * Selected footprint uses fill + outline styled like tile buildings, with slightly stronger contrast.
 */
export default function BuildingPreviewMap({
    geometry,
    emptyHint = "No geometry available for this building.",
    className,
    mapSurfaceRef,
}: BuildingPreviewMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [isMapReady, setIsMapReady] = useState(false);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) {
            return;
        }

        const map = createPlaceBaseMap(containerRef.current, {
            zoom: DEFAULT_ZOOM,
            includeBusTransitLayers: false,
        });
        mapRef.current = map;

        const onLoad = () => {
            map.addSource(SOURCE_ID, {
                type: "geojson",
                data: emptyFeatureCollection(),
            });

            map.addLayer({
                id: FILL_LAYER_ID,
                type: "fill",
                source: SOURCE_ID,
                paint: {
                    "fill-color": PREVIEW_FILL_COLOR,
                    "fill-opacity": PREVIEW_FILL_OPACITY,
                },
            });

            map.addLayer({
                id: LINE_LAYER_ID,
                type: "line",
                source: SOURCE_ID,
                paint: {
                    "line-color": PREVIEW_LINE_COLOR,
                    "line-width": PREVIEW_LINE_WIDTH,
                },
            });

            exposeBuildingPreviewMapForDev(map);
            if (mapSurfaceRef) {
                mapSurfaceRef.current = map;
            }
            setIsMapReady(true);
        };

        map.on("load", onLoad);

        return () => {
            map.off("load", onLoad);
            if (typeof window !== "undefined" && IS_DEV) {
                delete (window as unknown as { __buildingPreviewMap?: maplibregl.Map }).__buildingPreviewMap;
            }
            setIsMapReady(false);
            if (mapSurfaceRef?.current === map) {
                mapSurfaceRef.current = null;
            }
            map.remove();
            mapRef.current = null;
        };
    }, [mapSurfaceRef]);

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

        if (!map || !isMapReady) {
            return;
        }

        const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;

        if (!source) {
            return;
        }

        source.setData(footprintFeatureCollection(geometry ?? null));

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

    return (
        <div className="relative">
            <div
                ref={containerRef}
                className={className ?? MAP_PREVIEW_VIEWPORT_PLACES_SIDEBAR}
            />
            {showEmptyHint ? (
                <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded bg-white/90 px-3 py-2 text-sm text-gray-700 shadow">
                    {emptyHint}
                </div>
            ) : null}
        </div>
    );
}
