"use client";

import area from "@turf/area";
import { type MutableRefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import maplibregl, { type FilterSpecification } from "maplibre-gl";

import {
    PLACE_MAP_DEFAULT_CENTER,
    PLACE_MAP_STYLE_BUILDINGS,
} from "@/src/components/map/placeMapConfig";
import { attachDashboardMapErrorHandler } from "@/src/components/map/mapErrorHandlers";

type PolygonGeom = {
    type: "Polygon";
    coordinates: number[][][];
};

type MultiPolygonGeom = {
    type: "MultiPolygon";
    coordinates: number[][][][];
};

/** Must match layer `id`s in the buildings basemap style — base map paint hidden when imagery shows. */
const BASE_MAP_LAYERS = [
    "background",
    "landuse",
    "water-polygons",
    "water-lines",
] as const;

/** Hidden in pure satellite mode only; keeps roads, POI, labels for hybrid/map. */
const SATELLITE_HIDE_VECTOR_LAYERS = [
    "admin-boundaries",
    "bus-routes",
    "roads-casing",
    "roads",
    "places-poi",
    "bus-stops",
    "road-labels",
    "place-labels",
] as const;

const SATELLITE_SOURCE_ID = "building-editor-satellite";
const SATELLITE_LAYER_ID = "building-editor-satellite";

const SATELLITE_TILES = [
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
] as const;

const SATELLITE_RASTER_SOURCE_MAX_ZOOM = 19;

export type BuildingEditorBasemapMode = "map" | "satellite" | "hybrid";

export type BuildingEditorMapDrawOutput = {
    geometryJson: string;
    areaSqM: number | null;
    vertexCount: number;
};

export type BuildingEditorMapProps = {
    geometryJson: string;
    onDrawOutput?: (output: BuildingEditorMapDrawOutput) => void;
    className?: string;
    showDebugPanel?: boolean;
    submissionError?: string;
};

function setLayerVisibility(map: maplibregl.Map, layerId: string, visible: boolean) {
    if (!map.getLayer(layerId)) {
        return;
    }

    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

function applyBasemapMode(map: maplibregl.Map, mode: BuildingEditorBasemapMode) {
    const imageryOn = mode !== "map";
    const hideBaseMap = imageryOn;
    const hideVectorOverlays = mode === "satellite";

    setLayerVisibility(map, SATELLITE_LAYER_ID, imageryOn);

    for (const id of BASE_MAP_LAYERS) {
        setLayerVisibility(map, id, !hideBaseMap);
    }

    for (const id of SATELLITE_HIDE_VECTOR_LAYERS) {
        setLayerVisibility(map, id, !hideVectorOverlays);
    }
}

export function parsePolygonOrMultiPolygon(text: string): PolygonGeom | MultiPolygonGeom | null {
    const trimmed = text.trim();

    if (!trimmed) {
        return null;
    }

    let value: unknown;

    try {
        value = JSON.parse(trimmed) as unknown;
    } catch {
        return null;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    const obj = value as { type?: unknown; coordinates?: unknown };

    if (obj.type === "Polygon" && Array.isArray(obj.coordinates)) {
        return value as PolygonGeom;
    }

    if (obj.type === "MultiPolygon" && Array.isArray(obj.coordinates)) {
        return value as MultiPolygonGeom;
    }

    return null;
}

export function exteriorVertexCount(g: PolygonGeom | MultiPolygonGeom): number {
    const ring =
        g.type === "Polygon"
            ? g.coordinates[0]
            : g.coordinates.length > 0
              ? g.coordinates[0]?.[0]
              : undefined;

    if (!ring || ring.length < 2) {
        return 0;
    }

    const first = ring[0];
    const last = ring[ring.length - 1];

    const closed =
        first &&
        last &&
        first.length >= 2 &&
        last.length >= 2 &&
        first[0] === last[0] &&
        first[1] === last[1];

    return closed ? ring.length - 1 : ring.length;
}

export function hasDrawableBuildingPolygon(text: string): boolean {
    const parsed = parsePolygonOrMultiPolygon(text.trim());

    if (!parsed) {
        return false;
    }

    return exteriorVertexCount(parsed) >= 3;
}

export function getGeoJsonBounds(g: PolygonGeom | MultiPolygonGeom): maplibregl.LngLatBoundsLike | null {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    const extend = (coords: number[][]) => {
        for (const pair of coords) {
            const lng = Number(pair[0]);
            const lat = Number(pair[1]);

            if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
                continue;
            }

            minLng = Math.min(minLng, lng);
            minLat = Math.min(minLat, lat);
            maxLng = Math.max(maxLng, lng);
            maxLat = Math.max(maxLat, lat);
        }
    };

    if (g.type === "Polygon") {
        for (const ring of g.coordinates) {
            extend(ring);
        }
    } else {
        for (const poly of g.coordinates) {
            for (const ring of poly) {
                extend(ring);
            }
        }
    }

    if (
        !Number.isFinite(minLng) ||
        !Number.isFinite(minLat) ||
        !Number.isFinite(maxLng) ||
        !Number.isFinite(maxLat)
    ) {
        return null;
    }

    const pad = 0.000_08;
    const w = maxLng - minLng;
    const h = maxLat - minLat;

    if (w < pad * 4 || h < pad * 4) {
        return [
            [minLng - pad * 8, minLat - pad * 8],
            [maxLng + pad * 8, maxLat + pad * 8],
        ];
    }

    return [
        [minLng, minLat],
        [maxLng, maxLat],
    ];
}

function centerLngLatFromParsed(g: PolygonGeom | MultiPolygonGeom): [number, number] | null {
    const bounds = getGeoJsonBounds(g);

    if (!bounds) {
        return null;
    }

    const [[west, south], [east, north]] = bounds as [[number, number], [number, number]];

    return [(west + east) / 2, (south + north) / 2];
}

/** Saved footprint overlay (from parent `geometryJson`). */
const CURRENT_BUILDING_SOURCE = "current-building-geometry";
const CURRENT_BUILDING_FILL = "current-building-geometry-fill";
const CURRENT_BUILDING_OUTLINE = "current-building-geometry-outline";
const CURRENT_BUILDING_CENTER = "current-building-center";

const CURRENT_BUILDING_ROLE_FOOTPRINT = "footprint";
const CURRENT_BUILDING_ROLE_MARKER = "marker";

/** Draft click-to-draw overlay (manual draw only) — separate sources for line vs vertices. */
const DRAFT_LINE_SOURCE_ID = "draft-building-line";
const DRAFT_LINE_LAYER_ID = "draft-building-line-layer";
const DRAFT_VERTICES_SOURCE_ID = "draft-building-vertices";
const DRAFT_VERTICES_LAYER_ID = "draft-building-vertices-circle";

const INITIAL_BUILDING_CAMERA_ZOOM = 14;

/** Aligned with building preview / tile fill palette (readable on basemap). */
const CURRENT_BUILDING_FILL_COLOR = "#ded8cf";
const CURRENT_BUILDING_OUTLINE_COLOR = "#9d9488";
const CURRENT_BUILDING_FILL_OPACITY = 0.78 as const;
const CURRENT_BUILDING_OUTLINE_WIDTH = 2.5 as const;

const CURRENT_BUILDING_FOOTPRINT_FILTER: FilterSpecification = [
    "==",
    ["get", "role"],
    CURRENT_BUILDING_ROLE_FOOTPRINT,
];

const CURRENT_BUILDING_MARKER_FILTER: FilterSpecification = [
    "==",
    ["get", "role"],
    CURRENT_BUILDING_ROLE_MARKER,
];

type CurrentBuildingFeatureCollection = {
    type: "FeatureCollection";
    features: Array<{
        type: "Feature";
        properties: { role: string };
        geometry: PolygonGeom | MultiPolygonGeom | { type: "Point"; coordinates: [number, number] };
    }>;
};

function buildCurrentBuildingFeatureCollection(parsed: PolygonGeom | MultiPolygonGeom): CurrentBuildingFeatureCollection {
    const centerPair = centerLngLatFromParsed(parsed);

    return {
        type: "FeatureCollection",
        features:
            centerPair !== null
                ? [
                      {
                          type: "Feature",
                          properties: { role: CURRENT_BUILDING_ROLE_FOOTPRINT },
                          geometry: parsed,
                      },
                      {
                          type: "Feature",
                          properties: { role: CURRENT_BUILDING_ROLE_MARKER },
                          geometry: {
                              type: "Point",
                              coordinates: centerPair,
                          },
                      },
                  ]
                : [
                      {
                          type: "Feature",
                          properties: { role: CURRENT_BUILDING_ROLE_FOOTPRINT },
                          geometry: parsed,
                      },
                  ],
    };
}

const IS_DEV = process.env.NODE_ENV === "development";

function exposeBuildingMapForDev(map: maplibregl.Map) {
    if (typeof window === "undefined" || !IS_DEV) {
        return;
    }

    const w = window as unknown as { __buildingMap?: maplibregl.Map };
    w.__buildingMap = map;
}

function devLog(...args: unknown[]) {
    if (IS_DEV) {
        console.log(...args);
    }
}

function mapRefStillValid(map: maplibregl.Map): boolean {
    try {
        return typeof map.project === "function";
    } catch {
        return false;
    }
}

function getOpenRingFromPolygon(p: PolygonGeom): [number, number][] {
    const r = p.coordinates[0];
    if (!r?.length) {
        return [];
    }

    const first = r[0];
    const last = r[r.length - 1];
    const closed =
        r.length > 3 &&
        first &&
        last &&
        first[0] === last[0] &&
        first[1] === last[1];

    if (closed) {
        return r.slice(0, -1).map((c) => [c[0], c[1]] as [number, number]);
    }

    return r.map((c) => [c[0], c[1]] as [number, number]);
}

function closedPolygonFromOpenRing(open: [number, number][]): PolygonGeom | null {
    if (open.length < 3) {
        return null;
    }

    const closed = [...open, open[0]] as [number, number][];
    return { type: "Polygon", coordinates: [closed] };
}

/** Stack draft below saved footprint so finished geometry stays visible on top. */
function bringEditorOverlayLayersToFront(map: maplibregl.Map) {
    if (map.getLayer(DRAFT_LINE_LAYER_ID)) {
        map.moveLayer(DRAFT_LINE_LAYER_ID);
    }

    if (map.getLayer(DRAFT_VERTICES_LAYER_ID)) {
        map.moveLayer(DRAFT_VERTICES_LAYER_ID);
    }

    if (map.getLayer(CURRENT_BUILDING_FILL)) {
        map.moveLayer(CURRENT_BUILDING_FILL);
        map.moveLayer(CURRENT_BUILDING_OUTLINE);
        if (map.getLayer(CURRENT_BUILDING_CENTER)) {
            map.moveLayer(CURRENT_BUILDING_CENTER);
        }
    }
}

function ensureCurrentBuildingGeometryLayers(map: maplibregl.Map) {
    if (!map.getSource(CURRENT_BUILDING_SOURCE)) {
        map.addSource(CURRENT_BUILDING_SOURCE, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        });
    }

    if (!map.getLayer(CURRENT_BUILDING_FILL)) {
        map.addLayer({
            id: CURRENT_BUILDING_FILL,
            type: "fill",
            source: CURRENT_BUILDING_SOURCE,
            filter: CURRENT_BUILDING_FOOTPRINT_FILTER,
            paint: {
                "fill-color": CURRENT_BUILDING_FILL_COLOR,
                "fill-opacity": CURRENT_BUILDING_FILL_OPACITY,
            },
        });
    }

    if (!map.getLayer(CURRENT_BUILDING_OUTLINE)) {
        map.addLayer({
            id: CURRENT_BUILDING_OUTLINE,
            type: "line",
            source: CURRENT_BUILDING_SOURCE,
            filter: CURRENT_BUILDING_FOOTPRINT_FILTER,
            paint: {
                "line-color": CURRENT_BUILDING_OUTLINE_COLOR,
                "line-opacity": 1,
                "line-width": CURRENT_BUILDING_OUTLINE_WIDTH,
            },
        });
    }

    if (!map.getLayer(CURRENT_BUILDING_CENTER)) {
        map.addLayer({
            id: CURRENT_BUILDING_CENTER,
            type: "circle",
            source: CURRENT_BUILDING_SOURCE,
            filter: CURRENT_BUILDING_MARKER_FILTER,
            paint: {
                "circle-radius": 8,
                "circle-color": "#f97316",
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 2,
            },
        });
    }

    bringEditorOverlayLayersToFront(map);
}

function ensureDraftBuildingLayers(map: maplibregl.Map) {
    if (!map.getSource(DRAFT_LINE_SOURCE_ID)) {
        map.addSource(DRAFT_LINE_SOURCE_ID, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        });
    }

    if (!map.getSource(DRAFT_VERTICES_SOURCE_ID)) {
        map.addSource(DRAFT_VERTICES_SOURCE_ID, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        });
    }

    if (!map.getLayer(DRAFT_LINE_LAYER_ID)) {
        map.addLayer({
            id: DRAFT_LINE_LAYER_ID,
            type: "line",
            source: DRAFT_LINE_SOURCE_ID,
            paint: {
                "line-color": "#2563eb",
                "line-width": 3,
                "line-opacity": 0.95,
            },
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
        });
    }

    if (!map.getLayer(DRAFT_VERTICES_LAYER_ID)) {
        map.addLayer({
            id: DRAFT_VERTICES_LAYER_ID,
            type: "circle",
            source: DRAFT_VERTICES_SOURCE_ID,
            paint: {
                "circle-radius": 5,
                "circle-color": "#2563eb",
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 2,
            },
        });
    }

    bringEditorOverlayLayersToFront(map);
}

function setDraftFromRing(map: maplibregl.Map, draftRing: [number, number][]) {
    ensureDraftBuildingLayers(map);

    const lineSrc = map.getSource(DRAFT_LINE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const vertSrc = map.getSource(DRAFT_VERTICES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;

    if (!lineSrc || !vertSrc) {
        return;
    }

    const vertexFeatures = draftRing.map(([lng, lat]) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point" as const, coordinates: [lng, lat] as [number, number] },
    }));

    vertSrc.setData({
        type: "FeatureCollection",
        features: vertexFeatures,
    });

    if (draftRing.length >= 2) {
        lineSrc.setData({
            type: "FeatureCollection",
            features: [
                {
                    type: "Feature",
                    properties: {},
                    geometry: {
                        type: "LineString",
                        coordinates: draftRing.map(([lng, lat]) => [lng, lat]),
                    },
                },
            ],
        });
    } else {
        lineSrc.setData({ type: "FeatureCollection", features: [] });
    }

    bringEditorOverlayLayersToFront(map);
}

/** Clears draft vertex and line GeoJSON sources only (does not touch saved footprint). */
function clearDraftGeometry(map: maplibregl.Map): void {
    const lineSrc = map.getSource(DRAFT_LINE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const vertSrc = map.getSource(DRAFT_VERTICES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;

    if (lineSrc) {
        lineSrc.setData({ type: "FeatureCollection", features: [] });
    }

    if (vertSrc) {
        vertSrc.setData({ type: "FeatureCollection", features: [] });
    }
}

/** Removes the saved footprint from the editor overlay source only (does not modify draft or basemap tile layers). */
function clearCurrentGeometry(map: maplibregl.Map): void {
    ensureCurrentBuildingGeometryLayers(map);
    const currentSrc = map.getSource(CURRENT_BUILDING_SOURCE) as maplibregl.GeoJSONSource | undefined;

    if (currentSrc) {
        currentSrc.setData({ type: "FeatureCollection", features: [] });
    }

    bringEditorOverlayLayersToFront(map);
}

function setMapInteractionCursor(map: maplibregl.Map | null, cursor: "crosshair" | "default") {
    const canvas = map?.getCanvas();

    if (!canvas) {
        return;
    }

    canvas.style.cursor = cursor === "crosshair" ? "crosshair" : "";
}

function scheduleOneShotInitialBuildingCamera(
    map: maplibregl.Map,
    hasAppliedRef: MutableRefObject<boolean>,
    geometry: PolygonGeom | MultiPolygonGeom
): () => void {
    let detached = false;
    let frame = 0;
    let rafBumps = 0;
    const maxRafBumps = 480;

    const detach = () => {
        detached = true;
        map.off("sourcedata", onSourceData);
        map.off("idle", onIdle);
        cancelAnimationFrame(frame);
    };

    const tryApply = () => {
        if (detached || hasAppliedRef.current || !mapRefStillValid(map)) {
            return;
        }

        if (!map.isStyleLoaded()) {
            return;
        }

        const sourceId = CURRENT_BUILDING_SOURCE;
        const srcReady = !!map.getSource(sourceId);
        const fillReady = !!map.getLayer(CURRENT_BUILDING_FILL);
        const outlineReady = !!map.getLayer(CURRENT_BUILDING_OUTLINE);

        let sourceRenderable = true;

        try {
            if (typeof map.isSourceLoaded === "function") {
                sourceRenderable = map.isSourceLoaded(sourceId);
            }
        } catch {
            sourceRenderable = true;
        }

        if (!srcReady || !fillReady || !outlineReady || !sourceRenderable) {
            return;
        }

        const bounds = getGeoJsonBounds(geometry);

        try {
            map.resize();

            if (bounds) {
                map.fitBounds(bounds, {
                    padding: 72,
                    maxZoom: 22,
                    duration: 900,
                });
            } else {
                const c = centerLngLatFromParsed(geometry);

                if (c) {
                    map.flyTo({
                        center: c,
                        zoom: INITIAL_BUILDING_CAMERA_ZOOM,
                        duration: 900,
                    });
                }
            }
        } catch {
            detach();
            return;
        }

        hasAppliedRef.current = true;
        devLog("initial building camera applied (animated)", geometry.type);
        detach();
    };

    const onIdle = () => {
        tryApply();
    };

    const onSourceData = (event: maplibregl.MapSourceDataEvent) => {
        if (event.sourceId !== CURRENT_BUILDING_SOURCE) {
            return;
        }

        tryApply();
    };

    map.on("sourcedata", onSourceData);
    map.on("idle", onIdle);

    const bump = () => {
        tryApply();

        if (detached || hasAppliedRef.current) {
            return;
        }

        if (rafBumps >= maxRafBumps) {
            detach();
            return;
        }

        rafBumps += 1;
        frame = requestAnimationFrame(bump);
    };

    frame = requestAnimationFrame(bump);
    queueMicrotask(tryApply);

    return detach;
}

function polygonStats(g: PolygonGeom | MultiPolygonGeom | null): Pick<BuildingEditorMapDrawOutput, "areaSqM" | "vertexCount"> {
    if (!g) {
        return { areaSqM: null, vertexCount: 0 };
    }

    try {
        const areaSqM = area({ type: "Feature", properties: {}, geometry: g });
        return { areaSqM, vertexCount: exteriorVertexCount(g) };
    } catch {
        return { areaSqM: null, vertexCount: exteriorVertexCount(g) };
    }
}

type ToolUi = "draw" | "edit" | "navigate";

const DRAW_UI_LABEL_POLYGON = "draw";
const DRAW_UI_LABEL_NAV = "navigate";

export default function BuildingEditorMap({
    geometryJson,
    onDrawOutput,
    className,
    showDebugPanel = false,
    submissionError = "",
}: BuildingEditorMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);

    const onDrawOutputRef = useRef(onDrawOutput);

    useEffect(() => {
        onDrawOutputRef.current = onDrawOutput;
    }, [onDrawOutput]);

    const skipExternalReloadRef = useRef(false);
    /** One-shot: after emitting a non-null geometry locally, skip the next sync that would clear the map with stale empty props. */
    const suppressNextEmptySourceClearRef = useRef(false);
    const hasAppliedInitialBuildingCameraRef = useRef(false);
    const initialBuildingCameraCleanupRef = useRef<(() => void) | null>(null);

    const draftPointsRef = useRef<[number, number][]>([]);
    const drawModeRef = useRef(false);
    const handleMapClickRef = useRef<(e: maplibregl.MapMouseEvent) => void>(() => {});
    const editMarkersRef = useRef<maplibregl.Marker[]>([]);
    const openRingEditRef = useRef<[number, number][] | null>(null);

    const [mapReady, setMapReady] = useState(false);
    const [basemapMode, setBasemapMode] = useState<BuildingEditorBasemapMode>("map");
    const [zoomDisplay, setZoomDisplay] = useState<string>("—");
    const [manualDrawing, setManualDrawing] = useState(false);
    const [draftPointsCount, setDraftPointsCount] = useState(0);
    const [vertexEditActive, setVertexEditActive] = useState(false);
    const [drawUiMode, setDrawUiMode] = useState<ToolUi>(DRAW_UI_LABEL_NAV);

    const [stats, setStats] = useState<{ areaSqM: number | null; vertexCount: number }>({
        areaSqM: null,
        vertexCount: 0,
    });

    const geometryJsonRef = useRef(geometryJson);

    useEffect(() => {
        geometryJsonRef.current = geometryJson;
    }, [geometryJson]);

    const emitGeometryToParent = useCallback((g: PolygonGeom | MultiPolygonGeom | null) => {
        const outStats = polygonStats(g);
        setStats(outStats);
        skipExternalReloadRef.current = true;
        suppressNextEmptySourceClearRef.current = g !== null;
        onDrawOutputRef.current?.({
            geometryJson: g ? JSON.stringify(g, null, 2) : "",
            areaSqM: outStats.areaSqM,
            vertexCount: outStats.vertexCount,
        });
        devLog("geometry changed");
    }, []);

    const removeEditMarkerElements = useCallback(() => {
        for (const m of editMarkersRef.current) {
            m.remove();
        }

        editMarkersRef.current = [];
        openRingEditRef.current = null;
    }, []);

    const clearEditMarkers = useCallback(() => {
        removeEditMarkerElements();
        setVertexEditActive(false);
    }, [removeEditMarkerElements]);

    const setupPolygonVertexMarkers = useCallback(
        (map: maplibregl.Map, poly: PolygonGeom, emitAfterDrag: (p: PolygonGeom) => void) => {
            clearEditMarkers();
            const open = getOpenRingFromPolygon(poly);

            if (open.length < 3) {
                return;
            }

            openRingEditRef.current = open.map((p) => [p[0], p[1]]);

            open.forEach((coord, index) => {
                const marker = new maplibregl.Marker({ draggable: true, color: "#2563eb" })
                    .setLngLat(coord)
                    .addTo(map);

                marker.on("dragend", () => {
                    const ll = marker.getLngLat();
                    const ring = openRingEditRef.current;

                    if (!ring) {
                        return;
                    }

                    ring[index] = [ll.lng, ll.lat];
                    const rebuilt = closedPolygonFromOpenRing(ring);

                    if (!rebuilt) {
                        return;
                    }

                    emitAfterDrag(rebuilt);
                    devLog("vertex edited");
                });

                editMarkersRef.current.push(marker);
            });

            setVertexEditActive(true);
        },
        [clearEditMarkers]
    );

    const finishManualPolygon = useCallback(() => {
        const ring = draftPointsRef.current;

        if (ring.length < 3) {
            return;
        }

        const poly = closedPolygonFromOpenRing(ring);

        if (!poly) {
            return;
        }

        const map = mapRef.current;

        if (map?.isStyleLoaded()) {
            ensureCurrentBuildingGeometryLayers(map);
            const currentSrc = map.getSource(CURRENT_BUILDING_SOURCE) as maplibregl.GeoJSONSource | undefined;

            if (currentSrc) {
                currentSrc.setData(buildCurrentBuildingFeatureCollection(poly));
                devLog("current geometry source updated after finish");
            }

            bringEditorOverlayLayersToFront(map);
        }

        devLog("polygon finished", poly);

        emitGeometryToParent(poly);

        if (map?.isStyleLoaded()) {
            clearDraftGeometry(map);
            devLog("draft cleared after finish");
            bringEditorOverlayLayersToFront(map);
        }

        draftPointsRef.current = [];
        setDraftPointsCount(0);
        setManualDrawing(false);
        drawModeRef.current = false;
        setDrawUiMode(DRAW_UI_LABEL_NAV);

        if (map?.isStyleLoaded()) {
            setMapInteractionCursor(map, "default");
        }

        if (map?.isStyleLoaded()) {
            const b = getGeoJsonBounds(poly);

            if (b) {
                requestAnimationFrame(() => {
                    map.resize();
                    map.fitBounds(b, {
                        padding: 80,
                        maxZoom: 22,
                        duration: 500,
                    });
                });
            }
        }
    }, [emitGeometryToParent]);

    const onBasemapMode = useCallback((mode: BuildingEditorBasemapMode) => {
        setBasemapMode(mode);
    }, []);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) {
            return;
        }

        let cancelled = false;

        const map = new maplibregl.Map({
            container: containerRef.current,
            style: PLACE_MAP_STYLE_BUILDINGS,
            center: PLACE_MAP_DEFAULT_CENTER,
            zoom: INITIAL_BUILDING_CAMERA_ZOOM,
            minZoom: 0,
            maxZoom: 22,
            scrollZoom: true,
            doubleClickZoom: true,
        });

        map.addControl(new maplibregl.NavigationControl({ showZoom: true, showCompass: true }), "top-right");

        attachDashboardMapErrorHandler(map, "BuildingEditorMap");

        const relayMapClick = (e: maplibregl.MapMouseEvent) => {
            handleMapClickRef.current(e);
        };

        map.on("load", () => {
            if (cancelled) {
                return;
            }

            if (!map.getSource(SATELLITE_SOURCE_ID)) {
                map.addSource(SATELLITE_SOURCE_ID, {
                    type: "raster",
                    tiles: [...SATELLITE_TILES],
                    tileSize: 256,
                    maxzoom: SATELLITE_RASTER_SOURCE_MAX_ZOOM,
                    attribution:
                        '<a href="https://www.esri.com/">© Esri</a> — Sources: Esri, Maxar, Earthstar Geographics',
                });
            }

            if (!map.getLayer(SATELLITE_LAYER_ID)) {
                map.addLayer(
                    {
                        id: SATELLITE_LAYER_ID,
                        type: "raster",
                        source: SATELLITE_SOURCE_ID,
                        layout: { visibility: "none" },
                        paint: {
                            "raster-opacity": 1,
                            "raster-resampling": "linear",
                        },
                    },
                    "landuse"
                );
            }

            ensureDraftBuildingLayers(map);
            ensureCurrentBuildingGeometryLayers(map);

            mapRef.current = map;

            exposeBuildingMapForDev(map);

            const syncZoomDisplay = () => {
                if (cancelled) {
                    return;
                }

                setZoomDisplay(map.getZoom().toFixed(2));
            };

            syncZoomDisplay();
            map.on("zoom", syncZoomDisplay);
            map.on("moveend", syncZoomDisplay);

            map.on("click", relayMapClick);

            setMapReady(true);
        });

        return () => {
            cancelled = true;

            hasAppliedInitialBuildingCameraRef.current = false;

            for (const m of editMarkersRef.current) {
                m.remove();
            }

            editMarkersRef.current = [];

            try {
                map.off("click", relayMapClick);
            } catch {
                /* ignore */
            }

            mapRef.current = null;

            if (typeof window !== "undefined") {
                delete (window as unknown as { __buildingMap?: maplibregl.Map }).__buildingMap;
            }

            setZoomDisplay("—");
            map.remove();
            setMapReady(false);
            setStats({ areaSqM: null, vertexCount: 0 });
        };
    }, []);

    useEffect(() => {
        const map = mapRef.current;

        if (!mapReady || !map?.isStyleLoaded()) {
            return;
        }

        applyBasemapMode(map, basemapMode);
    }, [basemapMode, mapReady]);

    useEffect(() => {
        const cancelInitialCamera = () => {
            initialBuildingCameraCleanupRef.current?.();
            initialBuildingCameraCleanupRef.current = null;
        };

        cancelInitialCamera();

        const map = mapRef.current;

        if (!mapReady || !map?.isStyleLoaded()) {
            return () => {
                cancelInitialCamera();
            };
        }

        const trimmed = geometryJson.trim();
        const parsed = parsePolygonOrMultiPolygon(trimmed);

        if (IS_DEV) {
            devLog("current geometry prop", geometryJson);
            devLog("current geometry parsed", parsed);
        }

        ensureCurrentBuildingGeometryLayers(map);

        const currentBuildingSrc = map.getSource(CURRENT_BUILDING_SOURCE) as maplibregl.GeoJSONSource | undefined;

        if (currentBuildingSrc) {
            if (parsed) {
                currentBuildingSrc.setData(buildCurrentBuildingFeatureCollection(parsed));
                devLog("current building geometry rendered");
                bringEditorOverlayLayersToFront(map);
            } else if (suppressNextEmptySourceClearRef.current) {
                suppressNextEmptySourceClearRef.current = false;
            } else {
                currentBuildingSrc.setData({ type: "FeatureCollection", features: [] });
            }
        }

        if (!parsed) {
            hasAppliedInitialBuildingCameraRef.current = false;
        }

        if (parsed && !hasAppliedInitialBuildingCameraRef.current) {
            initialBuildingCameraCleanupRef.current = scheduleOneShotInitialBuildingCamera(
                map,
                hasAppliedInitialBuildingCameraRef,
                parsed
            );
        }

        if (skipExternalReloadRef.current) {
            skipExternalReloadRef.current = false;

            if (parsed && currentBuildingSrc) {
                bringEditorOverlayLayersToFront(map);
            }

            return () => {
                cancelInitialCamera();
            };
        }

        removeEditMarkerElements();
        queueMicrotask(() => {
            setVertexEditActive(false);

            if (!parsed) {
                setStats({ areaSqM: null, vertexCount: 0 });
            } else {
                setStats(polygonStats(parsed));
            }
        });

        if (map.isStyleLoaded()) {
            setDraftFromRing(map, drawModeRef.current ? draftPointsRef.current : []);
        }

        return () => {
            cancelInitialCamera();
        };
    }, [geometryJson, mapReady, removeEditMarkerElements]);

    useEffect(() => {
        if (!mapReady || !containerRef.current || !mapRef.current) {
            return;
        }

        const observer = new ResizeObserver(() => {
            mapRef.current?.resize();
        });

        observer.observe(containerRef.current);

        return () => observer.disconnect();
    }, [mapReady]);

    const activateManualDraw = useCallback(() => {
        const parsed = parsePolygonOrMultiPolygon(geometryJsonRef.current.trim());

        if (parsed && exteriorVertexCount(parsed) >= 3) {
            const ok = window.confirm(
                "Replace the current polygon? Your clicks will start a new outline."
            );

            if (!ok) {
                return;
            }
        }

        devLog("draw mode enabled");

        clearEditMarkers();
        draftPointsRef.current = [];
        setDraftPointsCount(0);
        drawModeRef.current = true;
        setManualDrawing(true);
        setDrawUiMode(DRAW_UI_LABEL_POLYGON);

        const map = mapRef.current;

        if (map?.isStyleLoaded()) {
            clearDraftGeometry(map);
            setDraftFromRing(map, []);
            setMapInteractionCursor(map, "crosshair");
        }
    }, [clearEditMarkers]);

    const activateEditMode = useCallback(() => {
        setManualDrawing(false);
        drawModeRef.current = false;
        draftPointsRef.current = [];
        setDraftPointsCount(0);
        setDrawUiMode("edit");

        const map = mapRef.current;

        if (!map?.isStyleLoaded()) {
            setDrawUiMode(DRAW_UI_LABEL_NAV);
            return;
        }

        clearDraftGeometry(map);
        setMapInteractionCursor(map, "default");

        const parsed = parsePolygonOrMultiPolygon(geometryJsonRef.current.trim());

        if (!parsed) {
            window.alert("No polygon to edit. Use Draw to create one.");
            setDrawUiMode(DRAW_UI_LABEL_NAV);
            return;
        }

        if (parsed.type === "MultiPolygon") {
            window.alert(
                "Vertex editing applies to a single Polygon. Use Draw to redraw this footprint, or edit the GeoJSON below."
            );
            setDrawUiMode(DRAW_UI_LABEL_NAV);
            return;
        }

        setupPolygonVertexMarkers(map, parsed, (next) => {
            emitGeometryToParent(next);
        });
    }, [emitGeometryToParent, setupPolygonVertexMarkers]);

    const deletePolygonFeatures = useCallback(() => {
        if (!hasDrawableBuildingPolygon(geometryJsonRef.current)) {
            return;
        }

        clearEditMarkers();

        const map = mapRef.current;

        if (map?.isStyleLoaded()) {
            clearCurrentGeometry(map);
            clearDraftGeometry(map);
            bringEditorOverlayLayersToFront(map);
            setMapInteractionCursor(map, "default");
        }

        draftPointsRef.current = [];
        setDraftPointsCount(0);
        setManualDrawing(false);
        drawModeRef.current = false;
        setDrawUiMode(DRAW_UI_LABEL_NAV);

        emitGeometryToParent(null);
        hasAppliedInitialBuildingCameraRef.current = false;
        devLog("current geometry deleted from form");
    }, [clearEditMarkers, emitGeometryToParent]);

    const clearDraftOnly = useCallback(() => {
        if (draftPointsRef.current.length === 0) {
            return;
        }

        draftPointsRef.current = [];
        setDraftPointsCount(0);
        drawModeRef.current = false;
        setManualDrawing(false);
        setDrawUiMode(DRAW_UI_LABEL_NAV);

        const map = mapRef.current;

        if (map?.isStyleLoaded()) {
            clearDraftGeometry(map);
            setMapInteractionCursor(map, "default");
        }

        devLog("draft geometry cleared");
    }, []);

    const [copyFeedback, setCopyFeedback] = useState("");

    const fitToPolygon = useCallback(() => {
        const map = mapRef.current;
        const parsed = parsePolygonOrMultiPolygon(geometryJson.trim());

        if (!map?.isStyleLoaded() || !parsed) {
            return;
        }

        const b = getGeoJsonBounds(parsed);

        if (!b) {
            return;
        }

        requestAnimationFrame(() => {
            map.resize();
            map.fitBounds(b, {
                padding: 80,
                maxZoom: 22,
                duration: 500,
            });
        });
    }, [geometryJson]);

    const copyGeoJson = useCallback(async () => {
        const text = geometryJson.trim();

        if (!text) {
            setCopyFeedback("Nothing to copy");
            window.setTimeout(() => setCopyFeedback(""), 2000);
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            setCopyFeedback("Copied");
        } catch {
            setCopyFeedback("Copy failed");
        }

        window.setTimeout(() => setCopyFeedback(""), 2000);
    }, [geometryJson]);

    useLayoutEffect(() => {
        handleMapClickRef.current = (e: maplibregl.MapMouseEvent) => {
            devLog("map click received");
            devLog("draw mode active", drawModeRef.current);

            if (!drawModeRef.current) {
                return;
            }

            e.originalEvent?.preventDefault?.();

            const map = mapRef.current;

            if (!map?.isStyleLoaded()) {
                return;
            }

            const lng = e.lngLat.lng;
            const lat = e.lngLat.lat;

            draftPointsRef.current.push([lng, lat]);
            setDraftPointsCount(draftPointsRef.current.length);
            devLog("draft point added", lng, lat);

            setDraftFromRing(map, draftPointsRef.current);
            devLog("draft source updated");
        };
    });

    const debugParsed = parsePolygonOrMultiPolygon(geometryJson.trim());
    const debugCentroid = debugParsed ? centerLngLatFromParsed(debugParsed) : null;
    const hasGeometryForDelete = hasDrawableBuildingPolygon(geometryJson);
    const hasDraftToClear = draftPointsCount > 0;

    const btnBasemap = (mode: BuildingEditorBasemapMode, label: string) => (
        <button
            key={mode}
            type="button"
            onClick={() => onBasemapMode(mode)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                basemapMode === mode
                    ? "bg-gray-900 text-white shadow"
                    : "bg-white/90 text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
            }`}
        >
            {label}
        </button>
    );

    return (
        <div className={className ?? ""}>
            <div className="relative h-[420px] w-full overflow-hidden rounded-lg border border-gray-300 bg-gray-200 shadow-inner">
                <div ref={containerRef} className="absolute inset-0 h-full w-full" />

                <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[min(100%-1.5rem,28rem)] flex-col gap-2">
                    <div className="pointer-events-auto flex flex-wrap gap-1.5 rounded-lg bg-white/95 p-1.5 shadow-md ring-1 ring-gray-200">
                        {btnBasemap("map", "Map")}
                        {btnBasemap("satellite", "Satellite")}
                        {btnBasemap("hybrid", "Hybrid")}
                    </div>

                    <div className="pointer-events-auto flex flex-wrap gap-1.5 rounded-lg bg-white/95 p-1.5 shadow-md ring-1 ring-gray-200">
                        <button
                            type="button"
                            onClick={() => activateManualDraw()}
                            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                                drawUiMode === DRAW_UI_LABEL_POLYGON
                                    ? "bg-blue-800 text-white shadow"
                                    : "bg-white/90 text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
                            }`}
                        >
                            Draw
                        </button>
                        <button
                            type="button"
                            onClick={() => activateEditMode()}
                            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                                drawUiMode === "edit" && vertexEditActive
                                    ? "bg-blue-800 text-white shadow"
                                    : "bg-white/90 text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
                            }`}
                        >
                            Edit
                        </button>
                        {manualDrawing && draftPointsCount >= 3 ? (
                            <button
                                type="button"
                                onClick={() => finishManualPolygon()}
                                className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-emerald-800"
                            >
                                Finish polygon
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={deletePolygonFeatures}
                            disabled={!hasGeometryForDelete}
                            className={`rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-gray-300 ${
                                hasGeometryForDelete
                                    ? "bg-white/90 text-gray-800 hover:bg-gray-50"
                                    : "cursor-not-allowed bg-gray-100 text-gray-400"
                            }`}
                        >
                            Delete
                        </button>
                        <button
                            type="button"
                            onClick={clearDraftOnly}
                            disabled={!hasDraftToClear}
                            className={`rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-gray-300 ${
                                hasDraftToClear
                                    ? "bg-white/90 text-gray-800 hover:bg-gray-50"
                                    : "cursor-not-allowed bg-gray-100 text-gray-400"
                            }`}
                        >
                            Clear
                        </button>
                    </div>
                </div>

                {!showDebugPanel ? (
                    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md bg-black/65 px-2 py-1 font-mono text-[11px] tabular-nums text-white shadow">
                        zoom {zoomDisplay}
                    </div>
                ) : null}
            </div>

            {showDebugPanel ? (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/90 p-3 font-mono text-[11px] text-gray-900 shadow-sm ring-1 ring-amber-100">
                    <div className="mb-2 flex items-center justify-between gap-2 border-b border-amber-200/80 pb-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                            Debug (dashboard only)
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => void copyGeoJson()}
                                className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-950 hover:bg-amber-100/80"
                            >
                                Copy GeoJSON
                            </button>
                            <button
                                type="button"
                                onClick={() => fitToPolygon()}
                                className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-950 hover:bg-amber-100/80"
                            >
                                Fit to polygon
                            </button>
                            {copyFeedback ? (
                                <span className="text-[10px] font-normal text-amber-800">{copyFeedback}</span>
                            ) : null}
                        </div>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                        <dt className="text-amber-800/90">zoom</dt>
                        <dd className="tabular-nums">{zoomDisplay}</dd>
                        <dt className="text-amber-800/90">area_m2</dt>
                        <dd className="tabular-nums">
                            {stats.areaSqM != null ? stats.areaSqM.toFixed(2) : "—"}
                        </dd>
                        <dt className="text-amber-800/90">vertex_count</dt>
                        <dd className="tabular-nums">{stats.vertexCount}</dd>
                        <dt className="text-amber-800/90">centroid</dt>
                        <dd className="tabular-nums break-all">
                            {debugCentroid
                                ? `${debugCentroid[1].toFixed(6)}, ${debugCentroid[0].toFixed(6)} (lat, lng)`
                                : "—"}
                        </dd>
                        <dt className="text-amber-800/90">geometry.type</dt>
                        <dd>{debugParsed ? debugParsed.type : "—"}</dd>
                    </dl>
                    {submissionError.trim() ? (
                        <div className="mt-3 border-t border-amber-200/80 pt-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-red-800">
                                API / submit error
                            </div>
                            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap wrap-break-word text-[11px] text-red-900">
                                {submissionError}
                            </pre>
                        </div>
                    ) : null}
                </div>
            ) : (
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-700">
                    <span>
                        Area (approx.):{" "}
                        <strong className="tabular-nums">
                            {stats.areaSqM != null ? `${stats.areaSqM.toFixed(1)} m²` : "—"}
                        </strong>
                    </span>
                    <span>
                        Exterior vertices (first polygon):{" "}
                        <strong className="tabular-nums">{stats.vertexCount}</strong>
                    </span>
                </div>
            )}

            <p className="mt-1.5 text-xs text-gray-500">
                Gray fills are buildings from the live tile layer. <strong>Draw</strong>: click corners, then{" "}
                <strong>Finish polygon</strong>. <strong>Edit</strong>: drag vertices on a single Polygon — MultiPolygon
                footprints use Draw (confirm) or the JSON field. <strong>Delete</strong> clears the saved footprint from
                this form only. <strong>Clear</strong> removes in-progress clicks only.
            </p>
        </div>
    );
}
