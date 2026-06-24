import type { Geometry, LineString, MultiLineString, MultiPoint, Point, Polygon, MultiPolygon } from "geojson";
import maplibregl from "maplibre-gl";

import { PLACE_MAP_DEFAULT_CENTER } from "./placeMapConfig";

export type DataReviewBasemapMode = "map" | "satellite" | "hybrid";

const DEFAULT_ZOOM = 12;
const POINT_ZOOM = 16;
const LINE_MAX_ZOOM = 17;

export const DATA_REVIEW_SATELLITE_SOURCE_ID = "data-review-satellite";
export const DATA_REVIEW_SATELLITE_LAYER_ID = "data-review-satellite";

const SATELLITE_TILES = [
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
] as const;

const SATELLITE_RASTER_MAX_ZOOM = 19;

/** Vector layers toggled for map / satellite / hybrid modes (PMTiles + Martin place style). */
export const DATA_REVIEW_PREVIEW_VECTOR_LAYERS = [
    "landuse",
    "water-polygons",
    "water-lines",
    "admin-boundaries",
    "admin-labels",
    "village-labels",
    "road-major-casing",
    "road-major-fill",
    "road-medium-casing",
    "road-medium-fill",
    "road-local-casing",
    "road-local-fill",
    "road-minor-casing",
    "road-minor-fill",
    "buildings",
    "road-labels",
] as const;

const HYBRID_OFF_LAYERS = new Set([
    "landuse",
    "water-polygons",
    "water-lines",
    "admin-boundaries",
    "admin-labels",
    "village-labels",
    "buildings",
]);

/** PMTiles base layers in merged dashboard editor style (`fetchDashboardPlaceMapStyle`). */
export const DASHBOARD_MERGED_BASE_MAP_LAYERS = [
    "basemap-background",
    "basemap-landuse",
    "basemap-water-polygons",
    "basemap-water-lines",
] as const;

/** Hidden in pure satellite on merged editor maps; roads/POI stay for hybrid/map. */
export const DASHBOARD_MERGED_SATELLITE_HIDE_VECTOR_LAYERS = [
    "basemap-admin-boundaries",
    "basemap-road-major-casing",
    "basemap-road-major-fill",
    "basemap-road-medium-casing",
    "basemap-road-medium-fill",
    "basemap-road-local-casing",
    "basemap-road-local-fill",
    "basemap-road-minor-casing",
    "basemap-road-minor-fill",
    "basemap-buildings",
    "bus-routes",
    "streets-casing",
    "streets-line",
    "places-poi",
    "bus-stops",
    "road-labels",
    "place-labels",
] as const;

const SATELLITE_INSERT_BEFORE_CANDIDATES = [
    "landuse",
    "basemap-landuse",
    "basemap-background",
    "basemap-water-polygons",
] as const;

function setLayerVisibility(map: maplibregl.Map, layerId: string, visible: boolean) {
    if (!map.getLayer(layerId)) {
        return;
    }
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

export function applyDataReviewBasemapMode(map: maplibregl.Map, mode: DataReviewBasemapMode) {
    if (!map.getLayer(DATA_REVIEW_SATELLITE_LAYER_ID)) {
        return;
    }

    const imageryOn = mode !== "map";
    setLayerVisibility(map, DATA_REVIEW_SATELLITE_LAYER_ID, imageryOn);

    if (!imageryOn) {
        for (const id of DATA_REVIEW_PREVIEW_VECTOR_LAYERS) {
            setLayerVisibility(map, id, true);
        }
        return;
    }

    if (mode === "satellite") {
        for (const id of DATA_REVIEW_PREVIEW_VECTOR_LAYERS) {
            setLayerVisibility(map, id, false);
        }
        return;
    }

    for (const id of DATA_REVIEW_PREVIEW_VECTOR_LAYERS) {
        const on = !HYBRID_OFF_LAYERS.has(id);
        setLayerVisibility(map, id, on);
    }
}

/** Merged dashboard editor style (buildings, streets, place pickers with Martin layers). */
export function applyDashboardMergedBasemapMode(map: maplibregl.Map, mode: DataReviewBasemapMode) {
    if (!map.getLayer(DATA_REVIEW_SATELLITE_LAYER_ID)) {
        return;
    }

    const imageryOn = mode !== "map";
    const hideBaseMap = imageryOn;
    const hideVectorOverlays = mode === "satellite";

    setLayerVisibility(map, DATA_REVIEW_SATELLITE_LAYER_ID, imageryOn);

    for (const id of DASHBOARD_MERGED_BASE_MAP_LAYERS) {
        setLayerVisibility(map, id, !hideBaseMap);
    }

    for (const id of DASHBOARD_MERGED_SATELLITE_HIDE_VECTOR_LAYERS) {
        setLayerVisibility(map, id, !hideVectorOverlays);
    }
}

function isFillLikeLayer(layerType: string): boolean {
    return layerType === "fill" || layerType === "fill-extrusion";
}

function safeStyleLayers(map: maplibregl.Map): { id: string; type: string }[] {
    try {
        return (map.getStyle().layers ?? []) as { id: string; type: string }[];
    } catch {
        return [];
    }
}

/**
 * Map / Sat / Hyb for the composed PMTiles preview style (overview + regional, and
 * the dev all-region QA style) used by {@link createPreviewBaseMap}.
 *
 * Unlike {@link applyDataReviewBasemapMode} — which toggles a fixed list of regional
 * layer ids and therefore misses overview layers and split label ids — this classifies
 * the style's layers dynamically so every basemap layer is handled regardless of how the
 * style was composed:
 *
 *   map       → all basemap layers visible, satellite hidden
 *   satellite → all basemap layers hidden, satellite visible (clean imagery)
 *   hybrid    → satellite + basemap line/symbol layers (roads + labels); fills hidden
 *
 * `overlayLayerIds` (e.g. transport route / stop / vertex overlays) and `background`
 * are never hidden, and overlays are re-raised above the satellite raster so they stay
 * visible in every mode.
 *
 * Returns `false` when the satellite layer is unavailable (caller can surface a graceful
 * "imagery unavailable" note); in that case the vector basemap is left fully visible.
 */
export function applyPreviewCompositeBasemapMode(
    map: maplibregl.Map,
    mode: DataReviewBasemapMode,
    options: { overlayLayerIds: readonly string[] },
): boolean {
    const satId = DATA_REVIEW_SATELLITE_LAYER_ID;
    const overlay = new Set<string>(options.overlayLayerIds);

    if (!map.getLayer(satId)) {
        // Satellite raster unavailable — keep the vector basemap fully visible.
        for (const layer of safeStyleLayers(map)) {
            if (layer.id === "background" || overlay.has(layer.id)) {
                continue;
            }
            setLayerVisibility(map, layer.id, true);
        }
        return false;
    }

    const imageryOn = mode !== "map";
    setLayerVisibility(map, satId, imageryOn);

    const protectedIds = new Set<string>([satId, "background", ...options.overlayLayerIds]);
    for (const layer of safeStyleLayers(map)) {
        if (protectedIds.has(layer.id)) {
            continue;
        }
        let visible: boolean;
        if (mode === "map") {
            visible = true;
        } else if (mode === "satellite") {
            visible = false;
        } else {
            // hybrid: keep roads + labels (line/symbol/circle), hide fills.
            visible = !isFillLikeLayer(layer.type);
        }
        setLayerVisibility(map, layer.id, visible);
    }

    if (imageryOn) {
        for (const id of options.overlayLayerIds) {
            if (map.getLayer(id)) {
                map.moveLayer(id);
            }
        }
    }
    return true;
}

function satelliteInsertBeforeId(map: maplibregl.Map): string | undefined {
    for (const id of SATELLITE_INSERT_BEFORE_CANDIDATES) {
        if (map.getLayer(id)) {
            return id;
        }
    }
    return undefined;
}

export function ensureDataReviewSatelliteLayer(map: maplibregl.Map) {
    if (map.getSource(DATA_REVIEW_SATELLITE_SOURCE_ID)) {
        return;
    }

    map.addSource(DATA_REVIEW_SATELLITE_SOURCE_ID, {
        type: "raster",
        tiles: [...SATELLITE_TILES],
        tileSize: 256,
        maxzoom: SATELLITE_RASTER_MAX_ZOOM,
        attribution:
            '<a href="https://www.esri.com/">© Esri</a> — Sources: Esri, Maxar, Earthstar Geographics',
    });

    if (!map.getLayer(DATA_REVIEW_SATELLITE_LAYER_ID)) {
        const beforeId = satelliteInsertBeforeId(map);
        map.addLayer(
            {
                id: DATA_REVIEW_SATELLITE_LAYER_ID,
                type: "raster",
                source: DATA_REVIEW_SATELLITE_SOURCE_ID,
                layout: { visibility: "none" },
                paint: {
                    "raster-opacity": 1,
                    "raster-resampling": "linear",
                },
            },
            beforeId,
        );
    }
}

function firstMultiPointCoord(g: MultiPoint): [number, number] | null {
    const c = g.coordinates[0];
    if (!c || typeof c[0] !== "number" || typeof c[1] !== "number") {
        return null;
    }
    return [c[0], c[1]];
}

function getPolygonBounds(geometry: Polygon | MultiPolygon): maplibregl.LngLatBounds | null {
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

function getLineBounds(geometry: LineString | MultiLineString): maplibregl.LngLatBounds | null {
    const bounds = new maplibregl.LngLatBounds();
    const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
    for (const line of lines) {
        for (const coordinate of line) {
            bounds.extend([coordinate[0], coordinate[1]]);
        }
    }
    return bounds.isEmpty() ? null : bounds;
}

function getPointKindBounds(g: Point | MultiPoint): maplibregl.LngLatBounds | null {
    const bounds = new maplibregl.LngLatBounds();
    if (g.type === "Point") {
        const c = g.coordinates;
        if (typeof c[0] === "number" && typeof c[1] === "number") {
            bounds.extend([c[0], c[1]]);
        }
    } else {
        for (const c of g.coordinates) {
            if (typeof c[0] === "number" && typeof c[1] === "number") {
                bounds.extend([c[0], c[1]]);
            }
        }
    }
    return bounds.isEmpty() ? null : bounds;
}

export type DataReviewGeometryKind = "point" | "polygon" | "line";

export function fitMapToReviewCandidate(
    map: maplibregl.Map,
    g: Geometry,
    geometryKind: DataReviewGeometryKind,
    opts?: { duration?: number },
) {
    const duration = opts?.duration ?? 600;

    if (geometryKind === "point") {
        let lng: number | undefined;
        let lat: number | undefined;
        if (g.type === "Point" && Array.isArray(g.coordinates)) {
            lng = Number(g.coordinates[0]);
            lat = Number(g.coordinates[1]);
        } else if (g.type === "MultiPoint") {
            const pair = firstMultiPointCoord(g);
            if (pair) {
                lng = pair[0];
                lat = pair[1];
            }
        }

        if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng + lat)) {
            map.flyTo({ center: PLACE_MAP_DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration });
            return;
        }

        if (g.type === "MultiPoint" && g.coordinates.length > 1) {
            const b = getPointKindBounds(g);
            if (b) {
                const ne = b.getNorthEast();
                const sw = b.getSouthWest();
                const same = ne.lng === sw.lng && ne.lat === sw.lat;
                if (same) {
                    map.flyTo({ center: [lng, lat], zoom: POINT_ZOOM, duration });
                } else {
                    map.fitBounds(b, { padding: 48, maxZoom: 18, duration });
                }
                return;
            }
        }

        map.flyTo({
            center: [lng, lat],
            zoom: POINT_ZOOM,
            duration,
        });
        return;
    }

    if (geometryKind === "polygon" && (g.type === "Polygon" || g.type === "MultiPolygon")) {
        const bounds = getPolygonBounds(g);
        if (bounds) {
            map.fitBounds(bounds, { padding: 48, maxZoom: 19, duration });
        }
        return;
    }

    if (geometryKind === "line" && (g.type === "LineString" || g.type === "MultiLineString")) {
        const bounds = getLineBounds(g);
        if (bounds) {
            map.fitBounds(bounds, { padding: 56, maxZoom: LINE_MAX_ZOOM, duration });
        }
    }
}
