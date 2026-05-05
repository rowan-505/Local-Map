import type {
    ExpressionSpecification,
    Map as MaplibreMap,
    StyleSpecification,
    VectorTileSource,
} from "maplibre-gl";
import { getMapTextFieldExpression } from "@local-map/localized-name";

const TILE_SERVER_URL = "https://martin-lively-canyon-4077.fly.dev";

/** Martin + MapLibre vector source for OSM and dashboard footprints (tiles.tiles_buildings_v). */
export const MAP_BUILDINGS_VECTOR_SOURCE_ID = "tiles_buildings_v";

export function mapBuildingsTileUrl(cacheBust?: string): string {
    const path = `${TILE_SERVER_URL}/tiles_buildings_v/{z}/{x}/{y}`;
    return cacheBust ? `${path}?v=${encodeURIComponent(cacheBust)}` : path;
}

/**
 * Busts the browser tile cache for the unified buildings layer (use after creating/editing via API).
 * No-op if the style does not include `MAP_BUILDINGS_VECTOR_SOURCE_ID`.
 */
export function reloadMapBuildingsVectorTiles(map: MaplibreMap): boolean {
    const src = map.getSource(MAP_BUILDINGS_VECTOR_SOURCE_ID);

    if (!src || src.type !== "vector") {
        return false;
    }

    (src as VectorTileSource).setTiles([mapBuildingsTileUrl(String(Date.now()))]);
    map.triggerRepaint();
    return true;
}

const LABEL_TEXT_MY = getMapTextFieldExpression("my") as ExpressionSpecification;

export const PLACE_MAP_STYLE: StyleSpecification = {
    version: 8,
    name: "Local Map Natural",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
        core_streets: {
            type: "vector",
            tiles: [`${TILE_SERVER_URL}/core_streets/{z}/{x}/{y}`],
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
        core_map_water_lines: {
            type: "vector",
            tiles: [`${TILE_SERVER_URL}/core_map_water_lines/{z}/{x}/{y}`],
            minzoom: 0,
            maxzoom: 22,
        },
        [MAP_BUILDINGS_VECTOR_SOURCE_ID]: {
            type: "vector",
            tiles: [mapBuildingsTileUrl()],
            minzoom: 0,
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
            tiles: [`${TILE_SERVER_URL}/core_admin_areas.1/{z}/{x}/{y}`],
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
            source: "core_map_water_lines",
            "source-layer": "core_map_water_lines",
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
            /** Keep OSM + dashboard footprints visible from regional zoom; matches `packages/map-style/base-map.json`. */
            minzoom: 0,
            paint: {
                "fill-color": "#ded8cf",
                "fill-opacity": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    10,
                    0.22,
                    14,
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
            id: "roads-casing",
            type: "line",
            source: "core_streets",
            "source-layer": "core_streets",
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#ffffff",
                "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 13, 3.5, 16, 7, 19, 13],
                "line-opacity": 0.9,
            },
        },
        {
            id: "roads",
            type: "line",
            source: "core_streets",
            "source-layer": "core_streets",
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#b6b8b5",
                "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 13, 1.8, 16, 4, 19, 8],
                "line-opacity": 0.96,
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

export const PLACE_MAP_DEFAULT_CENTER: [number, number] = [96.3242, 16.6395];
