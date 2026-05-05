"use client";

import maplibregl from "maplibre-gl";

import { attachDashboardMapErrorHandler } from "./mapErrorHandlers";
import { PLACE_MAP_DEFAULT_CENTER, PLACE_MAP_STYLE, PLACE_MAP_STYLE_BUILDINGS } from "./placeMapConfig";

type CreatePlaceBaseMapOptions = {
    zoom: number;
    minZoom?: number;
    maxZoom?: number;
    /**
     * When false, omits Martin bus stop / bus route vector layers (use on Buildings admin maps).
     * Default true for place pickers and place preview.
     */
    includeBusTransitLayers?: boolean;
    onLoad?: (map: maplibregl.Map) => void;
};

export function createPlaceBaseMap(
    container: HTMLDivElement,
    options: CreatePlaceBaseMapOptions
) {
    const includeBus =
        options.includeBusTransitLayers !== undefined ? options.includeBusTransitLayers : true;

    const map = new maplibregl.Map({
        container,
        style: includeBus ? PLACE_MAP_STYLE : PLACE_MAP_STYLE_BUILDINGS,
        center: PLACE_MAP_DEFAULT_CENTER,
        zoom: options.zoom ?? 15,
        minZoom: options.minZoom ?? 0,
        maxZoom: options.maxZoom ?? 22,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    attachDashboardMapErrorHandler(map, "createPlaceBaseMap");

    if (options.onLoad) {
        map.on("load", () => {
            options.onLoad?.(map);
        });
    }

    return map;
}
