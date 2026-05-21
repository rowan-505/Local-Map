import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { FilterSpecification } from "maplibre-gl";

import { addOrUpdateGeoJsonSource } from "@/src/lib/map/liveOverlays";

export const MAP_VERTEX_PREVIEW_SOURCE_ID = "map-vertex-preview";
export const MAP_VERTEX_PREVIEW_LAYER_ID = "map-vertex-preview-circle";

const FILTER_POINT: FilterSpecification = [
    "in",
    ["geometry-type"],
    ["literal", ["Point", "MultiPoint"]],
];

function emptyFc(): FeatureCollection<Geometry> {
    return { type: "FeatureCollection", features: [] };
}

/** Ring / line vertices for preview only (no polygon fill from lines). */
export function extractVerticesFromGeometry(g: Geometry): FeatureCollection<Geometry> {
    const collected: [number, number][] = [];
    const push = (lng: number, lat: number) => {
        const prev = collected[collected.length - 1];
        if (prev && prev[0] === lng && prev[1] === lat) {
            return;
        }
        collected.push([lng, lat]);
    };

    if (g.type === "LineString") {
        for (const c of g.coordinates) {
            if (typeof c[0] === "number" && typeof c[1] === "number") {
                push(c[0], c[1]);
            }
        }
    } else if (g.type === "MultiLineString") {
        for (const line of g.coordinates) {
            for (const c of line) {
                if (typeof c[0] === "number" && typeof c[1] === "number") {
                    push(c[0], c[1]);
                }
            }
        }
    } else if (g.type === "Polygon") {
        for (const ring of g.coordinates) {
            for (const c of ring) {
                if (typeof c[0] === "number" && typeof c[1] === "number") {
                    push(c[0], c[1]);
                }
            }
        }
    } else if (g.type === "MultiPolygon") {
        for (const poly of g.coordinates) {
            for (const ring of poly) {
                for (const c of ring) {
                    if (typeof c[0] === "number" && typeof c[1] === "number") {
                        push(c[0], c[1]);
                    }
                }
            }
        }
    } else {
        return emptyFc();
    }

    const features: Feature<Geometry>[] = collected.map(([lng, lat]) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [lng, lat] },
    }));

    return { type: "FeatureCollection", features };
}

function ensureVertexPreviewLayer(map: MaplibreMap) {
    if (!map.getLayer(MAP_VERTEX_PREVIEW_LAYER_ID)) {
        map.addLayer({
            id: MAP_VERTEX_PREVIEW_LAYER_ID,
            type: "circle",
            source: MAP_VERTEX_PREVIEW_SOURCE_ID,
            filter: FILTER_POINT,
            paint: {
                "circle-radius": 2.75,
                "circle-color": "#1f2937",
                "circle-opacity": 0.65,
                "circle-stroke-width": 1,
                "circle-stroke-color": "#ffffff",
            },
        });
    }
}

export function syncVertexPreviewLayer(
    map: MaplibreMap | null,
    geometry: Geometry | null,
    visible: boolean,
) {
    if (!map || !map.isStyleLoaded()) {
        return;
    }

    const fc =
        visible && geometry ? extractVerticesFromGeometry(geometry) : emptyFc();

    addOrUpdateGeoJsonSource(map, MAP_VERTEX_PREVIEW_SOURCE_ID, fc);
    ensureVertexPreviewLayer(map);

    if (map.getLayer(MAP_VERTEX_PREVIEW_LAYER_ID)) {
        map.setLayoutProperty(
            MAP_VERTEX_PREVIEW_LAYER_ID,
            "visibility",
            visible && fc.features.length > 0 ? "visible" : "none",
        );
    }
}
