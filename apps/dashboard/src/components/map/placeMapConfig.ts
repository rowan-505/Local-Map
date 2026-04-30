import type { StyleSpecification } from "maplibre-gl";

const MARTIN_TILE_BASE_URL = "https://dynamic-martin-vector-tiles.onrender.com";

export const PLACE_MAP_STYLE: StyleSpecification = {
    version: 8,
    sources: {
        roads: {
            type: "vector",
            tiles: [`${MARTIN_TILE_BASE_URL}/tiles_roads_v/{z}/{x}/{y}`],
        },
    },
    layers: [
        {
            id: "background",
            type: "background",
            paint: {
                "background-color": "#eef1f5",
            },
        },
        {
            id: "road-casing",
            type: "line",
            source: "roads",
            "source-layer": "tiles_roads_v",
            minzoom: 8,
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#c6ccd4",
                "line-width": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    8,
                    1.2,
                    12,
                    3,
                    16,
                    8,
                ],
            },
        },
        {
            id: "roads",
            type: "line",
            source: "roads",
            "source-layer": "tiles_roads_v",
            minzoom: 8,
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#ffffff",
                "line-width": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    8,
                    0.7,
                    12,
                    2,
                    16,
                    6,
                ],
            },
        },
    ],
};

export const PLACE_MAP_DEFAULT_CENTER: [number, number] = [96.3242, 16.6395];
