"use client";

import maplibregl from "maplibre-gl";

import { PLACE_MAP_DEFAULT_CENTER, PLACE_MAP_STYLE } from "./placeMapConfig";

type CreatePlaceBaseMapOptions = {
    zoom: number;
    minZoom?: number;
    maxZoom?: number;
    onLoad?: (map: maplibregl.Map) => void;
};

export function createPlaceBaseMap(
    container: HTMLDivElement,
    options: CreatePlaceBaseMapOptions
) {
    const map = new maplibregl.Map({
        container,
        style: PLACE_MAP_STYLE,
        center: PLACE_MAP_DEFAULT_CENTER,
        zoom: options.zoom ?? 15,
        minZoom: options.minZoom,
        maxZoom: options.maxZoom,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("error", (event) => {
        console.error("createPlaceBaseMap map error:", event.error ?? event);
    });

    if (options.onLoad) {
        map.on("load", () => {
            options.onLoad?.(map);
        });
    }

    return map;
}
