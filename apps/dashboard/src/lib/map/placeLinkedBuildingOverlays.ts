import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { GeoJSONSource, type Map as MaplibreMap, type PointLike } from "maplibre-gl";

export const PLACE_LINK_SELECTED_SOURCE = "place-link-selected" as const;
export const PLACE_LINK_SELECTED_FILL = "place-link-selected-fill" as const;
export const PLACE_LINK_SELECTED_LINE = "place-link-selected-line" as const;

/** Used by PlacePointMapPicker to avoid moving the place marker when clicking the highlight. */
export const PLACE_LINK_INTERACTIVE_LAYER_IDS = [
    PLACE_LINK_SELECTED_FILL,
    PLACE_LINK_SELECTED_LINE,
] as const;

export type PlaceLinkSelectedProperties = {
    public_id: string;
};

function emptyFeatureCollection(): FeatureCollection {
    return { type: "FeatureCollection", features: [] };
}

function ensureSelectedSource(map: MaplibreMap): boolean {
    if (map.getSource(PLACE_LINK_SELECTED_SOURCE)) {
        return true;
    }

    try {
        map.addSource(PLACE_LINK_SELECTED_SOURCE, {
            type: "geojson",
            data: emptyFeatureCollection(),
        });
        return Boolean(map.getSource(PLACE_LINK_SELECTED_SOURCE));
    } catch {
        return false;
    }
}

function ensureSelectedLayers(map: MaplibreMap): boolean {
    if (!ensureSelectedSource(map)) {
        return false;
    }

    try {
        if (!map.getLayer(PLACE_LINK_SELECTED_FILL)) {
            map.addLayer({
                id: PLACE_LINK_SELECTED_FILL,
                type: "fill",
                source: PLACE_LINK_SELECTED_SOURCE,
                paint: {
                    "fill-color": "#6366f1",
                    "fill-opacity": 0.55,
                },
            });
        }

        if (!map.getLayer(PLACE_LINK_SELECTED_LINE)) {
            map.addLayer({
                id: PLACE_LINK_SELECTED_LINE,
                type: "line",
                source: PLACE_LINK_SELECTED_SOURCE,
                paint: {
                    "line-color": "#4338ca",
                    "line-width": 3.5,
                },
            });
        }

        return Boolean(map.getLayer(PLACE_LINK_SELECTED_FILL) && map.getLayer(PLACE_LINK_SELECTED_LINE));
    } catch {
        return false;
    }
}

/** Idempotent: creates the selected-building source and layers once. Does not set feature data. */
export function ensurePlaceLinkMapLayers(map: MaplibreMap): boolean {
    if (!map.isStyleLoaded()) {
        return false;
    }

    return ensureSelectedLayers(map);
}

function setSourceData<T extends GeoJsonProperties>(
    map: MaplibreMap,
    geojson: FeatureCollection<Geometry, T>,
): void {
    if (!map.isStyleLoaded() || !ensurePlaceLinkMapLayers(map)) {
        return;
    }

    const source = map.getSource(PLACE_LINK_SELECTED_SOURCE);
    if (source instanceof GeoJSONSource) {
        source.setData(geojson);
    }
}

export function setPlaceLinkSelected(
    map: MaplibreMap,
    geojson: FeatureCollection<Geometry, PlaceLinkSelectedProperties>,
): void {
    setSourceData(map, geojson);
}

export function clearPlaceLinkOverlays(map: MaplibreMap | null): void {
    if (!map?.isStyleLoaded()) {
        return;
    }

    setPlaceLinkSelected(
        map,
        emptyFeatureCollection() as FeatureCollection<Geometry, PlaceLinkSelectedProperties>,
    );
}

export function isPlaceLinkOverlayHit(map: MaplibreMap, point: PointLike): boolean {
    if (!map.isStyleLoaded()) {
        return false;
    }

    const layers = PLACE_LINK_INTERACTIVE_LAYER_IDS.filter((id) => Boolean(map.getLayer(id)));
    if (layers.length === 0) {
        return false;
    }

    try {
        return map.queryRenderedFeatures(point, { layers }).length > 0;
    } catch {
        return false;
    }
}
