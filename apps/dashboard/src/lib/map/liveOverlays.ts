/**
 * Live API GeoJSON overlay utilities for dashboard MapLibre maps.
 *
 * Two-layer rendering model
 * ─────────────────────────────────────────────────────────────────────────────
 *  PMTiles (local-basemap)   = stable regional snapshot built offline.
 *                              Geometry may lag behind DB until the next rebuild.
 *                              Source-layer names: buildings, streets, road_labels,
 *                              water_polygons, water_lines, landuse, admin_boundaries, admin_areas.
 *
 *  API GeoJSON overlays      = live editable truth, fetched from the dashboard API.
 *                              Updated immediately after every CRUD mutation so the
 *                              operator always sees the current state without waiting
 *                              for a PMTiles rebuild.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All overlay layers are added to the map AFTER style load so they always render
 * on top of every PMTiles basemap layer. Every function is idempotent — safe to
 * call multiple times; existing sources/layers are reused and only their data is
 * updated.
 */
import type {
    FeatureCollection,
    GeoJsonProperties,
    Geometry,
    LineString,
    MultiPolygon,
    MultiLineString,
    Point,
    Polygon,
} from "geojson";
import { GeoJSONSource, type Map as MaplibreMap } from "maplibre-gl";
import { dashboardMyanmarTextFont } from "@/src/lib/map/dashboardMapFonts";

// ─── Source ids ──────────────────────────────────────────────────────────────

/** GeoJSON source for the current building footprint(s) from the API. */
export const LIVE_BUILDING_SOURCE_ID = "live-building" as const;

/**
 * GeoJSON source for the building that is currently selected / highlighted in the
 * UI (e.g. hovered row in a list, picked item in a picker).
 */
export const LIVE_BUILDING_SELECTED_SOURCE_ID = "live-building-selected" as const;

/** GeoJSON source for the current street geometry from the API. */
export const LIVE_STREET_SOURCE_ID = "street-live-overlay" as const;

/** GeoJSON source for the current place point(s) from the API (live overlay above PMTiles). */
export const LIVE_PLACE_SOURCE_ID = "place-live-overlay" as const;

// ─── Layer ids ───────────────────────────────────────────────────────────────

export const LIVE_BUILDING_FILL_LAYER = "live-building-fill" as const;
export const LIVE_BUILDING_OUTLINE_LAYER = "live-building-outline" as const;
export const LIVE_BUILDING_SELECTED_FILL_LAYER = "live-building-selected-fill" as const;
export const LIVE_BUILDING_SELECTED_OUTLINE_LAYER = "live-building-selected-outline" as const;
export const LIVE_STREET_LINE_LAYER = "street-live-overlay-line" as const;
export const LIVE_PLACE_DOT_LAYER = "place-live-overlay-dot" as const;
export const LIVE_PLACE_LABEL_LAYER = "place-live-overlay-label" as const;

// ─── Internal helpers ────────────────────────────────────────────────────────

function emptyFeatureCollection(): FeatureCollection {
    return { type: "FeatureCollection", features: [] };
}

// ─── Generic primitive ───────────────────────────────────────────────────────

/**
 * Ensure a GeoJSON source with `sourceId` exists on `map`, then set its data.
 *
 * - If the source already exists its data is replaced in-place (no layer re-add needed).
 * - If the source does not exist it is created with the given GeoJSON.
 * - No-ops silently when the map style has not yet loaded.
 *
 * This function is the low-level primitive used by all overlay helpers below.
 * It never touches the PMTiles `local-basemap` vector source.
 */
export function addOrUpdateGeoJsonSource(
    map: MaplibreMap,
    sourceId: string,
    geojson: FeatureCollection<Geometry, GeoJsonProperties>,
): void {
    if (!map.isStyleLoaded()) {
        return;
    }

    const existing = map.getSource(sourceId);

    if (existing) {
        if (existing instanceof GeoJSONSource) {
            existing.setData(geojson);
        }
        return;
    }

    map.addSource(sourceId, {
        type: "geojson",
        data: geojson,
    });
}

/**
 * Empty an existing live overlay source so its layers stop rendering — without
 * removing the source or layers from the style. Re-populating later is instant.
 *
 * Useful after a delete mutation: clear immediately, let the next PMTiles rebuild
 * remove the ghost from the static tiles in the background.
 *
 * No-ops silently if the source does not exist or the style is not loaded.
 */
export function clearLiveOverlay(map: MaplibreMap, sourceId: string): void {
    if (!map.isStyleLoaded()) {
        return;
    }

    const source = map.getSource(sourceId);

    if (source instanceof GeoJSONSource) {
        source.setData(emptyFeatureCollection());
    }
}

// ─── Building overlay ────────────────────────────────────────────────────────

/**
 * One-feature collection for a single Polygon or MultiPolygon footprint (API / form state).
 * Use with {@link addBuildingLiveOverlay}.
 */
export function buildingPolygonToLiveFeatureCollection(
    geometry: Polygon | MultiPolygon,
): FeatureCollection<Geometry, GeoJsonProperties> {
    return {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry }],
    };
}

/**
 * Add or update the **live building footprint** overlay.
 *
 * Source: {@link LIVE_BUILDING_SOURCE_ID}
 * Layers:
 *   {@link LIVE_BUILDING_FILL_LAYER}    — cyan-500 fill (visually distinct from the PMTiles tan snapshot)
 *   {@link LIVE_BUILDING_OUTLINE_LAYER} — blue-700 outline
 *
 * Use case: show the exact footprint returned by the API immediately after a
 * create / update, before the next PMTiles rebuild incorporates the change.
 *
 * PMTiles note: `basemap-buildings` (source-layer `buildings`) still renders the
 * last snapshot underneath. The cyan overlay paints on top of it.
 */
export function addBuildingLiveOverlay(
    map: MaplibreMap,
    geojson: FeatureCollection<Geometry, GeoJsonProperties>,
): void {
    addOrUpdateGeoJsonSource(map, LIVE_BUILDING_SOURCE_ID, geojson);

    if (!map.getLayer(LIVE_BUILDING_FILL_LAYER)) {
        map.addLayer({
            id: LIVE_BUILDING_FILL_LAYER,
            type: "fill",
            source: LIVE_BUILDING_SOURCE_ID,
            paint: {
                // API GeoJSON = live truth, cyan distinguishes it from the static basemap tan
                "fill-color": "#06b6d4",
                "fill-opacity": 0.45,
            },
        });
    }

    if (!map.getLayer(LIVE_BUILDING_OUTLINE_LAYER)) {
        map.addLayer({
            id: LIVE_BUILDING_OUTLINE_LAYER,
            type: "line",
            source: LIVE_BUILDING_SOURCE_ID,
            paint: {
                "line-color": "#1d4ed8",
                "line-width": 2.5,
                "line-opacity": 0.92,
            },
        });
    }

    if (map.getLayer(LIVE_BUILDING_FILL_LAYER)) {
        map.moveLayer(LIVE_BUILDING_FILL_LAYER);
    }

    if (map.getLayer(LIVE_BUILDING_OUTLINE_LAYER)) {
        map.moveLayer(LIVE_BUILDING_OUTLINE_LAYER);
    }
}

/**
 * Add or update the **selected building highlight** — an orange/amber ring drawn
 * on top of the live overlay to indicate which building is currently focused in
 * the UI (hovered list row, picked item, etc.).
 *
 * Source: {@link LIVE_BUILDING_SELECTED_SOURCE_ID}
 * Layers:
 *   {@link LIVE_BUILDING_SELECTED_FILL_LAYER}    — amber-400 fill
 *   {@link LIVE_BUILDING_SELECTED_OUTLINE_LAYER} — amber-600 outline
 *
 * Both `addBuildingLiveOverlay` (full set, cyan) and this highlight (single item,
 * orange) can coexist simultaneously.
 */
export function addBuildingSelectedHighlight(
    map: MaplibreMap,
    geojson: FeatureCollection<Geometry, GeoJsonProperties>,
): void {
    addOrUpdateGeoJsonSource(map, LIVE_BUILDING_SELECTED_SOURCE_ID, geojson);

    if (!map.getLayer(LIVE_BUILDING_SELECTED_FILL_LAYER)) {
        map.addLayer({
            id: LIVE_BUILDING_SELECTED_FILL_LAYER,
            type: "fill",
            source: LIVE_BUILDING_SELECTED_SOURCE_ID,
            paint: {
                "fill-color": "#f59e0b",
                "fill-opacity": 0.38,
            },
        });
    }

    if (!map.getLayer(LIVE_BUILDING_SELECTED_OUTLINE_LAYER)) {
        map.addLayer({
            id: LIVE_BUILDING_SELECTED_OUTLINE_LAYER,
            type: "line",
            source: LIVE_BUILDING_SELECTED_SOURCE_ID,
            paint: {
                "line-color": "#d97706",
                "line-width": 2.5,
                "line-opacity": 0.95,
            },
        });
    }

    if (map.getLayer(LIVE_BUILDING_SELECTED_FILL_LAYER)) {
        map.moveLayer(LIVE_BUILDING_SELECTED_FILL_LAYER);
    }

    if (map.getLayer(LIVE_BUILDING_SELECTED_OUTLINE_LAYER)) {
        map.moveLayer(LIVE_BUILDING_SELECTED_OUTLINE_LAYER);
    }
}

// ─── Selected place overlay ──────────────────────────────────────────────────

/**
 * GeoJSON source for the single place that is currently selected/highlighted
 * in the Places list page preview map.  Uses a dedicated source/layer separate
 * from the general `place-live-overlay` so the two can coexist independently.
 */
export const SELECTED_PLACE_OVERLAY_SOURCE_ID = "selected-place-overlay" as const;
export const SELECTED_PLACE_OVERLAY_CIRCLE_LAYER = "selected-place-overlay-circle" as const;
export const SELECTED_PLACE_OVERLAY_LABEL_LAYER = "selected-place-overlay-label" as const;

/** Optional feature properties for the selected-place symbol label (`name` / `display_name`). */
export type SelectedPlaceOverlayLabels = {
    name?: string | null;
    display_name?: string | null;
};

function selectedPlaceOverlayFeatureCollection(
    lat: number,
    lng: number,
    labels: SelectedPlaceOverlayLabels | null | undefined,
): FeatureCollection<Point, GeoJsonProperties> {
    const properties: GeoJsonProperties = {};
    const rawName = labels?.name;
    const rawDisplay = labels?.display_name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const displayName = typeof rawDisplay === "string" ? rawDisplay.trim() : "";

    if (name) {
        properties.name = name;
    }

    if (displayName) {
        properties.display_name = displayName;
    }

    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties,
                geometry: { type: "Point", coordinates: [lng, lat] },
            },
        ],
    };
}

function removeSelectedPlaceOverlayLayers(map: MaplibreMap): void {
    if (map.getLayer(SELECTED_PLACE_OVERLAY_LABEL_LAYER)) {
        map.removeLayer(SELECTED_PLACE_OVERLAY_LABEL_LAYER);
    }

    if (map.getLayer(SELECTED_PLACE_OVERLAY_CIRCLE_LAYER)) {
        map.removeLayer(SELECTED_PLACE_OVERLAY_CIRCLE_LAYER);
    }
}

/**
 * Add or update the **selected place highlight** circle + label.
 *
 * Source: {@link SELECTED_PLACE_OVERLAY_SOURCE_ID}
 * Layers:
 *   {@link SELECTED_PLACE_OVERLAY_CIRCLE_LAYER} — pin (circle)
 *   {@link SELECTED_PLACE_OVERLAY_LABEL_LAYER} — name label (symbol)
 *
 * Always creates or updates the GeoJSON source before adding layers. If the map
 * style is not yet ready, applies once on the next `idle` event (same pattern as
 * preview maps where React `styleLoaded` can lead `map.isStyleLoaded()`).
 * After a full style reload, calling this again recreates source and layers safely.
 */
export function addSelectedPlaceOverlay(
    map: MaplibreMap,
    lat: number,
    lng: number,
    labels?: SelectedPlaceOverlayLabels | null,
): void {
    const geojson = selectedPlaceOverlayFeatureCollection(lat, lng, labels);

    const apply = (): boolean => {
        if (!map.isStyleLoaded()) {
            return false;
        }

        // Style reload can remove the source while layer ids linger — drop orphan layers first.
        if (!map.getSource(SELECTED_PLACE_OVERLAY_SOURCE_ID)) {
            removeSelectedPlaceOverlayLayers(map);
        }

        const existing = map.getSource(SELECTED_PLACE_OVERLAY_SOURCE_ID);

        if (existing instanceof GeoJSONSource) {
            existing.setData(geojson);
            console.log("[selected-place-overlay] source updated");
        } else if (existing) {
            removeSelectedPlaceOverlayLayers(map);
            map.removeSource(SELECTED_PLACE_OVERLAY_SOURCE_ID);
            map.addSource(SELECTED_PLACE_OVERLAY_SOURCE_ID, {
                type: "geojson",
                data: geojson,
            });
            console.log("[selected-place-overlay] source added");
        } else {
            map.addSource(SELECTED_PLACE_OVERLAY_SOURCE_ID, {
                type: "geojson",
                data: geojson,
            });
            console.log("[selected-place-overlay] source added");
        }

        const sourceAfter = map.getSource(SELECTED_PLACE_OVERLAY_SOURCE_ID);
        if (!(sourceAfter instanceof GeoJSONSource)) {
            return true;
        }

        if (!map.getLayer(SELECTED_PLACE_OVERLAY_CIRCLE_LAYER)) {
            map.addLayer({
                id: SELECTED_PLACE_OVERLAY_CIRCLE_LAYER,
                type: "circle",
                source: SELECTED_PLACE_OVERLAY_SOURCE_ID,
                paint: {
                    "circle-radius": 10,
                    "circle-color": "#00AEEF",
                    "circle-stroke-color": "#FFFFFF",
                    "circle-stroke-width": 3,
                },
            });
            console.log("[selected-place-overlay] circle layer added");
        }

        if (!map.getLayer(SELECTED_PLACE_OVERLAY_LABEL_LAYER)) {
            map.addLayer({
                id: SELECTED_PLACE_OVERLAY_LABEL_LAYER,
                type: "symbol",
                source: SELECTED_PLACE_OVERLAY_SOURCE_ID,
                layout: {
                    "text-field": [
                        "coalesce",
                        ["get", "name"],
                        ["get", "display_name"],
                        "Selected place",
                    ],
                    "text-size": 13,
                    "text-offset": [0, 1.4],
                    "text-anchor": "top",
                    "text-font": dashboardMyanmarTextFont(),
                    "text-optional": true,
                },
                paint: {
                    "text-color": "#0e7490",
                    "text-halo-color": "#ffffff",
                    "text-halo-width": 1.4,
                },
            });
            console.log("[selected-place-overlay] label layer added");
        }

        if (map.getLayer(SELECTED_PLACE_OVERLAY_CIRCLE_LAYER)) {
            map.moveLayer(SELECTED_PLACE_OVERLAY_CIRCLE_LAYER);
        }

        if (map.getLayer(SELECTED_PLACE_OVERLAY_LABEL_LAYER)) {
            map.moveLayer(SELECTED_PLACE_OVERLAY_LABEL_LAYER);
        }

        return true;
    };

    if (!apply()) {
        map.once("idle", () => {
            void apply();
        });
    }
}

/**
 * Clear the selected place highlight without removing the source/layer.
 * Call when no place is selected.
 */
export function clearSelectedPlaceOverlay(map: MaplibreMap): void {
    clearLiveOverlay(map, SELECTED_PLACE_OVERLAY_SOURCE_ID);
}

// ─── Street overlay ──────────────────────────────────────────────────────────

/** One-feature collection for a single LineString / MultiLineString street geometry. */
export function streetLineToLiveFeatureCollection(
    geometry: LineString | MultiLineString,
): FeatureCollection<Geometry, GeoJsonProperties> {
    return {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry }],
    };
}

/**
 * Add or update the **live street geometry** overlay.
 *
 * Source: {@link LIVE_STREET_SOURCE_ID}
 * Layer:  {@link LIVE_STREET_LINE_LAYER} — bright blue-600 thick line, round caps
 *
 * Use case: display the edited street alignment immediately after a save, before
 * the next PMTiles rebuild. The static `basemap-road-casing` / `basemap-road-fill`
 * layers (source-layer `streets`) remain underneath.
 */
export function addStreetLiveOverlay(
    map: MaplibreMap,
    geojson: FeatureCollection<Geometry, GeoJsonProperties>,
): void {
    addOrUpdateGeoJsonSource(map, LIVE_STREET_SOURCE_ID, geojson);

    if (!map.getLayer(LIVE_STREET_LINE_LAYER)) {
        map.addLayer({
            id: LIVE_STREET_LINE_LAYER,
            type: "line",
            source: LIVE_STREET_SOURCE_ID,
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                // Bright blue makes the live street immediately visible above the basemap grey
                "line-color": "#2563eb",
                "line-width": 5,
                "line-opacity": 0.92,
            },
        });
    }

    if (map.getLayer(LIVE_STREET_LINE_LAYER)) {
        map.moveLayer(LIVE_STREET_LINE_LAYER);
    }
}

// ─── Place overlay ───────────────────────────────────────────────────────────

/** Labels for {@link placeLatLngToLiveFeatureCollection} / symbol layer coalesce. */
export type PlaceLiveOverlayLabelProps = {
    name_mm?: string | null;
    name_en?: string | null;
    name?: string | null;
};

/**
 * Single Point feature collection for the live place overlay (API lat/lng, optional labels).
 */
export function placeLatLngToLiveFeatureCollection(
    lat: number,
    lng: number,
    label?: PlaceLiveOverlayLabelProps | null,
): FeatureCollection<Point, GeoJsonProperties> {
    const properties: GeoJsonProperties = {};

    if (label) {
        const mm = typeof label.name_mm === "string" ? label.name_mm.trim() : "";
        const en = typeof label.name_en === "string" ? label.name_en.trim() : "";
        const n = typeof label.name === "string" ? label.name.trim() : "";

        if (mm) {
            properties.name_mm = mm;
        }

        if (en) {
            properties.name_en = en;
        }

        if (n) {
            properties.name = n;
        }
    }

    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties,
                geometry: {
                    type: "Point",
                    coordinates: [lng, lat],
                },
            },
        ],
    };
}

/**
 * Add or update the **live place point** overlay.
 *
 * Source: {@link LIVE_PLACE_SOURCE_ID}
 * Layers:
 *   {@link LIVE_PLACE_DOT_LAYER}   — bright cyan circle scaled by zoom (above PMTiles)
 *   {@link LIVE_PLACE_LABEL_LAYER} — Myanmar/English name label above the dot (≥ zoom 13)
 *
 * PMTiles note: places/POIs are intentionally **excluded** from the PMTiles tiles.
 * This overlay is therefore the *only* map layer that displays place data — there
 * is no static snapshot to conflict with. The API response is always authoritative.
 *
 * Feature properties read for the label (first non-empty wins):
 *   `name_mm` → `name_en` → `name`
 */
export function addPlaceLiveOverlay(
    map: MaplibreMap,
    geojson: FeatureCollection<Geometry, GeoJsonProperties>,
): void {
    addOrUpdateGeoJsonSource(map, LIVE_PLACE_SOURCE_ID, geojson);

    if (!map.getLayer(LIVE_PLACE_DOT_LAYER)) {
        map.addLayer({
            id: LIVE_PLACE_DOT_LAYER,
            type: "circle",
            source: LIVE_PLACE_SOURCE_ID,
            paint: {
                "circle-radius": [
                    "interpolate", ["linear"], ["zoom"],
                    10, 6,
                    16, 10,
                    20, 14,
                ],
                // High-contrast cyan — readable above landuse / roads in PMTiles
                "circle-color": "#06b6d4",
                "circle-opacity": 0.95,
                "circle-stroke-width": 3,
                "circle-stroke-color": "#ffffff",
            },
        });
    }

    if (!map.getLayer(LIVE_PLACE_LABEL_LAYER)) {
        map.addLayer({
            id: LIVE_PLACE_LABEL_LAYER,
            type: "symbol",
            source: LIVE_PLACE_SOURCE_ID,
            minzoom: 13,
            layout: {
                "text-field": [
                    "coalesce",
                    ["get", "name_mm"],
                    ["get", "name_en"],
                    ["get", "name"],
                ],
                // Self-hosted Myanmar fontstack — served from /fonts/NotoSansMyanmar-Regular/
                "text-font": dashboardMyanmarTextFont(),
                "text-size": 12,
                "text-offset": [0, 1.2],
                "text-anchor": "top",
                "text-optional": true,
                "text-allow-overlap": false,
            },
            paint: {
                "text-color": "#0e7490",
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.4,
            },
        });
    }

    if (map.getLayer(LIVE_PLACE_DOT_LAYER)) {
        map.moveLayer(LIVE_PLACE_DOT_LAYER);
    }

    if (map.getLayer(LIVE_PLACE_LABEL_LAYER)) {
        map.moveLayer(LIVE_PLACE_LABEL_LAYER);
    }
}
