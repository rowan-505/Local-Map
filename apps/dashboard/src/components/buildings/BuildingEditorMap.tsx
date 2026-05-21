"use client";

import area from "@turf/area";
import { type MutableRefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import maplibregl, { type FilterSpecification } from "maplibre-gl";

import {
    applyDashboardMergedBasemapMode,
    ensureDataReviewSatelliteLayer,
    type DataReviewBasemapMode,
} from "@/src/components/map/dataReviewBasemap";
import {
    MAP_EDITOR_TOOLBAR_CLASS,
    MAP_EDITOR_VIEWPORT_BUILDING_CLASS,
    mapEditorBtnDanger,
    mapEditorBtnPrimary,
    mapEditorBtnSuccess,
} from "@/src/components/map/mapPreviewUi";
import { syncVertexPreviewLayer } from "@/src/components/map/mapVertexPreview";
import {
    PLACE_MAP_DEFAULT_CENTER,
    refreshBuildingTiles,
    refreshPlaceTiles,
    refreshRoadLabelTiles,
    refreshStreetTiles,
} from "@/src/components/map/placeMapConfig";
import { fetchDashboardPlaceMapStyle } from "@/src/components/map/dashboardBasemapStyle";
import { ensurePmtilesProtocol } from "@local-map/map-style/registerPmtilesProtocol";
import { useDashboardTileVersions } from "@/src/components/map/BuildingTileVersionContext";
import { attachDashboardMapErrorHandler } from "@/src/components/map/mapErrorHandlers";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import { dashDevLog } from "@/src/lib/dashDevLog";
import { attachMapLibreDevDebugMap } from "@/src/lib/mapLibreDebug";
import { logDashboardGlyphServingHealthInDev } from "@/src/lib/map/dashboardGlyphDevCheck";
import {
    dashboardComplexTextTransformRequest,
    ensureDashboardMaplibreComplexTextPlugin,
} from "@/src/lib/map/dashboardMaplibreComplexText";

type PolygonGeom = {
    type: "Polygon";
    coordinates: number[][][];
};

type MultiPolygonGeom = {
    type: "MultiPolygon";
    coordinates: number[][][][];
};

/** @deprecated Use {@link DataReviewBasemapMode}. */
export type BuildingEditorBasemapMode = DataReviewBasemapMode;

export type BuildingEditorMapDrawOutput = {
    geometryJson: string;
    areaSqM: number | null;
    vertexCount: number;
};

export type BuildingEditorMapProps = {
    geometryJson: string;
    onDrawOutput?: (output: BuildingEditorMapDrawOutput) => void;
    className?: string;
    editorMapSurfaceRef?: MutableRefObject<maplibregl.Map | null>;
    basemapMode: DataReviewBasemapMode;
    showVertexPreview?: boolean;
};

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
    const countRing = (ring: number[][] | undefined): number => {
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
    };

    if (g.type === "Polygon") {
        return countRing(g.coordinates[0]);
    }

    return g.coordinates.reduce((sum, poly) => sum + countRing(poly[0]), 0);
}

export function hasDrawableBuildingPolygon(text: string): boolean {
    const parsed = parsePolygonOrMultiPolygon(text.trim());

    if (!parsed) {
        return false;
    }

    return exteriorVertexCount(parsed) >= 3;
}

type NormalizedEditableBuildingGeometry = {
    displayGeometry: PolygonGeom | MultiPolygonGeom;
    editableGeometry: PolygonGeom | null;
    vertexEditingMessage: string | null;
};

export function normalizeEditableBuildingGeometry(
    geometry: PolygonGeom | MultiPolygonGeom
): NormalizedEditableBuildingGeometry {
    if (geometry.type === "Polygon") {
        return {
            displayGeometry: geometry,
            editableGeometry: geometry,
            vertexEditingMessage: null,
        };
    }

    if (geometry.coordinates.length === 1) {
        const editableGeometry: PolygonGeom = {
            type: "Polygon",
            coordinates: geometry.coordinates[0],
        };

        return {
            displayGeometry: editableGeometry,
            editableGeometry,
            vertexEditingMessage: null,
        };
    }

    return {
        displayGeometry: geometry,
        editableGeometry: null,
        vertexEditingMessage:
            "This building is a MultiPolygon. Use Draw/redraw to replace it, or edit GeoJSON manually.",
    };
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

/** API-selected editable footprint overlay; PMTiles/Martin remain basemap context only. */
const CURRENT_BUILDING_SOURCE = "selected-building-source";
const CURRENT_BUILDING_FILL = "selected-building-fill";
const CURRENT_BUILDING_OUTLINE = "selected-building-outline";
const CURRENT_BUILDING_CENTER = "selected-building-center";

const CURRENT_BUILDING_ROLE_FOOTPRINT = "footprint";
const CURRENT_BUILDING_ROLE_MARKER = "marker";

/** Draft click-to-draw overlay (manual draw only) — separate sources for line vs vertices. */
const DRAFT_LINE_SOURCE_ID = "draft-building-line";
const DRAFT_LINE_LAYER_ID = "draft-building-line-layer";
const DRAFT_VERTICES_SOURCE_ID = "draft-building-vertices";
const DRAFT_VERTICES_LAYER_ID = "draft-building-vertices-circle";

const INITIAL_BUILDING_CAMERA_ZOOM = 14;

/** Bright overlay so the API-selected building is visible above static PMTiles buildings. */
const CURRENT_BUILDING_FILL_COLOR = "#06b6d4";
const CURRENT_BUILDING_OUTLINE_COLOR = "#0891b2";
const CURRENT_BUILDING_FILL_OPACITY = 0.35 as const;
const CURRENT_BUILDING_OUTLINE_WIDTH = 4 as const;

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
/** Small draggable handle — matches {@link syncVertexPreviewLayer} dots, not default MapLibre pins. */
function createBuildingVertexHandleElement(): HTMLDivElement {
    const el = document.createElement("div");
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", "Polygon vertex");
    el.style.boxSizing = "border-box";
    el.style.width = "10px";
    el.style.height = "10px";
    el.style.borderRadius = "9999px";
    el.style.background = "#1f2937";
    el.style.opacity = "0.85";
    el.style.border = "1px solid #ffffff";
    el.style.cursor = "grab";
    el.style.touchAction = "none";
    el.style.boxShadow = "0 0 0 1px rgba(15, 23, 42, 0.12)";
    return el;
}

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
    // PMTiles/Martin are basemap context only; the selected editable building is API GeoJSON.
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
                    padding: 80,
                    maxZoom: 19,
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
    editorMapSurfaceRef,
    basemapMode,
    showVertexPreview = false,
}: BuildingEditorMapProps) {
    const { buildingTileVersion, streetTileVersion, placeTileVersion, roadLabelTileVersion } =
        useDashboardTileVersions();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const clientMounted = useClientMounted();

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
    const [manualDrawing, setManualDrawing] = useState(false);
    const [draftPointsCount, setDraftPointsCount] = useState(0);
    const [vertexEditActive, setVertexEditActive] = useState(false);
    const [vertexEditMessage, setVertexEditMessage] = useState("");
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
                const marker = new maplibregl.Marker({
                    element: createBuildingVertexHandleElement(),
                    draggable: true,
                    anchor: "center",
                })
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

        if (map) {
            ensureCurrentBuildingGeometryLayers(map);
            const currentSrc = map.getSource(CURRENT_BUILDING_SOURCE) as maplibregl.GeoJSONSource | undefined;

            if (currentSrc) {
                currentSrc.setData(buildCurrentBuildingFeatureCollection(poly));
                dashDevLog("building:map:selected-api-overlay-updated-after-draw-finish");
                devLog("current geometry source updated after finish");
            }

            bringEditorOverlayLayersToFront(map);
        }

        devLog("polygon finished", poly);

        emitGeometryToParent(poly);

        if (map) {
            clearDraftGeometry(map);
            devLog("draft cleared after finish");
            bringEditorOverlayLayersToFront(map);
        }

        draftPointsRef.current = [];
        setDraftPointsCount(0);
        setManualDrawing(false);
        drawModeRef.current = false;
        setDrawUiMode(DRAW_UI_LABEL_NAV);

        if (map) {
            setMapInteractionCursor(map, "default");
        }

        if (map) {
            const b = getGeoJsonBounds(poly);

            if (b) {
                requestAnimationFrame(() => {
                    map.resize();
                    map.fitBounds(b, {
                        padding: 80,
                        maxZoom: 19,
                        duration: 500,
                    });
                });
            }
        }
    }, [emitGeometryToParent]);

    useEffect(() => {
        if (!clientMounted || !containerRef.current || mapRef.current) {
            return;
        }

        let cancelled = false;
        const container = containerRef.current;
        let mapInstance: maplibregl.Map | null = null;

        const relayMapClick = (e: maplibregl.MapMouseEvent) => {
            handleMapClickRef.current(e);
        };

        void (async () => {
            await ensurePmtilesProtocol(maplibregl);
            await ensureDashboardMaplibreComplexTextPlugin();
            logDashboardGlyphServingHealthInDev();
            let style: maplibregl.StyleSpecification;
            try {
                style = await fetchDashboardPlaceMapStyle({ includeBusTransitLayers: false });
            } catch (err) {
                console.error("BuildingEditorMap basemap style failed:", err);
                return;
            }

            if (cancelled || !container) {
                return;
            }

            mapInstance = new maplibregl.Map({
                container,
                style,
                center: PLACE_MAP_DEFAULT_CENTER,
                zoom: INITIAL_BUILDING_CAMERA_ZOOM,
                minZoom: 0,
                maxZoom: 22,
                scrollZoom: true,
                doubleClickZoom: true,
                transformRequest: dashboardComplexTextTransformRequest,
            });

            if (cancelled) {
                mapInstance.remove();
                mapInstance = null;
                return;
            }

            const map = mapInstance;

            map.addControl(new maplibregl.NavigationControl({ showZoom: true, showCompass: true }), "top-right");

            attachDashboardMapErrorHandler(map, "BuildingEditorMap");

            map.on("load", () => {
                if (cancelled) {
                    return;
                }

                attachMapLibreDevDebugMap(map);

                ensureDataReviewSatelliteLayer(map);
                applyDashboardMergedBasemapMode(map, basemapMode);

                ensureDraftBuildingLayers(map);
                ensureCurrentBuildingGeometryLayers(map);

                mapRef.current = map;

                exposeBuildingMapForDev(map);

                if (editorMapSurfaceRef) {
                    editorMapSurfaceRef.current = map;
                }

                map.on("click", relayMapClick);

                setMapReady(true);
            });
        })();

        return () => {
            cancelled = true;

            hasAppliedInitialBuildingCameraRef.current = false;

            const map = mapInstance ?? mapRef.current;

            if (editorMapSurfaceRef?.current === map) {
                editorMapSurfaceRef.current = null;
            }

            for (const m of editMarkersRef.current) {
                m.remove();
            }

            editMarkersRef.current = [];

            try {
                map?.off("click", relayMapClick);
            } catch {
                /* ignore */
            }

            mapRef.current = null;

            if (typeof window !== "undefined") {
                delete (window as unknown as { __buildingMap?: maplibregl.Map }).__buildingMap;
            }

            map?.remove();
            setMapReady(false);
            setStats({ areaSqM: null, vertexCount: 0 });
        };
    }, [clientMounted, editorMapSurfaceRef]);

    useEffect(() => {
        const map = mapRef.current;

        if (!mapReady || !map) {
            return;
        }

        applyDashboardMergedBasemapMode(map, basemapMode);
    }, [basemapMode, mapReady]);

    useEffect(() => {
        const map = mapRef.current;

        if (!mapReady || !map) {
            return;
        }

        const showPreview =
            showVertexPreview && !vertexEditActive && !manualDrawing && !drawModeRef.current;
        const parsed = parsePolygonOrMultiPolygon(geometryJson.trim());
        syncVertexPreviewLayer(map, showPreview && parsed ? parsed : null, showPreview);
    }, [geometryJson, showVertexPreview, vertexEditActive, manualDrawing, mapReady]);

    useEffect(() => {
        const map = mapRef.current;

        if (!mapReady || !map) {
            return;
        }

        refreshBuildingTiles(map, buildingTileVersion);
    }, [buildingTileVersion, mapReady]);

    useEffect(() => {
        const map = mapRef.current;

        if (!mapReady || !map) {
            return;
        }

        refreshStreetTiles(map, streetTileVersion);
    }, [streetTileVersion, mapReady]);

    useEffect(() => {
        const map = mapRef.current;

        if (!mapReady || !map) {
            return;
        }

        refreshPlaceTiles(map, placeTileVersion);
    }, [placeTileVersion, mapReady]);

    useEffect(() => {
        const map = mapRef.current;

        if (!mapReady || !map) {
            return;
        }

        refreshRoadLabelTiles(map, roadLabelTileVersion);
    }, [roadLabelTileVersion, mapReady]);

    useEffect(() => {
        const cancelInitialCamera = () => {
            initialBuildingCameraCleanupRef.current?.();
            initialBuildingCameraCleanupRef.current = null;
        };

        cancelInitialCamera();

        const map = mapRef.current;

        if (!mapReady || !map) {
            return () => {
                cancelInitialCamera();
            };
        }

        const trimmed = geometryJson.trim();
        const parsed = parsePolygonOrMultiPolygon(trimmed);
        const normalized = parsed ? normalizeEditableBuildingGeometry(parsed) : null;
        const displayGeometry = normalized?.displayGeometry ?? null;
        const editableGeometry = normalized?.editableGeometry ?? null;

        if (IS_DEV) {
            devLog("current geometry prop", geometryJson);
            devLog("current geometry parsed", parsed);
        }

        ensureCurrentBuildingGeometryLayers(map);

        const currentBuildingSrc = map.getSource(CURRENT_BUILDING_SOURCE) as maplibregl.GeoJSONSource | undefined;

        if (currentBuildingSrc) {
            if (displayGeometry) {
                dashDevLog("building:map:loaded-api-geometry-into-editor-map", displayGeometry);
                currentBuildingSrc.setData(buildCurrentBuildingFeatureCollection(displayGeometry));
                dashDevLog("building:map:selected-api-overlay-updated");
                devLog("current building geometry rendered");
                bringEditorOverlayLayersToFront(map);
            } else if (suppressNextEmptySourceClearRef.current) {
                suppressNextEmptySourceClearRef.current = false;
            } else {
                currentBuildingSrc.setData({ type: "FeatureCollection", features: [] });
                dashDevLog("building:map:selected-api-overlay-cleared-empty-geometry");
            }
        }

        if (!parsed) {
            hasAppliedInitialBuildingCameraRef.current = false;
        }

        if (displayGeometry && !hasAppliedInitialBuildingCameraRef.current) {
            initialBuildingCameraCleanupRef.current = scheduleOneShotInitialBuildingCamera(
                map,
                hasAppliedInitialBuildingCameraRef,
                displayGeometry
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
        if (editableGeometry && exteriorVertexCount(editableGeometry) >= 3) {
            setupPolygonVertexMarkers(map, editableGeometry, (next) => {
                emitGeometryToParent(next);
            });
            dashDevLog("building:editor:editable-geometry-vertex-count", exteriorVertexCount(editableGeometry));
            setDrawUiMode("edit");
        } else {
            setDrawUiMode(DRAW_UI_LABEL_NAV);
        }
        queueMicrotask(() => {
            setVertexEditActive(Boolean(editableGeometry && exteriorVertexCount(editableGeometry) >= 3));
            setVertexEditMessage(
                editableGeometry && exteriorVertexCount(editableGeometry) >= 3
                    ? ""
                    : normalized?.vertexEditingMessage ?? ""
            );

            if (!parsed) {
                setStats({ areaSqM: null, vertexCount: 0 });
            } else {
                setStats(polygonStats(parsed));
            }
        });

        setDraftFromRing(map, drawModeRef.current ? draftPointsRef.current : []);

        return () => {
            cancelInitialCamera();
        };
    }, [emitGeometryToParent, geometryJson, mapReady, removeEditMarkerElements, setupPolygonVertexMarkers]);

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
        setVertexEditMessage("");
        setDrawUiMode(DRAW_UI_LABEL_POLYGON);

        const map = mapRef.current;

        if (map) {
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

        if (!map) {
            setDrawUiMode(DRAW_UI_LABEL_NAV);
            return;
        }

        clearDraftGeometry(map);
        setMapInteractionCursor(map, "default");

        const parsed = parsePolygonOrMultiPolygon(geometryJsonRef.current.trim());

        if (!parsed) {
            window.alert("No polygon to edit. Use Draw to create one.");
            setVertexEditMessage("");
            setDrawUiMode(DRAW_UI_LABEL_NAV);
            return;
        }

        const normalized = normalizeEditableBuildingGeometry(parsed);

        if (!normalized.editableGeometry || exteriorVertexCount(normalized.editableGeometry) < 3) {
            const message =
                normalized.vertexEditingMessage ??
                "No editable polygon vertices found. Use Draw to replace it, or edit GeoJSON manually.";
            window.alert(message);
            setVertexEditMessage(message);
            setDrawUiMode(DRAW_UI_LABEL_NAV);
            return;
        }

        setVertexEditMessage("");
        setupPolygonVertexMarkers(map, normalized.editableGeometry, (next) => {
            emitGeometryToParent(next);
        });
    }, [emitGeometryToParent, setupPolygonVertexMarkers]);

    const deletePolygonFeatures = useCallback(() => {
        if (!hasDrawableBuildingPolygon(geometryJsonRef.current)) {
            return;
        }

        clearEditMarkers();

        const map = mapRef.current;

        if (map) {
            clearCurrentGeometry(map);
            clearDraftGeometry(map);
            bringEditorOverlayLayersToFront(map);
            setMapInteractionCursor(map, "default");
        }

        draftPointsRef.current = [];
        setDraftPointsCount(0);
        setManualDrawing(false);
        setVertexEditMessage("");
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

        if (map) {
            clearDraftGeometry(map);
            setMapInteractionCursor(map, "default");
        }

        devLog("draft geometry cleared");
    }, []);

    useLayoutEffect(() => {
        handleMapClickRef.current = (e: maplibregl.MapMouseEvent) => {
            devLog("map click received");
            devLog("draw mode active", drawModeRef.current);

            if (!drawModeRef.current) {
                return;
            }

            e.originalEvent?.preventDefault?.();

            const map = mapRef.current;

            if (!map) {
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

    const hasGeometryForDelete = hasDrawableBuildingPolygon(geometryJson);
    const hasDraftToClear = draftPointsCount > 0;

    return (
        <div className={className ?? ""}>
            <div className={MAP_EDITOR_TOOLBAR_CLASS}>
                <button
                    type="button"
                    onClick={() => activateManualDraw()}
                    className={mapEditorBtnPrimary(drawUiMode === DRAW_UI_LABEL_POLYGON)}
                >
                    Draw
                </button>
                <button
                    type="button"
                    onClick={() => activateEditMode()}
                    className={mapEditorBtnPrimary(drawUiMode === "edit" && vertexEditActive)}
                >
                    Edit
                </button>
                {manualDrawing && draftPointsCount >= 3 ? (
                    <button type="button" onClick={() => finishManualPolygon()} className={mapEditorBtnSuccess()}>
                        Finish polygon
                    </button>
                ) : null}
                <button
                    type="button"
                    onClick={deletePolygonFeatures}
                    disabled={!hasGeometryForDelete}
                    className={mapEditorBtnDanger(hasGeometryForDelete)}
                >
                    Delete
                </button>
                <button
                    type="button"
                    onClick={clearDraftOnly}
                    disabled={!hasDraftToClear}
                    className={mapEditorBtnDanger(hasDraftToClear)}
                >
                    Clear
                </button>
            </div>

            <div className={MAP_EDITOR_VIEWPORT_BUILDING_CLASS}>
                {clientMounted ? (
                    <div ref={containerRef} className="absolute inset-0 h-full w-full" />
                ) : (
                    <div className="absolute inset-0 h-full w-full" aria-hidden />
                )}

            </div>

            {vertexEditMessage ? (
                <p className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                    {vertexEditMessage}
                </p>
            ) : null}
        </div>
    );
}
