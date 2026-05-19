"use client";

/**
 * Read-only MapLibre preview for import-review candidates (buildings / places / roads).
 * Uses geometry-type filters so line data never draws as polygon fill; vertex dots are optional (separate source).
 */
import type {
    Feature,
    FeatureCollection,
    Geometry,
    LineString,
    MultiLineString,
    MultiPoint,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";
import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { FilterSpecification } from "maplibre-gl";

import { createPreviewBaseMap } from "./createPreviewBaseMap";
import DataReviewMapHeaderControls from "./DataReviewMapHeaderControls";
import {
    applyDataReviewBasemapMode,
    ensureDataReviewSatelliteLayer,
    fitMapToReviewCandidate,
    type DataReviewBasemapMode,
} from "./dataReviewBasemap";
import { MAP_PREVIEW_CARD_CLASS, MAP_PREVIEW_CARD_HEADER_CLASS } from "./mapPreviewUi";
import { PLACE_MAP_DEFAULT_CENTER } from "./placeMapConfig";

export type { DataReviewBasemapMode } from "./dataReviewBasemap";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import { addOrUpdateGeoJsonSource, clearLiveOverlay } from "@/src/lib/map/liveOverlays";
import { normalizeImportReviewGeoJson } from "@/src/lib/importReviewDrawerMapGeometry";
import type { ImportReviewGeoJson } from "@/src/lib/api";

export type DataReviewGeometryKind = "point" | "polygon" | "line";

export type ImportReviewEntityType =
    | "building"
    | "place"
    | "road"
    | "landuse"
    | "water_line"
    | "water_polygon"
    | "generic";

const DEFAULT_ZOOM = 12;
const POINT_ZOOM = 16;
const LINE_MAX_ZOOM = 17;

/** MapLibre expression filters — restrict layers by GeoJSON geometry type. */
const FILTER_POLYGON: FilterSpecification = [
    "in",
    ["geometry-type"],
    ["literal", ["Polygon", "MultiPolygon"]],
];

const FILTER_LINE: FilterSpecification = [
    "in",
    ["geometry-type"],
    ["literal", ["LineString", "MultiLineString"]],
];

const FILTER_POINT: FilterSpecification = [
    "in",
    ["geometry-type"],
    ["literal", ["Point", "MultiPoint"]],
];

const MAIN_SOURCE_ID = "data-review-candidate-preview";
const VERTEX_SOURCE_ID = "data-review-candidate-vertices";

const LAYER_FILL_ID = "data-review-candidate-fill";
/** Line layer with polygon filter — renders footprint outline (MapLibre outlines Polygon geometries). */
const LAYER_POLYGON_OUTLINE_ID = "data-review-candidate-polygon-outline";
const LAYER_LINE_ID = "data-review-candidate-line";
const LAYER_POINT_ID = "data-review-candidate-point";
const LAYER_VERTEX_ID = "data-review-candidate-vertex";

function emptyFc(): FeatureCollection<Geometry> {
    return { type: "FeatureCollection", features: [] };
}

function setLayerVisibility(map: maplibregl.Map, layerId: string, visible: boolean) {
    if (!map.getLayer(layerId)) {
        return;
    }
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

function defaultEntityType(kind: DataReviewGeometryKind): ImportReviewEntityType {
    if (kind === "polygon") {
        return "building";
    }
    if (kind === "point") {
        return "place";
    }
    return "road";
}

function asGeoJsonGeometry(raw: ImportReviewGeoJson | null | undefined): Geometry | null {
    return normalizeImportReviewGeoJson(raw ?? null);
}

function debugRoadPreview(
    entity: ImportReviewEntityType,
    externalId: string | null,
    g: Geometry | null,
    mainFc: FeatureCollection<Geometry>,
    map: maplibregl.Map,
) {
    if (process.env.NODE_ENV !== "development" || entity !== "road") {
        return;
    }
    console.debug("[import-review road preview]", {
        selectedId: externalId,
        geometryType: g?.type ?? null,
        featureCount: mainFc.features.length,
        sourceUpdated: true,
        lineLayerExists: Boolean(map.getLayer(LAYER_LINE_ID)),
    });
}

function polygonFeatureCollection(g: Polygon | MultiPolygon): FeatureCollection<Geometry> {
    return {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: g }],
    };
}

function lineFeatureCollection(g: LineString | MultiLineString): FeatureCollection<Geometry> {
    return {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: g }],
    };
}

function firstMultiPointCoord(g: MultiPoint): [number, number] | null {
    const c = g.coordinates[0];
    if (!c || typeof c[0] !== "number" || typeof c[1] !== "number") {
        return null;
    }
    return [c[0], c[1]];
}

function pointFeatureCollection(lng: number, lat: number): FeatureCollection<Geometry> {
    return {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lng, lat] } }],
    };
}

/** Ring / line vertices for preview only (no polygon fill from lines). */
function extractVerticesFromGeometry(g: Geometry): FeatureCollection<Geometry> {
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

function clearImportReviewPreviewSources(map: maplibregl.Map) {
    clearLiveOverlay(map, MAIN_SOURCE_ID);
    clearLiveOverlay(map, VERTEX_SOURCE_ID);
}

function ensureImportReviewLayers(map: maplibregl.Map) {
    if (!map.getLayer(LAYER_FILL_ID)) {
        map.addLayer({
            id: LAYER_FILL_ID,
            type: "fill",
            source: MAIN_SOURCE_ID,
            filter: FILTER_POLYGON,
            paint: {
                "fill-color": "#2563eb",
                "fill-opacity": 0.25,
                // Outline drawn with {@link LAYER_POLYGON_OUTLINE_ID} (~2px); avoid double stroke from fill.
                "fill-outline-color": "rgba(0,0,0,0)",
            },
        });
    }

    if (!map.getLayer(LAYER_POLYGON_OUTLINE_ID)) {
        map.addLayer({
            id: LAYER_POLYGON_OUTLINE_ID,
            type: "line",
            source: MAIN_SOURCE_ID,
            filter: FILTER_POLYGON,
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#1e40af",
                "line-width": 2,
                "line-opacity": 0.9,
            },
        });
    }

    if (!map.getLayer(LAYER_LINE_ID)) {
        map.addLayer({
            id: LAYER_LINE_ID,
            type: "line",
            source: MAIN_SOURCE_ID,
            filter: FILTER_LINE,
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#ea580c",
                "line-width": 4,
                "line-opacity": 0.9,
            },
        });
    }

    if (!map.getLayer(LAYER_POINT_ID)) {
        map.addLayer({
            id: LAYER_POINT_ID,
            type: "circle",
            source: MAIN_SOURCE_ID,
            filter: FILTER_POINT,
            paint: {
                "circle-radius": 6,
                "circle-color": "#16a34a",
                "circle-opacity": 0.95,
                "circle-stroke-width": 2,
                "circle-stroke-color": "#ffffff",
            },
        });
    }

    if (!map.getSource(VERTEX_SOURCE_ID)) {
        map.addSource(VERTEX_SOURCE_ID, {
            type: "geojson",
            data: emptyFc(),
        });
    }

    if (!map.getLayer(LAYER_VERTEX_ID)) {
        map.addLayer({
            id: LAYER_VERTEX_ID,
            type: "circle",
            source: VERTEX_SOURCE_ID,
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

    raiseImportReviewLayers(map);
}

function raiseImportReviewLayers(map: maplibregl.Map) {
    for (const id of [
        LAYER_FILL_ID,
        LAYER_POLYGON_OUTLINE_ID,
        LAYER_LINE_ID,
        LAYER_POINT_ID,
        LAYER_VERTEX_ID,
    ]) {
        if (map.getLayer(id)) {
            map.moveLayer(id);
        }
    }
}

function usesPolygonLayers(entity: ImportReviewEntityType): boolean {
    return entity === "building" || entity === "landuse" || entity === "water_polygon";
}

function usesLineLayers(entity: ImportReviewEntityType): boolean {
    return entity === "road" || entity === "water_line";
}

function usesPointMainLayer(entity: ImportReviewEntityType): boolean {
    return entity === "place";
}

function applyEntityVisibility(map: maplibregl.Map, entity: ImportReviewEntityType, showVertices: boolean) {
    let showFill = false;
    let showLine = false;
    let showPoint = false;

    if (entity === "generic") {
        showFill = true;
        showLine = true;
        showPoint = true;
    } else {
        showFill = usesPolygonLayers(entity);
        showLine = usesLineLayers(entity);
        showPoint = usesPointMainLayer(entity);
    }

    setLayerVisibility(map, LAYER_FILL_ID, showFill);
    setLayerVisibility(map, LAYER_POLYGON_OUTLINE_ID, showFill);
    setLayerVisibility(map, LAYER_LINE_ID, showLine);
    setLayerVisibility(map, LAYER_POINT_ID, showPoint);

    const vertexOn = showVertices && entity !== "place";
    setLayerVisibility(map, LAYER_VERTEX_ID, vertexOn);
}

function applyEntityPaint(map: maplibregl.Map, entity: ImportReviewEntityType, roadHighlight: boolean) {
    if (map.getLayer(LAYER_FILL_ID)) {
        if (entity === "water_polygon") {
            map.setPaintProperty(LAYER_FILL_ID, "fill-color", "#0284c7");
            map.setPaintProperty(LAYER_FILL_ID, "fill-opacity", 0.28);
            map.setPaintProperty(LAYER_FILL_ID, "fill-outline-color", "rgba(0,0,0,0)");
        } else if (entity === "landuse") {
            map.setPaintProperty(LAYER_FILL_ID, "fill-color", "#65a30d");
            map.setPaintProperty(LAYER_FILL_ID, "fill-opacity", 0.22);
            map.setPaintProperty(LAYER_FILL_ID, "fill-outline-color", "rgba(0,0,0,0)");
        } else {
            map.setPaintProperty(LAYER_FILL_ID, "fill-color", "#2563eb");
            map.setPaintProperty(LAYER_FILL_ID, "fill-opacity", 0.25);
            map.setPaintProperty(LAYER_FILL_ID, "fill-outline-color", "rgba(0,0,0,0)");
        }
    }

    if (map.getLayer(LAYER_POLYGON_OUTLINE_ID)) {
        if (entity === "water_polygon") {
            map.setPaintProperty(LAYER_POLYGON_OUTLINE_ID, "line-color", "#0369a1");
            map.setPaintProperty(LAYER_POLYGON_OUTLINE_ID, "line-width", 2);
            map.setPaintProperty(LAYER_POLYGON_OUTLINE_ID, "line-opacity", 0.9);
        } else if (entity === "landuse") {
            map.setPaintProperty(LAYER_POLYGON_OUTLINE_ID, "line-color", "#3f6212");
            map.setPaintProperty(LAYER_POLYGON_OUTLINE_ID, "line-width", 2);
            map.setPaintProperty(LAYER_POLYGON_OUTLINE_ID, "line-opacity", 0.9);
        } else {
            map.setPaintProperty(LAYER_POLYGON_OUTLINE_ID, "line-color", "#1e40af");
            map.setPaintProperty(LAYER_POLYGON_OUTLINE_ID, "line-width", 2);
            map.setPaintProperty(LAYER_POLYGON_OUTLINE_ID, "line-opacity", 0.9);
        }
    }

    if (map.getLayer(LAYER_LINE_ID)) {
        const w = roadHighlight ? 5 : 4;
        if (entity === "water_line") {
            map.setPaintProperty(LAYER_LINE_ID, "line-color", "#0284c7");
            map.setPaintProperty(LAYER_LINE_ID, "line-width", w);
            map.setPaintProperty(LAYER_LINE_ID, "line-opacity", 0.9);
        } else {
            map.setPaintProperty(LAYER_LINE_ID, "line-color", "#ea580c");
            map.setPaintProperty(LAYER_LINE_ID, "line-width", w);
            map.setPaintProperty(LAYER_LINE_ID, "line-opacity", 0.9);
        }
    }

    if (map.getLayer(LAYER_POINT_ID)) {
        map.setPaintProperty(LAYER_POINT_ID, "circle-radius", 6);
        map.setPaintProperty(LAYER_POINT_ID, "circle-color", "#16a34a");
        map.setPaintProperty(LAYER_POINT_ID, "circle-stroke-width", 2);
        map.setPaintProperty(LAYER_POINT_ID, "circle-stroke-color", "#ffffff");
    }
}

function pushPreviewData(
    map: maplibregl.Map,
    mainFc: FeatureCollection<Geometry>,
    vertexFc: FeatureCollection<Geometry>,
    entity: ImportReviewEntityType,
    showVertices: boolean,
    roadHighlight: boolean,
) {
    addOrUpdateGeoJsonSource(map, MAIN_SOURCE_ID, mainFc);
    addOrUpdateGeoJsonSource(map, VERTEX_SOURCE_ID, vertexFc);
    ensureImportReviewLayers(map);
    applyEntityVisibility(map, entity, showVertices);
    applyEntityPaint(map, entity, roadHighlight);
    raiseImportReviewLayers(map);
}

export type DataReviewCandidateMapProps = {
    geometry: ImportReviewGeoJson | null | undefined;
    geometryKind: DataReviewGeometryKind;
    entityType?: ImportReviewEntityType;
    /** Shown under title (e.g. external_id). */
    externalId?: string | null;
    title?: string;
    /** @deprecated Prefer externalId; kept for rare secondary label. */
    subtitle?: string | null;
    className?: string;
    size?: "default" | "drawer";
};

export default function DataReviewCandidateMap({
    geometry,
    geometryKind,
    entityType: entityTypeProp,
    externalId = null,
    title = "Candidate preview",
    subtitle,
    className,
    size = "default",
}: DataReviewCandidateMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    /** Bumps only when geometry / kind / entity change — not when toggling vertex dots or drawer highlight. */
    const mapAutoFitSigRef = useRef<string>("");
    /**
     * Last applied overlay identity ({@link pushPreviewData} / full clear). When unchanged, "Show vertices"
     * only updates the vertex source — never clears the main preview source (avoids empty overlay flash).
     */
    const prevOverlayContentKeyRef = useRef<string>("");
    const [isMapReady, setIsMapReady] = useState(false);
    const [basemapMode, setBasemapMode] = useState<DataReviewBasemapMode>("map");
    const [showVertices, setShowVertices] = useState(false);
    const clientMounted = useClientMounted();

    const entityType = entityTypeProp ?? defaultEntityType(geometryKind);
    const roadHighlight = size === "drawer" && (entityType === "road" || entityType === "water_line");

    useEffect(() => {
        if (!clientMounted || !containerRef.current || mapRef.current) {
            return;
        }

        let cancelled = false;

        void (async () => {
            let map: maplibregl.Map;
            try {
                map = await createPreviewBaseMap(containerRef.current!, {
                    zoom: DEFAULT_ZOOM,
                    navigationMode: "compact",
                    onLoad: (loadedMap) => {
                        loadedMap.dragRotate.disable();
                        loadedMap.touchPitch.disable();
                        loadedMap.touchZoomRotate.disableRotation();
                        ensureDataReviewSatelliteLayer(loadedMap);
                        applyDataReviewBasemapMode(loadedMap, "map");
                        setIsMapReady(true);
                    },
                });
            } catch (err) {
                console.error("DataReviewCandidateMap init failed:", err);
                return;
            }

            if (cancelled) {
                map.remove();
                return;
            }

            mapRef.current = map;
        })();

        return () => {
            cancelled = true;
            setIsMapReady(false);
            mapRef.current?.remove();
            mapRef.current = null;
            mapAutoFitSigRef.current = "";
            prevOverlayContentKeyRef.current = "";
        };
    }, [clientMounted]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !isMapReady) {
            return;
        }
        applyDataReviewBasemapMode(map, basemapMode);
    }, [isMapReady, basemapMode]);

    useEffect(() => {
        const map = mapRef.current;
        const root = containerRef.current;

        if (!map || !isMapReady || !root) {
            return;
        }

        const ro = new ResizeObserver(() => {
            map.resize();
        });
        ro.observe(root);
        return () => ro.disconnect();
    }, [isMapReady]);

    useEffect(() => {
        const map = mapRef.current;

        if (!map || !isMapReady) {
            return;
        }

        const overlayContentKey = JSON.stringify({
            geometry,
            geometryKind,
            entityType,
            roadHighlight,
        });
        const verticesOnly =
            prevOverlayContentKeyRef.current !== "" &&
            prevOverlayContentKeyRef.current === overlayContentKey;

        if (verticesOnly) {
            if (!map.isStyleLoaded()) {
                return;
            }
            if (map !== mapRef.current) {
                return;
            }
            const gv = asGeoJsonGeometry(geometry ?? null);
            if (!gv || entityType === "place") {
                addOrUpdateGeoJsonSource(map, VERTEX_SOURCE_ID, emptyFc());
                setLayerVisibility(map, LAYER_VERTEX_ID, false);
                raiseImportReviewLayers(map);
                return;
            }
            const vertexFcOnly = showVertices ? extractVerticesFromGeometry(gv) : emptyFc();
            addOrUpdateGeoJsonSource(map, VERTEX_SOURCE_ID, vertexFcOnly);
            ensureImportReviewLayers(map);
            setLayerVisibility(map, LAYER_VERTEX_ID, showVertices);
            raiseImportReviewLayers(map);
            return;
        }

        const runOverlayBody = (): void => {
            if (map !== mapRef.current) {
                return;
            }
            if (!map.isStyleLoaded()) {
                return;
            }

            const markOverlayApplied = () => {
                prevOverlayContentKeyRef.current = overlayContentKey;
            };

            const g = asGeoJsonGeometry(geometry ?? null);

            if (!g) {
                clearImportReviewPreviewSources(map);
                const sig = "__nogeo__";
                const shouldFlyEmpty = mapAutoFitSigRef.current !== sig;
                mapAutoFitSigRef.current = sig;
                if (shouldFlyEmpty) {
                    map.flyTo({
                        center: PLACE_MAP_DEFAULT_CENTER,
                        zoom: DEFAULT_ZOOM,
                        duration: 450,
                    });
                }
                markOverlayApplied();
                return;
            }

            const autoFitKey = JSON.stringify({
                geometry,
                geometryKind,
                entityType,
            });
            const shouldAutoFit = mapAutoFitSigRef.current !== autoFitKey;
            mapAutoFitSigRef.current = autoFitKey;

            clearImportReviewPreviewSources(map);

            const vertexFc =
                showVertices && entityType !== "place" ? extractVerticesFromGeometry(g) : emptyFc();

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

                if (typeof lng === "number" && typeof lat === "number" && Number.isFinite(lng + lat)) {
                    const fc: FeatureCollection<Geometry> =
                        g.type === "MultiPoint"
                            ? {
                                  type: "FeatureCollection",
                                  features: [{ type: "Feature", properties: {}, geometry: g }],
                              }
                            : pointFeatureCollection(lng, lat);
                    pushPreviewData(map, fc, emptyFc(), entityType, showVertices, roadHighlight);
                    if (shouldAutoFit) {
                        fitMapToReviewCandidate(map, g, geometryKind, { duration: 600 });
                    }
                } else {
                    clearImportReviewPreviewSources(map);
                    if (shouldAutoFit) {
                        map.flyTo({ center: PLACE_MAP_DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 400 });
                    }
                }
                markOverlayApplied();
                return;
            }

            if (geometryKind === "polygon" && (g.type === "Polygon" || g.type === "MultiPolygon")) {
                pushPreviewData(
                    map,
                    polygonFeatureCollection(g),
                    vertexFc,
                    entityType,
                    showVertices,
                    roadHighlight,
                );
                if (shouldAutoFit) {
                    fitMapToReviewCandidate(map, g, geometryKind, { duration: 650 });
                }
                markOverlayApplied();
                return;
            }

            if (geometryKind === "line" && (g.type === "LineString" || g.type === "MultiLineString")) {
                const lineFc = lineFeatureCollection(g);
                pushPreviewData(map, lineFc, vertexFc, entityType, showVertices, roadHighlight);
                debugRoadPreview(entityType, externalId, g, lineFc, map);
                if (shouldAutoFit) {
                    fitMapToReviewCandidate(map, g, geometryKind, { duration: 650 });
                }
                markOverlayApplied();
                return;
            }

            if (shouldAutoFit) {
                map.flyTo({ center: PLACE_MAP_DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 400 });
            }
            markOverlayApplied();
        };

        if (!map.isStyleLoaded()) {
            const onIdle = (): void => {
                if (map !== mapRef.current) {
                    return;
                }
                if (!map.isStyleLoaded()) {
                    return;
                }
                map.off("idle", onIdle);
                runOverlayBody();
            };
            map.on("idle", onIdle);
            return () => {
                map.off("idle", onIdle);
            };
        }

        runOverlayBody();
    }, [isMapReady, geometry, geometryKind, entityType, showVertices, roadHighlight]);

    const parsed = asGeoJsonGeometry(geometry ?? null);
    const hasRenderable =
        parsed &&
        ((geometryKind === "point" &&
            (parsed.type === "Point" || parsed.type === "MultiPoint")) ||
            (geometryKind === "polygon" &&
                (parsed.type === "Polygon" || parsed.type === "MultiPolygon")) ||
            (geometryKind === "line" &&
                (parsed.type === "LineString" || parsed.type === "MultiLineString")));

    const handleFitGeometry = useCallback(() => {
        const map = mapRef.current;
        if (!map || !isMapReady || !map.isStyleLoaded()) {
            return;
        }
        const g = asGeoJsonGeometry(geometry ?? null);
        if (!g) {
            map.flyTo({
                center: PLACE_MAP_DEFAULT_CENTER,
                zoom: DEFAULT_ZOOM,
                duration: 550,
            });
            return;
        }
        const kindMatches =
            (geometryKind === "point" && (g.type === "Point" || g.type === "MultiPoint")) ||
            (geometryKind === "polygon" && (g.type === "Polygon" || g.type === "MultiPolygon")) ||
            (geometryKind === "line" && (g.type === "LineString" || g.type === "MultiLineString"));
        if (!kindMatches) {
            return;
        }
        fitMapToReviewCandidate(map, g, geometryKind, { duration: 550 });
    }, [isMapReady, geometry, geometryKind]);

    const viewportClass =
        size === "drawer"
            ? "h-[220px] min-h-[200px] w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
            : "h-[min(70vh,560px)] min-h-[280px] w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100";

    const headerSubtitle = subtitle?.trim() ? subtitle : null;
    const idLine = externalId?.trim() ? externalId.trim() : null;

    return (
        <div className={className ?? MAP_PREVIEW_CARD_CLASS}>
            <div
                className={`${MAP_PREVIEW_CARD_HEADER_CLASS} flex flex-nowrap items-center gap-2 border-b border-gray-100 py-2 pl-2 pr-1`}
            >
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-xs font-semibold text-gray-900">{title}</h3>
                    {idLine ? (
                        <p className="truncate font-mono text-[10px] text-gray-500" title={idLine}>
                            {idLine}
                        </p>
                    ) : null}
                    {headerSubtitle && !idLine ? (
                        <p className="truncate text-[10px] text-gray-500">{headerSubtitle}</p>
                    ) : null}
                </div>
                <button
                    type="button"
                    disabled={!hasRenderable}
                    onClick={handleFitGeometry}
                    title="Fit map to geometry"
                    className={`shrink-0 whitespace-nowrap rounded border px-2 py-0.5 text-[10px] font-semibold ${
                        hasRenderable
                            ? "border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100"
                            : "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                    }`}
                >
                    Fit
                </button>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5">
                    {entityType !== "place" ? (
                        <label className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] text-gray-600">
                            <input
                                type="checkbox"
                                className="h-3 w-3 rounded border-gray-300"
                                checked={showVertices}
                                onChange={(e) => setShowVertices(e.target.checked)}
                            />
                            Show vertices
                        </label>
                    ) : null}
                    <div className="flex items-center rounded border border-gray-200 bg-white p-0.5">
                        {(
                            [
                                { id: "map" as const, label: "Map" },
                                { id: "satellite" as const, label: "Sat" },
                                { id: "hybrid" as const, label: "Hyb" },
                            ] as const
                        ).map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setBasemapMode(tab.id)}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                    basemapMode === tab.id
                                        ? "bg-gray-900 text-white"
                                        : "text-gray-600 hover:bg-gray-50"
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="p-2">
                {clientMounted ? (
                    <div ref={containerRef} className={viewportClass} />
                ) : (
                    <div className={viewportClass} aria-hidden />
                )}
                {!hasRenderable ? (
                    <p className="mt-2 px-1 text-xs text-amber-800">
                        No valid {geometryKind} geometry for this row. Enable list geometry in API fetch or open a row
                        with footprint data.
                    </p>
                ) : null}
            </div>
        </div>
    );
}
