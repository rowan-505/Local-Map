import type {
    ExpressionSpecification,
    GeoJSONSource,
    LayerSpecification,
    Map as MaplibreMap,
    StyleSpecification,
    VectorTileSource,
} from "maplibre-gl";
import { getMapTextFieldExpression } from "@/src/lib/mapLocalizedName";

const TILE_SERVER_URL = "https://martin-lively-canyon-4077.fly.dev";

/** Request Martin `tiles_buildings_v` from zoom 14 (matches `packages/map-style/base-map.json`). */
export const BUILDINGS_MARTIN_MIN_ZOOM = 14;

const IS_DASHBOARD_DEV = process.env.NODE_ENV !== "production";

/** Martin + MapLibre vector source for OSM and dashboard footprints (tiles.tiles_buildings_v). */
export const MAP_BUILDINGS_VECTOR_SOURCE_ID = "tiles_buildings_v";

/**
 * MapLibre layer id drawing building fills from {@link MAP_BUILDINGS_VECTOR_SOURCE_ID}.
 * Separate from GeoJSON draw/preview overlays (e.g. {@link BUILDING_PREVIEW_FOOTPRINT_SOURCE_ID}).
 */
export const MAP_BUILDINGS_VECTOR_LAYER_ID = "buildings";

/** MVT `source-layer` name from Martin (matches the view/table id). */
export const MAP_BUILDINGS_MVT_SOURCE_LAYER_ID = MAP_BUILDINGS_VECTOR_SOURCE_ID;

/**
 * GeoJSON overlay on BuildingPreviewMap (selected footprint duplicate over basemap fills).
 * Not the Martin vector layer — must be cleared independently on delete so the stale polygon disappears immediately.
 */
export const BUILDING_PREVIEW_FOOTPRINT_SOURCE_ID = "building-preview-footprint";

export const BUILDING_PREVIEW_FILL_LAYER_ID = "building-preview-fill";
export const BUILDING_PREVIEW_OUTLINE_LAYER_ID = "building-preview-outline";

/**
 * GeoJSON source ids used for selected/current building footprints (list preview, editors, overlays).
 * If a source exists on the map instance, callers clear it via {@link clearBuildingSelectionGeoJsonSources}.
 */
export const BUILDING_SELECTION_GEOJSON_SOURCE_IDS = [
    "selected-building",
    "selected-building-geometry",
    "current-building-geometry",
    "building-preview-selected",
    BUILDING_PREVIEW_FOOTPRINT_SOURCE_ID,
] as const;

function emptyPreviewFeatureCollection(): { type: "FeatureCollection"; features: [] } {
    return {
        type: "FeatureCollection",
        features: [],
    };
}

/** Clear the Buildings list preview footprint overlay (instant remove of deleted polygon from local GeoJSON). */
export function clearBuildingPreviewFootprint(map: MaplibreMap | null | undefined): boolean {
    if (!map?.isStyleLoaded()) {
        return false;
    }

    const source = map.getSource(BUILDING_PREVIEW_FOOTPRINT_SOURCE_ID);

    if (!source || source.type !== "geojson") {
        return false;
    }

    (source as GeoJSONSource).setData(emptyPreviewFeatureCollection());
    map.triggerRepaint();
    return true;
}

/**
 * Clears every known GeoJSON building-selection source on this map instance (no-op when missing).
 * Use after delete so local overlays vanish independently of MVT cache.
 *
 * @returns number of sources that were cleared
 */
export function clearBuildingSelectionGeoJsonSources(map: MaplibreMap | null | undefined): number {
    if (!map?.isStyleLoaded()) {
        return 0;
    }

    const emptyFc = emptyPreviewFeatureCollection();
    let cleared = 0;

    for (const id of BUILDING_SELECTION_GEOJSON_SOURCE_IDS) {
        const source = map.getSource(id);

        if (source?.type !== "geojson") {
            continue;
        }

        (source as GeoJSONSource).setData(emptyFc);
        cleared++;
    }

    map.triggerRepaint();
    return cleared;
}

type StyleWithVectorInternals = MaplibreMap["style"] & {
    sourceCaches?: Record<string, { clearTiles?: () => void; update?: (t: MaplibreMap["transform"]) => void }>;
    tileManagers?: Record<string, { clearTiles?: () => void }>;
    _reloadSource?: (id: string) => void;
};

type StyleWithSourceCaches = {
    sourceCaches?: Record<string, { clearTiles?: () => void; update?: (t: MaplibreMap["transform"]) => void }>;
};

/**
 * Clears the internal vector source cache for `sourceId` when present (MapLibre private API),
 * then repaints. No-op if `sourceCaches` is missing (some versions only use `tileManagers`).
 */
export function refreshVectorTileSource(map: MaplibreMap | null | undefined, sourceId: string): void {
    if (!map?.isStyleLoaded()) {
        return;
    }

    const sourceCache = (map.style as unknown as StyleWithSourceCaches).sourceCaches?.[sourceId];

    if (sourceCache?.clearTiles) {
        sourceCache.clearTiles();
    }

    if (sourceCache?.update) {
        sourceCache.update(map.transform);
    }

    map.triggerRepaint();
}

/**
 * Clears cached vector tiles for `sourceId` via `tileManagers` (MapLibre internal).
 * Prefer also calling {@link refreshVectorTileSource} first for `sourceCaches` when available.
 * Returns false if the source is missing or not a vector source.
 */
export function refreshVectorSource(map: MaplibreMap | null | undefined, sourceId: string): boolean {
    if (!map?.isStyleLoaded()) {
        return false;
    }

    const src = map.getSource(sourceId);

    if (!src || src.type !== "vector") {
        return false;
    }

    const style = map.style as StyleWithVectorInternals;
    style.tileManagers?.[sourceId]?.clearTiles?.();
    map.triggerRepaint();

    return true;
}

/** Dev-only: list vector + GeoJSON sources/layers that draw building footprints. */
export function debugLogDashboardBuildingFootprintLayers(map: MaplibreMap | null | undefined): void {
    if (process.env.NODE_ENV === "production" || typeof console.debug !== "function" || !map?.isStyleLoaded()) {
        return;
    }

    const style = map.getStyle();

    const sourceEntries = Object.entries(style.sources ?? {}).filter(([id]) => {
        const s = style.sources[id];
        const spec = typeof s === "object" && s && "url" in s ? (s.url as string | undefined) : "";
        const tiles = typeof s === "object" && s && "tiles" in s ? JSON.stringify((s as { tiles?: unknown }).tiles) : "";
        const blob = `${id} ${spec} ${tiles}`.toLowerCase();
        return (
            id === MAP_BUILDINGS_VECTOR_SOURCE_ID ||
            id.includes("building") ||
            blob.includes("tiles_buildings")
        );
    });

    const layers =
        style.layers?.filter((layer): layer is LayerSpecification =>
            typeof layer === "object" &&
            layer !== null &&
            "id" in layer &&
            typeof (layer as { id?: unknown }).id === "string"
        )
            .map((layer) => ({
                layerId: (layer as { id: string }).id,
                type: (layer as { type?: string }).type ?? "",
                source:
                    typeof (layer as { source?: unknown }).source === "string"
                        ? (layer as { source: string }).source
                        : "",
                sourceLayer: (layer as { "source-layer"?: string })["source-layer"] ?? "",
            })) ?? [];

    const footprintLayers = layers.filter(
        (l) =>
            l.source.includes("building") ||
            l.layerId.includes("building") ||
            l.source === MAP_BUILDINGS_VECTOR_SOURCE_ID
    );

    const vectorBuildingsLayerIds = layers
        .filter((l) => l.source === MAP_BUILDINGS_VECTOR_SOURCE_ID)
        .map((l) => ({ layerId: l.layerId, type: l.type, sourceLayer: l.sourceLayer }));

    console.debug("[dashboard buildings map] sources (footprint-related)", sourceEntries);
    console.debug("[dashboard buildings map] layers (footprint-related)", footprintLayers);
    console.debug(`[dashboard buildings map] layers bound to "${MAP_BUILDINGS_VECTOR_SOURCE_ID}"`, vectorBuildingsLayerIds);
}

/** Martin `tiles_buildings_v` tile URL; always includes `?v=` for cache-busting (default stable `"0"`). */
export function mapBuildingsTileUrl(version: string | number = "0"): string {
    const path = `${TILE_SERVER_URL}/tiles_buildings_v/{z}/{x}/{y}`;
    return `${path}?v=${encodeURIComponent(String(version))}`;
}

/**
 * Clears in-memory vector tiles and reloads the unified buildings source (`MAP_BUILDINGS_VECTOR_SOURCE_ID`).
 * Pass `buildingTileVersion` so the MVT URL query matches app state; when omitted, uses `Date.now()` once per call.
 */
export function refreshBuildingTiles(
    map: MaplibreMap | null | undefined,
    buildingTileVersion?: string | number
): boolean {
    if (!map?.isStyleLoaded()) {
        return false;
    }

    const sourceId = MAP_BUILDINGS_VECTOR_SOURCE_ID;
    const src = map.getSource(sourceId);

    if (!src || src.type !== "vector") {
        return false;
    }

    const version = buildingTileVersion ?? Date.now();

    if (typeof console !== "undefined" && typeof console.info === "function" && IS_DASHBOARD_DEV) {
        console.info("building tile source id", sourceId);
    }

    try {
        refreshVectorTileSource(map, sourceId);
        refreshVectorSource(map, sourceId);

        if (typeof console !== "undefined" && typeof console.info === "function" && IS_DASHBOARD_DEV) {
            console.info("building vector tile source refreshed");
        }

        const bustUrl = mapBuildingsTileUrl(version);
        (src as VectorTileSource).setTiles([bustUrl]);
        map.triggerRepaint();

        if (typeof console !== "undefined" && typeof console.info === "function" && IS_DASHBOARD_DEV) {
            console.info("building tile cache busted");
        }

        /* setTiles already triggers async load(true); _reloadSource resumes the pyramid after that pass. */
        requestAnimationFrame(() => {
            const styleReload = map.style as StyleWithVectorInternals;

            try {
                styleReload._reloadSource?.(sourceId);
            } catch {
                /* ignore */
            }

            refreshVectorTileSource(map, sourceId);
            styleReload.tileManagers?.[sourceId]?.clearTiles?.();
            map.triggerRepaint();
        });

        return true;
    } catch {
        return false;
    }
}

/**
 * Runs {@link refreshBuildingTiles} immediately and on the next microtask / two animation frames so
 * Martin-backed tiles can repopulate after mutations (helps when navigation or paint would otherwise skip a pass).
 * When `buildingTileVersion` is omitted, pins one `Date.now()` for every pass in this batch.
 */
export function scheduleBuildingTileRefresh(
    map: MaplibreMap | null | undefined,
    buildingTileVersion?: string | number
): boolean {
    const version = buildingTileVersion ?? Date.now();
    const primaryOk = refreshBuildingTiles(map, version);

    queueMicrotask(() => {
        refreshBuildingTiles(map, version);
    });

    requestAnimationFrame(() => {
        refreshBuildingTiles(map, version);
        requestAnimationFrame(() => {
            refreshBuildingTiles(map, version);
        });
    });

    return primaryOk;
}

/**
 * @deprecated Prefer {@link refreshBuildingTiles}.
 */
export function reloadMapBuildingsVectorTiles(map: MaplibreMap): boolean {
    return refreshBuildingTiles(map);
}

const LABEL_TEXT_MY = getMapTextFieldExpression("my") as ExpressionSpecification;

export const PLACE_MAP_STYLE: StyleSpecification = {
    version: 8,
    name: "Local Map Natural",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
        streets: {
            type: "vector",
            tiles: [`${TILE_SERVER_URL}/tiles_streets_v/{z}/{x}/{y}`],
            minzoom: 0,
            maxzoom: 22,
        },
        tiles_places_v: {
            type: "vector",
            tiles: [`${TILE_SERVER_URL}/tiles_places_v/{z}/{x}/{y}`],
            minzoom: 0,
            maxzoom: 22,
        },
        tiles_water_polygons_v: {
            type: "vector",
            tiles: [`${TILE_SERVER_URL}/tiles_water_polygons_v/{z}/{x}/{y}`],
            minzoom: 0,
            maxzoom: 22,
        },
        tiles_landuse_v: {
            type: "vector",
            tiles: [`${TILE_SERVER_URL}/tiles_landuse_v/{z}/{x}/{y}`],
            minzoom: 0,
            maxzoom: 22,
        },
        tiles_water_lines_v: {
            type: "vector",
            tiles: [`${TILE_SERVER_URL}/tiles_water_lines_v/{z}/{x}/{y}`],
            minzoom: 0,
            maxzoom: 22,
        },
        [MAP_BUILDINGS_VECTOR_SOURCE_ID]: {
            type: "vector",
            tiles: [mapBuildingsTileUrl()],
            minzoom: BUILDINGS_MARTIN_MIN_ZOOM,
            maxzoom: 22,
        },
        tiles_road_labels_v: {
            type: "vector",
            tiles: [`${TILE_SERVER_URL}/tiles_road_labels_v/{z}/{x}/{y}`],
            minzoom: 0,
            maxzoom: 22,
        },
        tiles_bus_stops_v: {
            type: "vector",
            tiles: [`${TILE_SERVER_URL}/tiles_bus_stops_v/{z}/{x}/{y}`],
            minzoom: 0,
            maxzoom: 22,
        },
        tiles_bus_route_variants_v: {
            type: "vector",
            tiles: [`${TILE_SERVER_URL}/tiles_bus_route_variants_v/{z}/{x}/{y}`],
            minzoom: 0,
            maxzoom: 22,
        },
        "core_admin_areas.1": {
            type: "vector",
            tiles: [`${TILE_SERVER_URL}/tiles_admin_areas_v.1/{z}/{x}/{y}`],
            minzoom: 0,
            maxzoom: 22,
        },
    },
    layers: [
        {
            id: "background",
            type: "background",
            paint: {
                "background-color": "#f3f4f1",
            },
        },
        {
            id: "landuse",
            type: "fill",
            source: "tiles_landuse_v",
            "source-layer": "tiles_landuse_v",
            paint: {
                "fill-color": "#d9ead3",
                "fill-opacity": 0.55,
            },
        },
        {
            id: "water-polygons",
            type: "fill",
            source: "tiles_water_polygons_v",
            "source-layer": "tiles_water_polygons_v",
            paint: {
                "fill-color": "#a7d8f0",
                "fill-opacity": 0.95,
            },
        },
        {
            id: "water-lines",
            type: "line",
            source: "tiles_water_lines_v",
            "source-layer": "tiles_water_lines_v",
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#8cc9e8",
                "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 14, 1.8, 18, 4],
                "line-opacity": 0.8,
            },
        },
        {
            id: "buildings",
            type: "fill",
            source: MAP_BUILDINGS_VECTOR_SOURCE_ID,
            "source-layer": MAP_BUILDINGS_VECTOR_SOURCE_ID,
            minzoom: BUILDINGS_MARTIN_MIN_ZOOM,
            paint: {
                "fill-color": "#ded8cf",
                "fill-opacity": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    BUILDINGS_MARTIN_MIN_ZOOM,
                    0.48,
                    17,
                    0.72,
                    22,
                    0.72,
                ],
                "fill-outline-color": "#c7beb2",
            },
        },
        {
            id: "admin-boundaries",
            type: "line",
            source: "core_admin_areas.1",
            "source-layer": "core_admin_areas.1",
            paint: {
                "line-color": "#8d948c",
                "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 14, 1.2, 18, 2],
                "line-opacity": 0.45,
                "line-dasharray": [3, 3],
            },
        },
        {
            id: "bus-routes",
            type: "line",
            source: "tiles_bus_route_variants_v",
            "source-layer": "tiles_bus_route_variants_v",
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#d97706",
                "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 14, 2.6, 18, 5],
                "line-opacity": 0.65,
            },
        },
        {
            id: "streets-casing",
            type: "line",
            source: "streets",
            "source-layer": "tiles_streets_v",
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#ffffff",
                "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 3, 18, 6],
                "line-opacity": 0.6,
            },
        },
        {
            id: "streets-line",
            type: "line",
            source: "streets",
            "source-layer": "tiles_streets_v",
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#6b7280",
                "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 14, 1.5, 18, 4],
                "line-opacity": 0.8,
            },
        },
        {
            id: "places-poi",
            type: "circle",
            source: "tiles_places_v",
            "source-layer": "tiles_places_v",
            minzoom: 14,
            paint: {
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.5, 17, 4.5, 20, 7],
                "circle-color": "#3aa76d",
                "circle-opacity": 0.85,
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 1.2,
            },
        },
        {
            id: "bus-stops",
            type: "circle",
            source: "tiles_bus_stops_v",
            "source-layer": "tiles_bus_stops_v",
            minzoom: 14,
            paint: {
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3, 17, 4.5, 20, 7],
                "circle-color": "#f2a900",
                "circle-opacity": 0.95,
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 1.4,
            },
        },
        {
            id: "road-labels",
            type: "symbol",
            source: "tiles_road_labels_v",
            "source-layer": "tiles_road_labels_v",
            minzoom: 13,
            layout: {
                "symbol-placement": "line",
                "text-field": LABEL_TEXT_MY,
                "text-font": ["Noto Sans Regular"],
                "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 17, 12, 20, 15],
                "text-padding": 3,
                "text-rotation-alignment": "map",
            },
            paint: {
                "text-color": "#626a70",
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.4,
            },
        },
        {
            id: "place-labels",
            type: "symbol",
            source: "tiles_places_v",
            "source-layer": "tiles_places_v",
            minzoom: 14,
            layout: {
                "text-field": LABEL_TEXT_MY,
                "text-font": ["Noto Sans Regular"],
                "text-size": ["interpolate", ["linear"], ["zoom"], 14, 11, 17, 13, 20, 16],
                "text-offset": [0, 1],
                "text-anchor": "top",
                "text-padding": 4,
                "text-optional": true,
            },
            paint: {
                "text-color": "#374151",
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.5,
            },
        },
    ],
};

/**
 * Same basemap as {@link PLACE_MAP_STYLE} but omits Martin bus stop / bus route vector
 * sources and layers. Use on **Buildings** admin routes so failing `tiles_bus_stops_v` does
 * not request tiles at all (see `attachDashboardMapErrorHandler` for remaining soft failures).
 */
export const PLACE_MAP_STYLE_BUILDINGS: StyleSpecification = (() => {
    const sources = { ...PLACE_MAP_STYLE.sources } as Record<string, (typeof PLACE_MAP_STYLE.sources)[string]>;
    delete sources.tiles_bus_stops_v;
    delete sources.tiles_bus_route_variants_v;

    return {
        ...PLACE_MAP_STYLE,
        name: "Local Map Natural (buildings)",
        sources: sources as StyleSpecification["sources"],
        layers: PLACE_MAP_STYLE.layers.filter(
            (layer) => !("id" in layer) || (layer.id !== "bus-routes" && layer.id !== "bus-stops")
        ),
    };
})();

export const PLACE_MAP_DEFAULT_CENTER: [number, number] = [96.3242, 16.6395];
