"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LineString } from "geojson";
import maplibregl, { type GeoJSONSource, type LayerSpecification } from "maplibre-gl";

import {
    TerraDraw,
    TerraDrawLineStringMode,
    TerraDrawSelectMode,
    type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

import { fetchDashboardPlaceMapStyle } from "@/src/components/map/dashboardBasemapStyle";
import { useDashboardTileVersions } from "@/src/components/map/BuildingTileVersionContext";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import { attachDashboardMapErrorHandler } from "@/src/components/map/mapErrorHandlers";
import { logDashboardGlyphServingHealthInDev } from "@/src/lib/map/dashboardGlyphDevCheck";
import {
    dashboardComplexTextTransformRequest,
    ensureDashboardMaplibreComplexTextPlugin,
} from "@/src/lib/map/dashboardMaplibreComplexText";
import {
    refreshPlaceTiles,
    refreshRoadLabelTiles,
    scheduleStreetTileRefresh,
} from "@/src/components/map/placeMapConfig";
import { ensurePmtilesProtocol } from "@local-map/map-style/registerPmtilesProtocol";
import {
    KYAUKTAN_STREET_EDITOR_CENTER,
    KYAUKTAN_STREET_EDITOR_ZOOM,
} from "@/src/features/streets/streetMapConfig";
import {
    getNearestStreetPoint,
    getStreets,
    isAbortError,
    type Street,
    type StreetLineStringGeoJson,
} from "@/src/lib/api";
import { attachMapLibreDevDebugMap } from "@/src/lib/mapLibreDebug";
import { dashDevLog } from "@/src/lib/dashDevLog";
import {
    addStreetLiveOverlay,
    clearLiveOverlay,
    LIVE_STREET_SOURCE_ID,
    streetLineToLiveFeatureCollection,
} from "@/src/lib/map/liveOverlays";

import "maplibre-gl/dist/maplibre-gl.css";

const DEFAULT_SNAP_RADIUS_M = 5;
const SNAP_DEBOUNCE_MS = 95;
const COORD_EPS = 1e-8;
const EDITABLE_STREETS_SOURCE_ID = "street-editor-editable-streets";
const EDITABLE_STREETS_CASING_LAYER_ID = "street-editor-editable-streets-casing";
const EDITABLE_STREETS_LINE_LAYER_ID = "street-editor-editable-streets-line";
const SELECTED_STREET_SOURCE_ID = "street-editor-selected-street";
const SELECTED_STREET_HIGHLIGHT_LAYER_ID = "street-editor-selected-street-highlight";

/**
 * Vertex / midpoint handles use draggable DOM Markers (not a separate GeoJSON point source) so:
 * - handles stack above the map canvas (and above the blue selected-street line),
 * - drag events are not eaten by TerraDraw,
 * - we still mirror every change into {@link SELECTED_STREET_SOURCE_ID} (no API calls here).
 */

type StreetEditorFeatureCollection = {
    type: "FeatureCollection";
    features: Array<{
        type: "Feature";
        id?: string;
        properties: Record<string, string | number | boolean | null>;
        geometry:
            | StreetLineStringGeoJson
            | {
                  type: "MultiLineString";
                  coordinates: number[][][];
              };
    }>;
};

type GeoJsonSourceData = Parameters<GeoJSONSource["setData"]>[0];
type DrawFeatureId = string | number;

function lineStringCoordsKey(line: StreetLineStringGeoJson | null): string {
    return line?.coordinates?.length ? JSON.stringify(line.coordinates) : "__empty__";
}

function emptyStreetFeatureCollection(): StreetEditorFeatureCollection {
    return {
        type: "FeatureCollection",
        features: [],
    };
}

function streetDisplayName(street: Pick<Street, "canonical_name" | "myanmarName" | "englishName" | "public_id">): string {
    return street.englishName?.trim() || street.myanmarName?.trim() || street.canonical_name?.trim() || street.public_id;
}

function streetsToFeatureCollection(streets: Street[]): StreetEditorFeatureCollection {
    return {
        type: "FeatureCollection",
        features: streets
            .filter((street) => street.geometry && !street.deleted_at)
            .map((street) => ({
                type: "Feature" as const,
                id: street.public_id,
                properties: {
                    public_id: street.public_id,
                    name: streetDisplayName(street),
                    road_class: street.road_class,
                    is_active: street.is_active,
                },
                geometry: street.geometry as NonNullable<Street["geometry"]>,
            })),
    };
}

function selectedStreetFeatureCollection(
    line: StreetLineStringGeoJson | null,
    selectedStreetPublicId?: string | null,
    selectedStreetName?: string | null,
): StreetEditorFeatureCollection {
    if (!line || line.coordinates.length < 2) {
        return emptyStreetFeatureCollection();
    }

    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                id: selectedStreetPublicId ?? "draft-street",
                properties: {
                    public_id: selectedStreetPublicId ?? null,
                    name: selectedStreetName?.trim() || "Editing street",
                    selected: true,
                },
                geometry: line,
            },
        ],
    };
}

function setGeoJsonSourceData(map: maplibregl.Map, sourceId: string, data: StreetEditorFeatureCollection): boolean {
    const source = map.getSource(sourceId);

    if (!source || source.type !== "geojson") {
        return false;
    }

    (source as GeoJSONSource).setData(data as GeoJsonSourceData);
    map.triggerRepaint();
    return true;
}

function updateStreetLiveOverlayFromLine(
    map: maplibregl.Map,
    line: StreetLineStringGeoJson | null,
    scope: string,
): void {
    if (!map.isStyleLoaded()) {
        return;
    }

    if (!line || line.coordinates.length < 2) {
        clearLiveOverlay(map, LIVE_STREET_SOURCE_ID);
        dashDevLog(`${scope}:live-overlay-cleared`);
        return;
    }

    addStreetLiveOverlay(
        map,
        streetLineToLiveFeatureCollection(line as LineString),
    );
    dashDevLog(`${scope}:live-overlay-updated`, line);
}

function addStreetEditorLayer(map: maplibregl.Map, layer: LayerSpecification) {
    const beforeLabels = map.getLayer("road-labels") ? "road-labels" : undefined;
    map.addLayer(layer, beforeLabels);
}

function addStreetEditorPreviewSources(map: maplibregl.Map) {
    if (!map.getSource(EDITABLE_STREETS_SOURCE_ID)) {
        // API-backed editable streets: this source gives the editor immediate feedback instead of waiting
        // for cached Martin vector tiles to refresh after street CRUD operations.
        map.addSource(EDITABLE_STREETS_SOURCE_ID, {
            type: "geojson",
            data: emptyStreetFeatureCollection() as GeoJsonSourceData,
        });
    }

    if (!map.getSource(SELECTED_STREET_SOURCE_ID)) {
        // Selected street: kept separate from the TerraDraw store so the saved/loaded street can stay
        // visibly highlighted while vertex handles and draw controls continue to own editing state.
        map.addSource(SELECTED_STREET_SOURCE_ID, {
            type: "geojson",
            data: emptyStreetFeatureCollection() as GeoJsonSourceData,
        });
    }

    if (!map.getLayer(EDITABLE_STREETS_CASING_LAYER_ID)) {
        addStreetEditorLayer(map, {
            id: EDITABLE_STREETS_CASING_LAYER_ID,
            type: "line",
            source: EDITABLE_STREETS_SOURCE_ID,
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#ffffff",
                "line-opacity": 0.75,
                "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 14, 4, 18, 7],
            },
        });
    }

    if (!map.getLayer(EDITABLE_STREETS_LINE_LAYER_ID)) {
        addStreetEditorLayer(map, {
            id: EDITABLE_STREETS_LINE_LAYER_ID,
            type: "line",
            source: EDITABLE_STREETS_SOURCE_ID,
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#475569",
                "line-opacity": 0.9,
                "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 14, 2.2, 18, 4.8],
            },
        });
    }

    if (!map.getLayer(SELECTED_STREET_HIGHLIGHT_LAYER_ID)) {
        // Highlight ordering: selected street is above normal/API streets, while TerraDraw is initialized
        // afterward so its vertex handles remain interactive and visually on top.
        addStreetEditorLayer(map, {
            id: SELECTED_STREET_HIGHLIGHT_LAYER_ID,
            type: "line",
            source: SELECTED_STREET_SOURCE_ID,
            layout: {
                "line-cap": "round",
                "line-join": "round",
            },
            paint: {
                "line-color": "#2563eb",
                "line-opacity": 0.98,
                "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 6, 18, 9],
            },
        });
    }

    bringStreetEditorPreviewLayersAboveBasemapStack(map);
}

/** Keep editor/API street GeoJSON above PMTiles + Martin vector paint (layer order is reassigned on each call). */
function bringStreetEditorPreviewLayersAboveBasemapStack(map: maplibregl.Map) {
    const ids = [
        EDITABLE_STREETS_CASING_LAYER_ID,
        EDITABLE_STREETS_LINE_LAYER_ID,
        SELECTED_STREET_HIGHLIGHT_LAYER_ID,
    ] as const;

    for (const id of ids) {
        if (map.getLayer(id)) {
            map.moveLayer(id);
        }
    }
}

function fitMapToLine(map: maplibregl.Map, line: StreetLineStringGeoJson) {
    const coords = line.coordinates;
    if (coords.length < 2) {
        return;
    }

    const bounds = new maplibregl.LngLatBounds(coords[0] as maplibregl.LngLatLike, coords[0] as maplibregl.LngLatLike);

    for (let i = 1; i < coords.length; i++) {
        bounds.extend(coords[i] as maplibregl.LngLatLike);
    }

    map.fitBounds(bounds, { padding: 72, maxZoom: 18, duration: 0 });
}

function scheduleFitMapToLine(map: maplibregl.Map, line: StreetLineStringGeoJson) {
    const run = () => {
        try {
            if (!map || !map.getContainer()?.isConnected) {
                return;
            }
            map.resize();
            fitMapToLine(map, line);
        } catch {
            /* ignore stale map */
        }
    };

    queueMicrotask(run);
    requestAnimationFrame(run);
    map.once("idle", run);
}

function snapshotToLineString(features: GeoJSONStoreFeatures[]): StreetLineStringGeoJson | null {
    for (const f of features) {
        const g = f.geometry;
        if (g && typeof g === "object" && (g as { type?: unknown }).type === "LineString") {
            const coords = (g as StreetLineStringGeoJson).coordinates;
            if (Array.isArray(coords) && coords.length >= 2) {
                return {
                    type: "LineString",
                    coordinates: coords as number[][],
                };
            }
        }
    }

    return null;
}

/** Deep copy usable for vertex diff/snap corrections. */
function copyCoords(coords: number[][]): number[][] {
    return coords.map((c) => [...c]);
}

function createVertexMarkerElement(index: number, selectedIndex: number | null): HTMLDivElement {
    const el = document.createElement("div");
    el.dataset.vertexIndex = String(index);
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `Street vertex ${index + 1}`);
    el.className = "street-editor-vertex-handle shadow-md";
    el.style.boxSizing = "border-box";
    el.style.width = "16px";
    el.style.height = "16px";
    el.style.borderRadius = "9999px";
    el.style.background = "#f97316";
    el.style.border = "2px solid #ffffff";
    el.style.cursor = "grab";
    el.style.touchAction = "none";
    if (selectedIndex === index) {
        el.style.boxShadow = "0 0 0 2px #2563eb";
    }
    return el;
}

function createMidpointMarkerElement(segmentIndex: number): HTMLDivElement {
    const el = document.createElement("div");
    el.dataset.midpointSegment = String(segmentIndex);
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `Insert vertex after point ${segmentIndex + 1}`);
    el.className = "street-editor-midpoint-handle shadow-sm";
    el.style.boxSizing = "border-box";
    el.style.width = "11px";
    el.style.height = "11px";
    el.style.borderRadius = "9999px";
    el.style.background = "#fb923c";
    el.style.border = "2px solid #ffffff";
    el.style.cursor = "pointer";
    el.style.touchAction = "none";
    return el;
}

function findCandidateSnapVertexIndices(prev: number[][] | undefined | null, next: number[][]): number[] {
    const lastPrev = prev?.length ?? 0;

    if (next.length > lastPrev && lastPrev >= 0) {
        return [next.length - 1];
    }

    const p = prev ?? [];
    const out: number[] = [];

    if (next.length < p.length) {
        return out;
    }

    for (let i = 0; i < next.length; i++) {
        const a = p[i];
        const b = next[i];

        if (!a) {
            out.push(i);
            continue;
        }

        if (Math.abs(a[0] - b[0]) > COORD_EPS || Math.abs(a[1] - b[1]) > COORD_EPS) {
            out.push(i);
        }
    }

    return out.length > 0 ? out : [];
}

export type StreetEditorMapProps = {
    className?: string;
    /** Rendered inline after Draw line / Edit vertices / Clear geometry. */
    toolbarExtra?: ReactNode;
    /** Bump after loading a street so the drawable resets independently of vertex edits. */
    mapEpoch: number;
    seedLine: StreetLineStringGeoJson | null;
    onLineStringChange: (line: StreetLineStringGeoJson | null) => void;
    submissionError?: string;
    /** When editing a street, ignore its own centerline when snapping so vertices do not cling to themselves. */
    snapExcludeStreetPublicId?: string | null;
    /** Current street identity for the selected-street GeoJSON highlight source. */
    selectedStreetPublicId?: string | null;
    selectedStreetName?: string | null;
    /** Bump after CRUD so the API-backed editable source is refreshed and not tile-cache dependent. */
    streetSourceRefreshKey?: string | number;
    /**
     * Passed as Martin `tiles_streets_v` URL `?v=` when refreshing vector tiles (defaults to {@link streetSourceRefreshKey} or `Date.now()`).
     */
    streetVectorTileVersion?: string | number;
    /** Capture-phase click on the map canvas (Drawing stays loaded; TerraDraw still receives events after splitting ends). */
    splitPickActive?: boolean;
    onSplitPointClicked?: (lng: number, lat: number) => void;
    /** Marker shown after the user picks a split point (dashboard split flow). */
    splitPreviewLngLat?: { lng: number; lat: number } | null;
};

type SnapCtl = {
    suppressHydrationSnap: boolean;
    applyingSnap: boolean;
    debounceGeneration: number;
    coordsForSnapDiff: number[][] | null;
};

export default function StreetEditorMap({
    className,
    toolbarExtra,
    mapEpoch,
    seedLine,
    onLineStringChange,
    submissionError,
    snapExcludeStreetPublicId = null,
    selectedStreetPublicId = null,
    selectedStreetName = null,
    streetSourceRefreshKey = 0,
    streetVectorTileVersion,
    splitPickActive = false,
    onSplitPointClicked,
    splitPreviewLngLat = null,
}: StreetEditorMapProps) {
    const { streetTileVersion, placeTileVersion, roadLabelTileVersion } = useDashboardTileVersions();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const clientMounted = useClientMounted();
    const drawRef = useRef<TerraDraw | null>(null);
    const lineModeRef = useRef<TerraDrawLineStringMode | null>(null);

    const onLineStringChangeRef = useRef(onLineStringChange);

    const lastEmittedCoordsKey = useRef<string>("");

    const [mapReady, setMapReady] = useState(false);
    const [snapToRoad, setSnapToRoad] = useState(true);

    const seedPropRef = useRef(seedLine);

    const snapCtlRef = useRef<SnapCtl>({
        suppressHydrationSnap: false,
        applyingSnap: false,
        debounceGeneration: 0,
        coordsForSnapDiff: null,
    });

    const snapRoadDebounceTimerRef = useRef<number | null>(null);

    const snapEnabledRef = useRef(true);

    const snapRadiusRef = useRef(DEFAULT_SNAP_RADIUS_M);

    const snapExcludePublicIdRef = useRef<string | undefined>(undefined);

    const flushEmitRef = useRef<(() => void) | null>(null);
    const onSplitPointClickedRef = useRef(onSplitPointClicked);
    const selectedStreetPublicIdRef = useRef(selectedStreetPublicId);
    const selectedStreetNameRef = useRef(selectedStreetName);

    const splitPreviewMarkerRef = useRef<maplibregl.Marker | null>(null);

    const terraDrawStreetFeatureIdRef = useRef<string | number | null>(null);
    const vertexEditLineRef = useRef<StreetLineStringGeoJson | null>(null);
    const vertexMarkersRef = useRef<maplibregl.Marker[]>([]);
    const midpointMarkersRef = useRef<maplibregl.Marker[]>([]);

    const [snapFeedback, setSnapFeedback] = useState<"idle" | "snapped" | "miss">("idle");
    const [streetSourceError, setStreetSourceError] = useState("");
    /** When editing an existing street, DOM vertex handles are shown; TerraDraw line is hidden to avoid duplicate paths. */
    const [showDomVertexHandles, setShowDomVertexHandles] = useState(Boolean(selectedStreetPublicId));
    /** Line coordinates mirrored for marker handles (edit street only). */
    const [vertexHandleLine, setVertexHandleLine] = useState<StreetLineStringGeoJson | null>(null);
    const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);
    const snapFeedbackClearTimerRef = useRef<number | null>(null);

    const clearSnapFeedbackTimer = useCallback(() => {
        if (snapFeedbackClearTimerRef.current !== null) {
            window.clearTimeout(snapFeedbackClearTimerRef.current);
            snapFeedbackClearTimerRef.current = null;
        }
    }, []);

    const removeDomVertexHandles = useCallback(() => {
        for (const m of vertexMarkersRef.current) {
            m.remove();
        }

        vertexMarkersRef.current = [];

        for (const m of midpointMarkersRef.current) {
            m.remove();
        }

        midpointMarkersRef.current = [];
    }, []);

    const warnMissingDrawFeature = useCallback((id: DrawFeatureId | null | undefined) => {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn("[StreetEditorMap] Terra Draw feature missing; rehydrating", { id });
        }
    }, []);

    const safeGetDrawSnapshot = useCallback((): GeoJSONStoreFeatures[] => {
        const draw = drawRef.current;

        if (!draw) {
            return [];
        }

        try {
            return draw.getSnapshot() as GeoJSONStoreFeatures[];
        } catch {
            warnMissingDrawFeature(terraDrawStreetFeatureIdRef.current);
            return [];
        }
    }, [warnMissingDrawFeature]);

    const safeGetDrawFeature = useCallback(
        (id: DrawFeatureId | null | undefined): GeoJSONStoreFeatures | null => {
            if (id === null || id === undefined) {
                return null;
            }

            return safeGetDrawSnapshot().find((feature) => String(feature.id) === String(id)) ?? null;
        },
        [safeGetDrawSnapshot],
    );

    const safeRemoveDrawFeature = useCallback(
        (id: DrawFeatureId | null | undefined): boolean => {
            const draw = drawRef.current;

            if (!draw || id === null || id === undefined || !safeGetDrawFeature(id)) {
                return false;
            }

            try {
                const maybeRemoveFeature = draw as TerraDraw & {
                    removeFeature?: (featureId: DrawFeatureId) => void;
                    deleteFeature?: (featureId: DrawFeatureId) => void;
                };

                if (typeof maybeRemoveFeature.removeFeature === "function") {
                    maybeRemoveFeature.removeFeature(id);
                } else if (typeof maybeRemoveFeature.deleteFeature === "function") {
                    maybeRemoveFeature.deleteFeature(id);
                } else {
                    return false;
                }

                if (String(terraDrawStreetFeatureIdRef.current) === String(id)) {
                    terraDrawStreetFeatureIdRef.current = null;
                }

                return true;
            } catch {
                warnMissingDrawFeature(id);
                if (String(terraDrawStreetFeatureIdRef.current) === String(id)) {
                    terraDrawStreetFeatureIdRef.current = null;
                }
                return false;
            }
        },
        [safeGetDrawFeature, warnMissingDrawFeature],
    );

    const safeSelectDrawFeature = useCallback(
        (id: DrawFeatureId | null | undefined): boolean => {
            const draw = drawRef.current;

            if (!draw || id === null || id === undefined || !safeGetDrawFeature(id)) {
                return false;
            }

            try {
                const maybeSelectFeature = draw as TerraDraw & {
                    selectFeature?: (featureId: DrawFeatureId) => void;
                };

                if (typeof maybeSelectFeature.selectFeature === "function") {
                    maybeSelectFeature.selectFeature(id);
                } else {
                    draw.setMode("select");
                }

                return true;
            } catch {
                warnMissingDrawFeature(id);
                return false;
            }
        },
        [safeGetDrawFeature, warnMissingDrawFeature],
    );

    const safeSetDrawMode = useCallback((mode: string): string => {
        const draw = drawRef.current;

        if (!draw) {
            return mode;
        }

        try {
            draw.setMode(mode);
            return mode;
        } catch {
            return draw.getMode();
        }
    }, []);

    const safeClearDraw = useCallback((): boolean => {
        const draw = drawRef.current;

        if (!draw) {
            terraDrawStreetFeatureIdRef.current = null;
            return false;
        }

        try {
            draw.clear();
            terraDrawStreetFeatureIdRef.current = null;
            return true;
        } catch {
            warnMissingDrawFeature(terraDrawStreetFeatureIdRef.current);
            terraDrawStreetFeatureIdRef.current = null;
            return false;
        }
    }, [warnMissingDrawFeature]);

    const safeUpsertDrawLine = useCallback(
        (line: StreetLineStringGeoJson): DrawFeatureId | null => {
            const draw = drawRef.current;
            const ctl = snapCtlRef.current;

            if (!draw || line.coordinates.length < 2) {
                return null;
            }

            const currentId = terraDrawStreetFeatureIdRef.current;
            const existing = safeGetDrawFeature(currentId);

            ctl.applyingSnap = true;

            try {
                if (currentId !== null && currentId !== undefined && existing) {
                    draw.updateFeatureGeometry(currentId as never, line);
                    return currentId;
                }

                if (currentId !== null && currentId !== undefined) {
                    warnMissingDrawFeature(currentId);
                }

                const nextId = draw.getFeatureId();
                draw.addFeatures([
                    {
                        type: "Feature",
                        id: nextId,
                        geometry: line,
                        properties: {},
                    } as GeoJSONStoreFeatures,
                ]);
                terraDrawStreetFeatureIdRef.current = nextId;
                return nextId;
            } catch {
                warnMissingDrawFeature(currentId);
                terraDrawStreetFeatureIdRef.current = null;

                try {
                    const nextId = draw.getFeatureId();
                    draw.addFeatures([
                        {
                            type: "Feature",
                            id: nextId,
                            geometry: line,
                            properties: {},
                        } as GeoJSONStoreFeatures,
                    ]);
                    terraDrawStreetFeatureIdRef.current = nextId;
                    return nextId;
                } catch {
                    return null;
                }
            } finally {
                ctl.applyingSnap = false;
            }
        },
        [safeGetDrawFeature, warnMissingDrawFeature],
    );

    /**
     * Push the working LineString to: (1) selected street GeoJSON source (blue highlight),
     * (2) TerraDraw's hidden feature (keeps draw tools / validation in sync), (3) parent state via onLineStringChange.
     * No API calls — Save remains the only persistence path.
     */
    const pushStreetLineToSourcesAndParent = useCallback((nextLine: StreetLineStringGeoJson) => {
        const map = mapRef.current;
        const draw = drawRef.current;
        const ctl = snapCtlRef.current;

        if (!map || nextLine.coordinates.length < 2) {
            return;
        }

        vertexEditLineRef.current = nextLine;
        // MapLibre / React geometry is canonical; TerraDraw is repaired after this if its store lost the feature.
        setGeoJsonSourceData(
            map,
            SELECTED_STREET_SOURCE_ID,
            selectedStreetFeatureCollection(
                nextLine,
                selectedStreetPublicIdRef.current,
                selectedStreetNameRef.current,
            ),
        );
        updateStreetLiveOverlayFromLine(map, nextLine, "street:editor");

        if (draw) {
            safeUpsertDrawLine(nextLine);
        }

        ctl.coordsForSnapDiff = copyCoords(nextLine.coordinates);
        const key = lineStringCoordsKey(nextLine);

        if (key !== lastEmittedCoordsKey.current) {
            lastEmittedCoordsKey.current = key;
            onLineStringChangeRef.current(nextLine);
        }
    }, [safeUpsertDrawLine]);

    const scheduleSnapFeedback = useCallback(
        (status: "snapped" | "miss") => {
            clearSnapFeedbackTimer();
            setSnapFeedback(status);
            snapFeedbackClearTimerRef.current = window.setTimeout(() => {
                snapFeedbackClearTimerRef.current = null;
                setSnapFeedback("idle");
            }, 4500);
        },
        [clearSnapFeedbackTimer],
    );

    const selectedVertexIndexRef = useRef<number | null>(null);

    useEffect(() => {
        selectedVertexIndexRef.current = selectedVertexIndex;
    }, [selectedVertexIndex]);

    useEffect(() => {
        if (selectedStreetPublicId) {
            setShowDomVertexHandles(true);
        } else {
            setShowDomVertexHandles(false);
            setVertexHandleLine(null);
            setSelectedVertexIndex(null);
            vertexEditLineRef.current = null;
            terraDrawStreetFeatureIdRef.current = null;
            removeDomVertexHandles();
        }
    }, [selectedStreetPublicId, removeDomVertexHandles]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!selectedStreetPublicId || !showDomVertexHandles) {
                return;
            }

            const t = event.target;

            if (t instanceof HTMLElement && t.closest("input, textarea, select, [contenteditable='true']")) {
                return;
            }

            if (event.key !== "Delete" && event.key !== "Backspace") {
                return;
            }

            const idx = selectedVertexIndexRef.current;

            if (idx === null) {
                return;
            }

            event.preventDefault();
            const cur = vertexEditLineRef.current;

            if (!cur || cur.coordinates.length <= 2) {
                return;
            }

            const nextCoords = copyCoords(cur.coordinates);
            nextCoords.splice(idx, 1);
            const nextLine: StreetLineStringGeoJson = { type: "LineString", coordinates: nextCoords };
            pushStreetLineToSourcesAndParent(nextLine);
            setVertexHandleLine(nextLine);
            setSelectedVertexIndex(null);
        };

        window.addEventListener("keydown", onKey);

        return () => {
            window.removeEventListener("keydown", onKey);
        };
    }, [selectedStreetPublicId, showDomVertexHandles, pushStreetLineToSourcesAndParent]);

    useEffect(() => {
        onSplitPointClickedRef.current = onSplitPointClicked;
    }, [onSplitPointClicked]);

    useEffect(() => {
        onLineStringChangeRef.current = onLineStringChange;
    }, [onLineStringChange]);

    useEffect(() => {
        seedPropRef.current = seedLine;
    }, [seedLine]);

    useEffect(() => {
        selectedStreetPublicIdRef.current = selectedStreetPublicId;
        selectedStreetNameRef.current = selectedStreetName;
    }, [selectedStreetPublicId, selectedStreetName]);

    useEffect(() => {
        snapExcludePublicIdRef.current = snapExcludeStreetPublicId ?? undefined;
    }, [snapExcludeStreetPublicId]);

    useEffect(() => {
        const map = mapRef.current;

        if (!mapReady || !map) {
            return;
        }

        const mapInstance = map;
        const abort = new AbortController();

        async function refreshEditableStreets() {
            // Refresh flow: after create/update/delete the parent bumps `streetSourceRefreshKey`,
            // then this source re-fetches from the API so editor previews do not rely on stale vector tiles.
            setStreetSourceError("");

            try {
                const streets = await getStreets(
                    {
                        limit: 100,
                        sortBy: "updated",
                        sortOrder: "desc",
                    },
                    { signal: abort.signal },
                );

                if (abort.signal.aborted) {
                    return;
                }

                setGeoJsonSourceData(mapInstance, EDITABLE_STREETS_SOURCE_ID, streetsToFeatureCollection(streets));

                const tileV = streetVectorTileVersion ?? streetSourceRefreshKey ?? streetTileVersion ?? Date.now();
                scheduleStreetTileRefresh(mapInstance, tileV);
            } catch (error) {
                if (isAbortError(error) || abort.signal.aborted) {
                    return;
                }

                setStreetSourceError(error instanceof Error ? error.message : "Failed to refresh editable streets");
            }
        }

        void refreshEditableStreets();

        return () => abort.abort();
    }, [mapReady, streetSourceRefreshKey, streetVectorTileVersion, streetTileVersion]);

    useEffect(() => {
        const map = mapRef.current;

        if (!mapReady || !map) {
            return;
        }

        refreshPlaceTiles(map, placeTileVersion);
    }, [mapReady, placeTileVersion]);

    useEffect(() => {
        const map = mapRef.current;

        if (!mapReady || !map) {
            return;
        }

        refreshRoadLabelTiles(map, roadLabelTileVersion);
    }, [mapReady, roadLabelTileVersion]);

    useEffect(() => {
        const map = mapRef.current;
        if (!mapReady || !map || !splitPickActive || !onSplitPointClicked) {
            return;
        }

        const container = map.getContainer();
        const handler = (ev: MouseEvent) => {
            const canvas = map.getCanvas();
            const rect = canvas.getBoundingClientRect();
            const x = ev.clientX - rect.left;
            const y = ev.clientY - rect.top;

            if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
                return;
            }

            const lngLat = map.unproject([x, y]);
            ev.stopPropagation();
            onSplitPointClickedRef.current?.(lngLat.lng, lngLat.lat);
        };

        container.addEventListener("click", handler, true);
        return () => container.removeEventListener("click", handler, true);
    }, [mapReady, splitPickActive, onSplitPointClicked]);

    useEffect(() => {
        const map = mapRef.current;

        splitPreviewMarkerRef.current?.remove();
        splitPreviewMarkerRef.current = null;

        if (!mapReady || !map || !splitPreviewLngLat) {
            return;
        }

        const { lng, lat } = splitPreviewLngLat;

        const el = document.createElement("div");
        el.setAttribute("aria-hidden", "true");
        el.className =
            "street-split-preview-marker pointer-events-none h-3 w-3 rounded-full border-2 border-white bg-rose-600 shadow-md ring-2 ring-rose-800/40";

        const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(map);

        splitPreviewMarkerRef.current = marker;

        return () => {
            marker.remove();
            splitPreviewMarkerRef.current = null;
        };
    }, [mapReady, splitPreviewLngLat]);

    useEffect(() => {
        snapEnabledRef.current = snapToRoad;

        const ctl = snapCtlRef.current;
        const draw = drawRef.current;

        if (!snapToRoad) {
            if (snapRoadDebounceTimerRef.current !== null) {
                window.clearTimeout(snapRoadDebounceTimerRef.current);
                snapRoadDebounceTimerRef.current = null;
                ctl.debounceGeneration += 1;

                if (draw && !ctl.applyingSnap) {
                    queueMicrotask(() => flushEmitRef.current?.());
                }
            }
        }
    }, [snapToRoad]);

    function selectModeFallback(draw: TerraDraw): string {
        try {
            draw.setMode("select");
            return "select";
        } catch {
            return draw.getMode();
        }
    }

    /** Single map instance (create vs edit determined by `selectedStreetPublicIdRef` at TerraDraw init). */
    useEffect(() => {
        const root = containerRef.current;

        if (!clientMounted || !root || mapRef.current) {
            return;
        }

        let cancelled = false;
        const ctl = snapCtlRef.current;

        void (async () => {
            await ensurePmtilesProtocol(maplibregl);
            await ensureDashboardMaplibreComplexTextPlugin();
            logDashboardGlyphServingHealthInDev();
            let style: maplibregl.StyleSpecification;
            try {
                style = await fetchDashboardPlaceMapStyle({ includeBusTransitLayers: true });
            } catch (err) {
                console.error("StreetEditorMap basemap style failed:", err);
                return;
            }

            if (cancelled || !root) {
                return;
            }

            const map = new maplibregl.Map({
                container: root,
                style,
                center: KYAUKTAN_STREET_EDITOR_CENTER,
                zoom: KYAUKTAN_STREET_EDITOR_ZOOM,
                transformRequest: dashboardComplexTextTransformRequest,
            });

            if (cancelled) {
                map.remove();
                return;
            }

            map.addControl(new maplibregl.NavigationControl(), "top-right");
            attachDashboardMapErrorHandler(map, "StreetEditorMap");

            map.on("load", () => {
            attachMapLibreDevDebugMap(map);
            addStreetEditorPreviewSources(map);

            /** Hide TerraDraw's own stroke/points when editing an existing street — DOM vertex handles + blue GeoJSON line are authoritative. */
            const hideTerraDrawLineOverlay = Boolean(selectedStreetPublicIdRef.current);

            const lineMode = new TerraDrawLineStringMode({
                editable: true,
                showCoordinatePoints: !hideTerraDrawLineOverlay,
                styles: {
                    lineStringWidth: hideTerraDrawLineOverlay ? 0 : 4,
                    lineStringColor: "#1e40af",
                    lineStringOpacity: hideTerraDrawLineOverlay ? 0 : 1,
                    coordinatePointWidth: hideTerraDrawLineOverlay ? 0 : 7,
                    coordinatePointColor: "#f97316",
                    coordinatePointOpacity: hideTerraDrawLineOverlay ? 0 : 1,
                    coordinatePointOutlineColor: "#ffffff",
                    coordinatePointOutlineWidth: hideTerraDrawLineOverlay ? 0 : 2,
                    coordinatePointOutlineOpacity: hideTerraDrawLineOverlay ? 0 : 1,
                },
            });
            lineModeRef.current = lineMode;

            const selectMode = new TerraDrawSelectMode({
                flags: {
                    [lineMode.mode]: {
                        feature: {
                            coordinates: {
                                midpoints: true,
                                draggable: true,
                                deletable: true,
                            },
                        },
                    },
                },
            });

            const draw = new TerraDraw({
                adapter: new TerraDrawMapLibreGLAdapter({ map }),
                modes: [selectMode, lineMode],
            });

            drawRef.current = draw;

            function flushEmitGeometry() {
                const next = snapshotToLineString(safeGetDrawSnapshot());
                const key = lineStringCoordsKey(next);

                if (key !== lastEmittedCoordsKey.current) {
                    lastEmittedCoordsKey.current = key;
                    onLineStringChangeRef.current(next);
                }

                setGeoJsonSourceData(
                    map,
                    SELECTED_STREET_SOURCE_ID,
                    selectedStreetFeatureCollection(
                        next,
                        selectedStreetPublicIdRef.current,
                        selectedStreetNameRef.current,
                    ),
                );
                updateStreetLiveOverlayFromLine(map, next, "street:editor:draw-change");
                ctl.coordsForSnapDiff = next?.coordinates.length ? copyCoords(next.coordinates) : null;
            }

            flushEmitRef.current = flushEmitGeometry;

            draw.on("change", () => {
                const drawer = drawRef.current;

                if (!drawer) {
                    return;
                }

                if (ctl.applyingSnap) {
                    return;
                }

                if (ctl.suppressHydrationSnap || !snapEnabledRef.current) {
                    flushEmitGeometry();
                    return;
                }

                ctl.debounceGeneration += 1;
                const generation = ctl.debounceGeneration;

                if (snapRoadDebounceTimerRef.current !== null) {
                    window.clearTimeout(snapRoadDebounceTimerRef.current);
                }

                snapRoadDebounceTimerRef.current = window.setTimeout(() => {
                    snapRoadDebounceTimerRef.current = null;

                    if (generation !== ctl.debounceGeneration) {
                        return;
                    }

                    void (async () => {
                        const currentDraw = drawRef.current;

                        if (!currentDraw) {
                            return;
                        }

                        if (!snapEnabledRef.current) {
                            flushEmitGeometry();
                            return;
                        }

                        const snapshot = safeGetDrawSnapshot();
                        const nextRaw = snapshotToLineString(snapshot);

                        if (!nextRaw || nextRaw.coordinates.length < 2) {
                            flushEmitGeometry();
                            return;
                        }

                        const feature = snapshot.find((f) => f.geometry?.type === "LineString");

                        const fid = feature?.id;

                        if (fid === undefined || fid === null) {
                            flushEmitGeometry();
                            return;
                        }

                        let indices = findCandidateSnapVertexIndices(ctl.coordsForSnapDiff, nextRaw.coordinates);

                        if (indices.length === 0) {
                            indices = [nextRaw.coordinates.length - 1];
                        }

                        const coords = copyCoords(nextRaw.coordinates);
                        const tol = snapRadiusRef.current;
                        let snapApplied = false;

                        try {
                            for (const i of [...new Set(indices)]) {
                                if (!snapEnabledRef.current) {
                                    flushEmitGeometry();
                                    return;
                                }

                                if (typeof i !== "number" || !coords[i]) {
                                    continue;
                                }

                                const hit = await getNearestStreetPoint({
                                    lat: coords[i][1],
                                    lng: coords[i][0],
                                    radiusMeters: tol,
                                    excludePublicId: snapExcludePublicIdRef.current,
                                });

                                if (hit !== null && hit.distance_m <= tol) {
                                    coords[i][0] = hit.nearest.lng;
                                    coords[i][1] = hit.nearest.lat;
                                    snapApplied = true;
                                }
                            }

                            if (!snapEnabledRef.current) {
                                flushEmitGeometry();
                                return;
                            }

                            let moved = false;

                            for (let j = 0; j < coords.length; j++) {
                                const a = nextRaw.coordinates[j];
                                const b = coords[j];

                                if (Math.abs(a[0] - b[0]) > COORD_EPS || Math.abs(a[1] - b[1]) > COORD_EPS) {
                                    moved = true;
                                    break;
                                }
                            }

                            if (snapApplied) {
                                scheduleSnapFeedback("snapped");
                            } else {
                                scheduleSnapFeedback("miss");
                            }

                            if (!moved) {
                                flushEmitGeometry();
                                return;
                            }

                            terraDrawStreetFeatureIdRef.current = fid as DrawFeatureId;
                            safeUpsertDrawLine({
                                type: "LineString",
                                coordinates: coords,
                            });
                            flushEmitGeometry();
                        } catch {
                            ctl.applyingSnap = false;
                            flushEmitGeometry();
                        }
                    })();
                }, SNAP_DEBOUNCE_MS);
            });

            draw.start();
            queueMicrotask(() => map.resize());
            setMapReady(true);
        });

            mapRef.current = map;
        })();

        return () => {
            cancelled = true;
            setMapReady(false);

            if (snapRoadDebounceTimerRef.current !== null) {
                window.clearTimeout(snapRoadDebounceTimerRef.current);
                snapRoadDebounceTimerRef.current = null;
            }

            clearSnapFeedbackTimer();

            splitPreviewMarkerRef.current?.remove();
            splitPreviewMarkerRef.current = null;

            flushEmitRef.current = null;
            drawRef.current?.stop();
            drawRef.current = null;
            lineModeRef.current = null;
            mapRef.current?.remove();
            mapRef.current = null;
            lastEmittedCoordsKey.current = "";
        };
    }, [clientMounted, clearSnapFeedbackTimer, safeGetDrawSnapshot, safeUpsertDrawLine, scheduleSnapFeedback]);

    useEffect(() => {
        const map = mapRef.current;
        const draw = drawRef.current;
        const ctl = snapCtlRef.current;

        if (!mapReady || !map || !draw) {
            return;
        }

        ctl.suppressHydrationSnap = true;
        ctl.debounceGeneration += 1;

        if (snapRoadDebounceTimerRef.current !== null) {
            window.clearTimeout(snapRoadDebounceTimerRef.current);
            snapRoadDebounceTimerRef.current = null;
        }

        safeClearDraw();
        lastEmittedCoordsKey.current = "";

        const seedSnapshot = seedPropRef.current;

        if (seedSnapshot && seedSnapshot.coordinates.length >= 2) {
            const editingExistingStreetId = selectedStreetPublicIdRef.current;
            const geomForDraw: StreetLineStringGeoJson = editingExistingStreetId
                ? { type: "LineString", coordinates: copyCoords(seedSnapshot.coordinates) }
                : seedSnapshot;

            setGeoJsonSourceData(
                map,
                SELECTED_STREET_SOURCE_ID,
                selectedStreetFeatureCollection(
                    geomForDraw,
                    selectedStreetPublicIdRef.current,
                    selectedStreetNameRef.current,
                ),
            );
            dashDevLog("street:editor:loaded-api-geometry", geomForDraw);
            updateStreetLiveOverlayFromLine(map, geomForDraw, "street:editor:hydrate-api-geometry");
            const id = safeUpsertDrawLine(geomForDraw);

            /** Select immediately so midpoint / vertex handles are active after load */
            if (!safeSelectDrawFeature(id)) {
                safeSetDrawMode(selectModeFallback(draw));
            }
            scheduleFitMapToLine(map, geomForDraw);

            if (editingExistingStreetId) {
                setVertexHandleLine(geomForDraw);
                vertexEditLineRef.current = geomForDraw;
                setShowDomVertexHandles(true);
                setSelectedVertexIndex(null);
            } else {
                setVertexHandleLine(null);
                vertexEditLineRef.current = null;
            }

            queueMicrotask(() => {
                map.resize();
                lastEmittedCoordsKey.current = lineStringCoordsKey(geomForDraw);
                ctl.coordsForSnapDiff = copyCoords(geomForDraw.coordinates);
                onLineStringChangeRef.current(geomForDraw);
                ctl.suppressHydrationSnap = false;
            });
        } else {
            terraDrawStreetFeatureIdRef.current = null;
            setVertexHandleLine(null);
            vertexEditLineRef.current = null;
            setSelectedVertexIndex(null);
            setGeoJsonSourceData(map, SELECTED_STREET_SOURCE_ID, emptyStreetFeatureCollection());
            updateStreetLiveOverlayFromLine(map, null, "street:editor:hydrate-empty-geometry");
            queueMicrotask(() => map.resize());
            map.easeTo({
                center: KYAUKTAN_STREET_EDITOR_CENTER,
                zoom: KYAUKTAN_STREET_EDITOR_ZOOM,
                duration: 0,
            });

            queueMicrotask(() => {
                safeSetDrawMode(lineModeRef.current?.mode ?? "linestring");
                onLineStringChangeRef.current(null);
                ctl.coordsForSnapDiff = null;
                ctl.suppressHydrationSnap = false;
            });
        }
    }, [
        mapEpoch,
        mapReady,
        selectedStreetPublicId,
        safeClearDraw,
        safeSelectDrawFeature,
        safeSetDrawMode,
        safeUpsertDrawLine,
    ]);

    useEffect(() => {
        const map = mapRef.current;

        if (!mapReady || !map || !selectedStreetPublicId || !showDomVertexHandles) {
            removeDomVertexHandles();

            return () => {
                removeDomVertexHandles();
            };
        }

        const line = vertexHandleLine ?? vertexEditLineRef.current;

        if (!line || line.coordinates.length < 2) {
            removeDomVertexHandles();

            return () => {
                removeDomVertexHandles();
            };
        }

        removeDomVertexHandles();

        for (let i = 0; i < line.coordinates.length; i++) {
            const idx = i;
            const el = createVertexMarkerElement(idx, selectedVertexIndex);

            el.addEventListener("click", (ev) => {
                ev.stopPropagation();
                setSelectedVertexIndex(idx);
            });

            const marker = new maplibregl.Marker({ element: el, draggable: true })
                .setLngLat(line.coordinates[idx] as maplibregl.LngLatLike)
                .addTo(map);

            marker.on("dragstart", () => {
                el.style.cursor = "grabbing";
            });

            marker.on("drag", () => {
                const lngLat = marker.getLngLat();
                const current = vertexEditLineRef.current;

                if (!current) {
                    return;
                }

                const nextCoords = copyCoords(current.coordinates);

                if (!nextCoords[idx]) {
                    return;
                }

                nextCoords[idx] = [lngLat.lng, lngLat.lat];
                const nextLine: StreetLineStringGeoJson = { type: "LineString", coordinates: nextCoords };
                vertexEditLineRef.current = nextLine;
                pushStreetLineToSourcesAndParent(nextLine);
            });

            marker.on("dragend", () => {
                el.style.cursor = "grab";

                void (async () => {
                    if (!snapEnabledRef.current) {
                        setVertexHandleLine(vertexEditLineRef.current);
                        return;
                    }

                    const current = vertexEditLineRef.current;

                    if (!current || !current.coordinates[idx]) {
                        return;
                    }

                    let lng = current.coordinates[idx][0];
                    let lat = current.coordinates[idx][1];
                    let snapped = false;

                    try {
                        const hit = await getNearestStreetPoint({
                            lat,
                            lng,
                            radiusMeters: snapRadiusRef.current,
                            excludePublicId: snapExcludePublicIdRef.current,
                        });

                        if (hit !== null && hit.distance_m <= snapRadiusRef.current) {
                            lng = hit.nearest.lng;
                            lat = hit.nearest.lat;
                            snapped = true;
                            marker.setLngLat([lng, lat]);
                        }
                    } catch {
                        /* keep coordinates from drag */
                    }

                    const nextCoords = copyCoords(current.coordinates);
                    nextCoords[idx][0] = lng;
                    nextCoords[idx][1] = lat;
                    const nextLine: StreetLineStringGeoJson = { type: "LineString", coordinates: nextCoords };

                    if (snapped) {
                        scheduleSnapFeedback("snapped");
                    } else {
                        scheduleSnapFeedback("miss");
                    }

                    pushStreetLineToSourcesAndParent(nextLine);
                    setVertexHandleLine(nextLine);
                })();
            });

            vertexMarkersRef.current.push(marker);
        }

        for (let seg = 0; seg < line.coordinates.length - 1; seg++) {
            const a = line.coordinates[seg];
            const b = line.coordinates[seg + 1];

            if (!a || !b) {
                continue;
            }

            const lng = (a[0] + b[0]) / 2;
            const lat = (a[1] + b[1]) / 2;
            const el = createMidpointMarkerElement(seg);

            el.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const cur = vertexEditLineRef.current;

                if (!cur || cur.coordinates.length < 2) {
                    return;
                }

                const nextCoords = copyCoords(cur.coordinates);
                nextCoords.splice(seg + 1, 0, [lng, lat]);
                const nextLine: StreetLineStringGeoJson = { type: "LineString", coordinates: nextCoords };

                pushStreetLineToSourcesAndParent(nextLine);
                setVertexHandleLine(nextLine);
                setSelectedVertexIndex(seg + 1);
            });

            const midMarker = new maplibregl.Marker({ element: el, draggable: false })
                .setLngLat([lng, lat])
                .addTo(map);

            midpointMarkersRef.current.push(midMarker);
        }

        return () => {
            removeDomVertexHandles();
        };
    }, [
        mapReady,
        mapEpoch,
        selectedStreetPublicId,
        showDomVertexHandles,
        vertexHandleLine,
        selectedVertexIndex,
        pushStreetLineToSourcesAndParent,
        removeDomVertexHandles,
        scheduleSnapFeedback,
    ]);

    function handleDrawMode() {
        const draw = drawRef.current;

        if (!draw) {
            return;
        }

        if (selectedStreetPublicId) {
            setShowDomVertexHandles(false);
            setSelectedVertexIndex(null);
            removeDomVertexHandles();
        }

        safeSetDrawMode(lineModeRef.current?.mode ?? "linestring");
    }

    function handleSelectMode() {
        const draw = drawRef.current;

        if (!draw) {
            return;
        }

        safeSetDrawMode(selectModeFallback(draw));

        if (!selectedStreetPublicId) {
            return;
        }

        setShowDomVertexHandles(true);

        const snapshot = safeGetDrawSnapshot();
        const snap = snapshotToLineString(snapshot);

        if (!snap || snap.coordinates.length < 2) {
            return;
        }

        const feature = snapshot.find((f) => f.geometry?.type === "LineString");

        if (feature?.id !== undefined && feature.id !== null) {
            terraDrawStreetFeatureIdRef.current = feature.id;
        }

        const next: StreetLineStringGeoJson = { type: "LineString", coordinates: copyCoords(snap.coordinates) };

        pushStreetLineToSourcesAndParent(next);
        setVertexHandleLine(next);
        vertexEditLineRef.current = next;
    }

    function handleClearGeometry() {
        const map = mapRef.current;
        const draw = drawRef.current;
        const ctl = snapCtlRef.current;

        if (!draw || !map) {
            return;
        }

        ctl.debounceGeneration += 1;

        if (snapRoadDebounceTimerRef.current !== null) {
            window.clearTimeout(snapRoadDebounceTimerRef.current);
            snapRoadDebounceTimerRef.current = null;
        }

        safeRemoveDrawFeature(terraDrawStreetFeatureIdRef.current);
        safeClearDraw();
        lastEmittedCoordsKey.current = "";
        terraDrawStreetFeatureIdRef.current = null;
        setVertexHandleLine(null);
        vertexEditLineRef.current = null;
        setSelectedVertexIndex(null);
        removeDomVertexHandles();
        ctl.coordsForSnapDiff = null;
        onLineStringChangeRef.current(null);
        setGeoJsonSourceData(map, SELECTED_STREET_SOURCE_ID, emptyStreetFeatureCollection());
        clearSnapFeedbackTimer();
        setSnapFeedback("idle");

        map.easeTo({
            center: KYAUKTAN_STREET_EDITOR_CENTER,
            zoom: KYAUKTAN_STREET_EDITOR_ZOOM,
            duration: 300,
        });

        queueMicrotask(() => {
            safeSetDrawMode(lineModeRef.current?.mode ?? "linestring");
        });
    }

    return (
        <div className={className}>
            <div className="mb-3 space-y-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => handleDrawMode()}
                            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50"
                        >
                            Draw line
                        </button>
                        <button
                            type="button"
                            onClick={() => handleSelectMode()}
                            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50"
                        >
                            Edit vertices
                        </button>
                        <button
                            type="button"
                            onClick={() => handleClearGeometry()}
                            className="rounded border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                        >
                            Clear geometry
                        </button>
                        {selectedStreetPublicId && showDomVertexHandles && selectedVertexIndex !== null ? (
                            <button
                                type="button"
                                disabled={!vertexHandleLine || vertexHandleLine.coordinates.length <= 2}
                                onClick={() => {
                                    const idx = selectedVertexIndex;

                                    if (idx === null) {
                                        return;
                                    }

                                    const cur = vertexEditLineRef.current;

                                    if (!cur || cur.coordinates.length <= 2) {
                                        return;
                                    }

                                    const nextCoords = copyCoords(cur.coordinates);
                                    nextCoords.splice(idx, 1);
                                    const nextLine: StreetLineStringGeoJson = { type: "LineString", coordinates: nextCoords };

                                    pushStreetLineToSourcesAndParent(nextLine);
                                    setVertexHandleLine(nextLine);
                                    setSelectedVertexIndex(null);
                                }}
                                className="rounded border border-amber-300 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Remove vertex
                            </button>
                        ) : null}
                        {toolbarExtra}
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 border-l border-gray-200 pl-4 text-sm text-gray-800">
                        <input
                            type="checkbox"
                            checked={snapToRoad}
                            onChange={(event) => {
                                const next = event.target.checked;
                                if (!next) {
                                    clearSnapFeedbackTimer();
                                    setSnapFeedback("idle");
                                }
                                setSnapToRoad(next);
                            }}
                            className="rounded border-gray-300"
                        />
                        <span>Snap to roads ({DEFAULT_SNAP_RADIUS_M} m)</span>
                    </label>
                </div>
                <p className="max-w-3xl text-xs leading-relaxed text-gray-600">
                    When enabled, moved/drawn vertices snap to nearby existing road geometry within {DEFAULT_SNAP_RADIUS_M}{" "}
                    meters. This helps avoid tiny gaps that break future routing.
                </p>
                {snapToRoad && snapFeedback !== "idle" ? (
                    <p
                        className={
                            snapFeedback === "snapped"
                                ? "text-xs font-medium text-emerald-700"
                                : "text-xs font-medium text-amber-800"
                        }
                        role="status"
                        aria-live="polite"
                    >
                        {snapFeedback === "snapped"
                            ? "Snapped to nearby road"
                            : `No nearby road within ${DEFAULT_SNAP_RADIUS_M} m`}
                    </p>
                ) : null}
                {streetSourceError ? (
                    <p className="text-xs font-medium text-amber-800" role="status">
                        Editable street overlay could not refresh: {streetSourceError}
                    </p>
                ) : null}
            </div>

            {submissionError ? (
                <div className="mb-2 whitespace-pre-wrap rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {submissionError}
                </div>
            ) : null}

            {clientMounted ? (
                <div
                    ref={containerRef}
                    className="h-[min(28rem,calc(100vh-22rem))] w-full overflow-hidden rounded-md border border-gray-200 shadow-inner"
                    style={{ touchAction: "none" }}
                />
            ) : (
                <div
                    className="h-[min(28rem,calc(100vh-22rem))] w-full overflow-hidden rounded-md border border-gray-200 shadow-inner"
                    style={{ touchAction: "none" }}
                    aria-hidden
                />
            )}
        </div>
    );
}
