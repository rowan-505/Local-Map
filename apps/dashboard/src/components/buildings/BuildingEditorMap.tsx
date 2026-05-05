"use client";

import area from "@turf/area";
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import maplibregl, {
    DataDrivenPropertyValueSpecification,
    FilterSpecification,
} from "maplibre-gl";
import {
    TerraDraw,
    TerraDrawPolygonMode,
    TerraDrawSelectMode,
    type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

import {
    PLACE_MAP_DEFAULT_CENTER,
    PLACE_MAP_STYLE,
    reloadMapBuildingsVectorTiles,
} from "@/src/components/map/placeMapConfig";

type PolygonGeom = {
    type: "Polygon";
    coordinates: number[][][];
};

type MultiPolygonGeom = {
    type: "MultiPolygon";
    coordinates: number[][][][];
};

const DRAW_MODE_POLYGON = "polygon";
const DRAW_MODE_SELECT = "select";

/** Must match layer `id`s in `PLACE_MAP_STYLE` — base map paint hidden when imagery shows. */
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

/**
 * Esri World Imagery tiles are not reliably populated above ~18–19; higher-z requests often return
 * placeholder tiles (“Map data not yet available”). MapLibre overzooms z≤maxzoom tiles for map zoom above this.
 */
const SATELLITE_RASTER_SOURCE_MAX_ZOOM = 19;

export type BuildingEditorBasemapMode = "map" | "satellite" | "hybrid";

export type BuildingEditorMapDrawOutput = {
    geometryJson: string;
    areaSqM: number | null;
    vertexCount: number;
};

export type BuildingEditorMapProps = {
    /** Raw GeoJSON geometry text (Polygon / MultiPolygon); drives overlay load when edited outside the map. */
    geometryJson: string;
    /** Called when the user edits geometry via Terra Draw (not called on programmatic loads from `geometryJson`). */
    onDrawOutput?: (output: BuildingEditorMapDrawOutput) => void;
    className?: string;
    /**
     * Dashboard-only diagnostics overlay. Omit or false when this component might be reused on a public map.
     * @default false
     */
    showDebugPanel?: boolean;
    /** Latest failed submit message from the API (parent should set only in `onSubmit` catch). */
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

/** Minimum vertices on the exterior ring (excluding duplicated closing coordinate). */
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

/** Bounding box for Polygon or MultiPolygon (coerces numeric strings). */
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

/** Center from Polygon/MultiPolygon vertex extents (bbox midpoint). */
function centerLngLatFromParsed(g: PolygonGeom | MultiPolygonGeom): [number, number] | null {
    const bounds = getGeoJsonBounds(g);

    if (!bounds) {
        return null;
    }

    const [[west, south], [east, north]] = bounds as [[number, number], [number, number]];

    return [(west + east) / 2, (south + north) / 2];
}

const EDITING_FP_SOURCE = "editing-building-footprint";
const EDITING_FP_FILL = "editing-building-footprint-fill";
const EDITING_FP_LINE = "editing-building-footprint-outline";

const CURRENT_BUILDING_SOURCE = "current-building-geometry";
const CURRENT_BUILDING_FILL = "current-building-geometry-fill";
const CURRENT_BUILDING_OUTLINE = "current-building-geometry-outline";
/** Point feature in the same GeoJSON source; circle layers need Point geometries. */
const CURRENT_BUILDING_CENTER = "current-building-center";

/** One GeoJSON source holds footprint + center point; layers filter by `role`. */
const CURRENT_BUILDING_ROLE_FOOTPRINT = "footprint";
const CURRENT_BUILDING_ROLE_MARKER = "marker";

const INITIAL_BUILDING_CAMERA_ZOOM = 14;

const CURRENT_BUILDING_FILL_COLOR = "#f59e0b";
const CURRENT_BUILDING_OUTLINE_COLOR = "#b45309";
const CURRENT_BUILDING_FILL_OPACITY = [
    "interpolate",
    ["linear"],
    ["zoom"],
    14,
    0.65,
    18,
    0.45,
    20,
    0.3,
] as const;

const CURRENT_BUILDING_OUTLINE_WIDTH = [
    "interpolate",
    ["linear"],
    ["zoom"],
    14,
    6,
    16,
    5,
    18,
    4,
    20,
    3,
] as const;

const CURRENT_BUILDING_CIRCLE_RADIUS = [
    "interpolate",
    ["linear"],
    ["zoom"],
    14,
    10,
    18,
    8,
    20,
    5,
] as const;

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

function ensureEditingFootprintLayers(map: maplibregl.Map) {
    if (!map.getSource(EDITING_FP_SOURCE)) {
        map.addSource(EDITING_FP_SOURCE, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        });
    }

    if (!map.getLayer(EDITING_FP_FILL)) {
        map.addLayer({
            id: EDITING_FP_FILL,
            type: "fill",
            source: EDITING_FP_SOURCE,
            paint: {
                "fill-color": "#2563eb",
                "fill-opacity": 0.22,
            },
        });
    }

    if (!map.getLayer(EDITING_FP_LINE)) {
        map.addLayer({
            id: EDITING_FP_LINE,
            type: "line",
            source: EDITING_FP_SOURCE,
            paint: {
                "line-color": "#1e40af",
                "line-width": 2,
            },
        });
    }
}

function mapRefStillValid(map: maplibregl.Map): boolean {
    try {
        return typeof map.project === "function";
    } catch {
        return false;
    }
}

function bringCurrentBuildingLayersToFront(map: maplibregl.Map) {
    if (!map.getLayer(CURRENT_BUILDING_FILL) || !map.getLayer(CURRENT_BUILDING_OUTLINE)) {
        return;
    }

    /**
     * TerraDraw appends layers after the static style (above `place-labels`). Older logic moved the
     * current-building overlay *below* labels, which left it under TerraDraw and invisible at modest zoom.
     * Promote footprint + marker to the map top while keeping stacking: fill → outline → orange center.
     */
    map.moveLayer(CURRENT_BUILDING_FILL);
    map.moveLayer(CURRENT_BUILDING_OUTLINE);
    if (map.getLayer(CURRENT_BUILDING_CENTER)) {
        map.moveLayer(CURRENT_BUILDING_CENTER);
    }
}

/**
 * One-shot animated camera after GeoJSON source + layers exist so we do not steal the camera again on pan/zoom.
 * Uses idle/sourcedata/RAF because `idle` may have fired before handlers attach on first edit load.
 */
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
        const markerReady = !!map.getLayer(CURRENT_BUILDING_CENTER);

        let sourceRenderable = true;

        try {
            if (typeof map.isSourceLoaded === "function") {
                sourceRenderable = map.isSourceLoaded(sourceId);
            }
        } catch {
            sourceRenderable = true;
        }

        if (!srcReady || !fillReady || !outlineReady || !markerReady || !sourceRenderable) {
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
                "fill-opacity":
                    CURRENT_BUILDING_FILL_OPACITY as unknown as DataDrivenPropertyValueSpecification<number>,
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
                "line-width":
                    CURRENT_BUILDING_OUTLINE_WIDTH as unknown as DataDrivenPropertyValueSpecification<number>,
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
                "circle-radius":
                    CURRENT_BUILDING_CIRCLE_RADIUS as unknown as DataDrivenPropertyValueSpecification<number>,
                "circle-color": "#f97316",
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 2,
            },
        });
        devLog("current building center marker added");
    }

    bringCurrentBuildingLayersToFront(map);
}

function setEditingFootprintDisplay(
    map: maplibregl.Map,
    parsed: PolygonGeom | MultiPolygonGeom | null,
    draftRing: [number, number][]
) {
    ensureEditingFootprintLayers(map);

    const src = map.getSource(EDITING_FP_SOURCE) as maplibregl.GeoJSONSource | undefined;

    if (!src) {
        return;
    }

    type FootFeature = {
        type: "Feature";
        properties: Record<string, boolean | string>;
        geometry: PolygonGeom | MultiPolygonGeom | { type: "LineString"; coordinates: number[][] };
    };

    const features: FootFeature[] = [];

    if (parsed) {
        features.push({
            type: "Feature",
            properties: {},
            geometry: parsed,
        });
    }

    if (draftRing.length >= 2) {
        features.push({
            type: "Feature",
            properties: { draft: true },
            geometry: {
                type: "LineString",
                coordinates: draftRing.map(([lng, lat]) => [lng, lat]),
            },
        });
    }

    if (draftRing.length >= 3) {
        const closed = [...draftRing, draftRing[0]];
        features.push({
            type: "Feature",
            properties: { draftClosed: true },
            geometry: {
                type: "Polygon",
                coordinates: [closed],
            },
        });
    }

    src.setData({
        type: "FeatureCollection",
        features,
    });
}

function terraDrawFeaturesFromParsed(parsed: PolygonGeom | MultiPolygonGeom): GeoJSONStoreFeatures[] {
    if (parsed.type === "Polygon") {
        return [
            {
                type: "Feature",
                properties: { mode: DRAW_MODE_POLYGON },
                geometry: parsed,
            },
        ];
    }

    const feats: GeoJSONStoreFeatures[] = [];

    for (const shell of parsed.coordinates) {
        if (!shell?.length) {
            continue;
        }

        feats.push({
            type: "Feature",
            properties: { mode: DRAW_MODE_POLYGON },
            geometry: { type: "Polygon", coordinates: shell },
        });
    }

    return feats;
}

function mergedGeometryFromDrawSnapshot(draw: TerraDraw): PolygonGeom | MultiPolygonGeom | null {
    const polygons = draw
        .getSnapshot()
        .filter((f) => f.geometry.type === "Polygon")
        .map((f) => f.geometry as PolygonGeom);

    if (polygons.length === 0) {
        return null;
    }

    if (polygons.length === 1) {
        return polygons[0];
    }

    return {
        type: "MultiPolygon",
        coordinates: polygons.map((p) => p.coordinates),
    };
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

/** Matches Terra Draw store ids (`string | number`). */
type TerraFeatureId = string | number;

function featureIds(polygons: Array<{ id?: string | number | null }>): TerraFeatureId[] {
    const ids: TerraFeatureId[] = [];

    for (const f of polygons) {
        if (f.id !== undefined && f.id !== null) {
            ids.push(f.id);
        }
    }

    return ids;
}

export default function BuildingEditorMap({
    geometryJson,
    onDrawOutput,
    className,
    showDebugPanel = false,
    submissionError = "",
}: BuildingEditorMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const drawRef = useRef<TerraDraw | null>(null);

    const onDrawOutputRef = useRef(onDrawOutput);

    useEffect(() => {
        onDrawOutputRef.current = onDrawOutput;
    }, [onDrawOutput]);

    /** True immediately after Terra Draw emits — skips reloading `geometryJson` back into the draw instance. */
    const skipExternalReloadRef = useRef(false);

    /** Skips `onDrawOutput` while we load from `geometryJson` so the textarea is not rewritten. */
    const loadingExternalRef = useRef(false);

    /** One-time camera jump after first valid footprint geometry is shown (edit/new when JSON present). */
    const hasAppliedInitialBuildingCameraRef = useRef(false);

    const initialBuildingCameraCleanupRef = useRef<(() => void) | null>(null);

    const [mapReady, setMapReady] = useState(false);
    const [basemapMode, setBasemapMode] = useState<BuildingEditorBasemapMode>("map");
    const [zoomDisplay, setZoomDisplay] = useState<string>("—");
    const [drawUiMode, setDrawUiMode] = useState<typeof DRAW_MODE_POLYGON | typeof DRAW_MODE_SELECT>(
        DRAW_MODE_SELECT
    );
    const [stats, setStats] = useState<{ areaSqM: number | null; vertexCount: number }>({
        areaSqM: null,
        vertexCount: 0,
    });

    const geometryJsonRef = useRef(geometryJson);
    geometryJsonRef.current = geometryJson;

    const [manualDrawing, setManualDrawing] = useState(false);
    const manualDrawingRef = useRef(false);

    useEffect(() => {
        manualDrawingRef.current = manualDrawing;
    }, [manualDrawing]);

    const draftRingRef = useRef<[number, number][]>([]);
    const [draftPointsCount, setDraftPointsCount] = useState(0);

    const emitFromDraw = useCallback(() => {
        const draw = drawRef.current;

        if (!draw || loadingExternalRef.current) {
            return;
        }

        const merged = mergedGeometryFromDrawSnapshot(draw);

        const outStats = polygonStats(merged);
        setStats(outStats);

        const geometryJsonOut = merged ? JSON.stringify(merged, null, 2) : "";

        skipExternalReloadRef.current = true;
        onDrawOutputRef.current?.({
            geometryJson: geometryJsonOut,
            areaSqM: outStats.areaSqM,
            vertexCount: outStats.vertexCount,
        });
    }, []);

    const finishManualPolygon = useCallback(() => {
        const ring = draftRingRef.current;

        if (ring.length < 3) {
            return;
        }

        const closed = [...ring, ring[0]] as [number, number][];
        const poly: PolygonGeom = {
            type: "Polygon",
            coordinates: [closed],
        };

        draftRingRef.current = [];
        setDraftPointsCount(0);
        setManualDrawing(false);

        const draw = drawRef.current;
        const map = mapRef.current;

        if (draw) {
            draw.clear();
            draw.addFeatures([
                {
                    type: "Feature",
                    properties: { mode: DRAW_MODE_POLYGON },
                    geometry: poly,
                },
            ]);
        }

        if (map?.isStyleLoaded()) {
            setEditingFootprintDisplay(map, poly, []);
            devLog("existing geometry rendered");
        }

        const outStats = polygonStats(poly);
        setStats(outStats);

        skipExternalReloadRef.current = true;
        onDrawOutputRef.current?.({
            geometryJson: JSON.stringify(poly, null, 2),
            areaSqM: outStats.areaSqM,
            vertexCount: outStats.vertexCount,
        });

        if (map && map.isStyleLoaded()) {
            const b = getGeoJsonBounds(poly);

            if (b) {
                requestAnimationFrame(() => {
                    map.resize();
                    map.fitBounds(b, {
                        padding: 80,
                        maxZoom: 22,
                        duration: 500,
                    });
                    devLog("fit bounds applied");
                });
            }
        }

        devLog("polygon finished");
    }, []);

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
            style: PLACE_MAP_STYLE,
            center: PLACE_MAP_DEFAULT_CENTER,
            zoom: INITIAL_BUILDING_CAMERA_ZOOM,
            minZoom: 0,
            maxZoom: 22,
            scrollZoom: true,
            doubleClickZoom: true,
        });

        map.addControl(new maplibregl.NavigationControl({ showZoom: true, showCompass: true }), "top-right");

        map.on("zoomend", () => {
            devLog("current zoom", map.getZoom());
        });

        map.on("error", (event) => {
            console.error("BuildingEditorMap error:", event.error ?? event);
        });

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

            const satelliteLayer = {
                id: SATELLITE_LAYER_ID,
                type: "raster" as const,
                source: SATELLITE_SOURCE_ID,
                layout: { visibility: "none" as const },
                paint: {
                    "raster-opacity": 1,
                    "raster-resampling": "linear" as const,
                },
            };

            if (!map.getLayer(SATELLITE_LAYER_ID)) {
                map.addLayer(satelliteLayer, "landuse");
            }

            const adapter = new TerraDrawMapLibreGLAdapter({
                map,
                prefixId: "building-editor-td",
            });

            const polygonMode = new TerraDrawPolygonMode({
                modeName: DRAW_MODE_POLYGON,
            });

            const selectMode = new TerraDrawSelectMode({
                modeName: DRAW_MODE_SELECT,
                flags: {
                    [DRAW_MODE_POLYGON]: {
                        feature: {
                            coordinates: {
                                snappable: false,
                                draggable: true,
                                midpoints: true,
                                deletable: true,
                            },
                        },
                    },
                },
            });

            const draw = new TerraDraw({
                adapter,
                modes: [polygonMode, selectMode],
            });

            draw.start();
            draw.setMode(DRAW_MODE_SELECT);

            const onDrawChange = () => {
                emitFromDraw();
            };

            const onFinish = () => {
                devLog("polygon finished");
                emitFromDraw();
                draw.setMode(DRAW_MODE_SELECT);
                setDrawUiMode(DRAW_MODE_SELECT);
            };

            draw.on("change", onDrawChange);
            draw.on("finish", onFinish);

            drawRef.current = draw;

            const syncZoomDisplay = () => {
                if (cancelled) {
                    return;
                }

                setZoomDisplay(map.getZoom().toFixed(2));
            };

            syncZoomDisplay();
            map.on("zoom", syncZoomDisplay);
            map.on("moveend", syncZoomDisplay);

            ensureEditingFootprintLayers(map);
            ensureCurrentBuildingGeometryLayers(map);

            mapRef.current = map;

            exposeBuildingMapForDev(map);
            devLog("building map exposed");

            devLog("map loaded");

            setMapReady(true);
        });

        return () => {
            cancelled = true;

            hasAppliedInitialBuildingCameraRef.current = false;

            drawRef.current?.stop();
            drawRef.current = null;

            mapRef.current = null;
            if (typeof window !== "undefined") {
                delete (window as unknown as { __buildingMap?: maplibregl.Map }).__buildingMap;
            }
            setZoomDisplay("—");
            map.remove();
            setMapReady(false);
            setStats({ areaSqM: null, vertexCount: 0 });
        };
    }, [emitFromDraw]);

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

        const draw = drawRef.current;
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
                const centerPair = centerLngLatFromParsed(parsed);

                currentBuildingSrc.setData({
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
                });
                devLog("current building geometry rendered");
                bringCurrentBuildingLayersToFront(map);
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
                bringCurrentBuildingLayersToFront(map);
            }
            return () => {
                cancelInitialCamera();
            };
        }

        if (!draw) {
            if (parsed) {
                bringCurrentBuildingLayersToFront(map);
            }
            return () => {
                cancelInitialCamera();
            };
        }

        loadingExternalRef.current = true;

        try {
            if (!parsed) {
                draw.clear();
                setStats({ areaSqM: null, vertexCount: 0 });

                const fpMap = mapRef.current;

                if (fpMap?.isStyleLoaded()) {
                    setEditingFootprintDisplay(
                        fpMap,
                        null,
                        manualDrawingRef.current ? draftRingRef.current : []
                    );
                }
            } else {
                const feats = terraDrawFeaturesFromParsed(parsed);

                if (feats.length === 0) {
                    draw.clear();
                    setStats({ areaSqM: null, vertexCount: 0 });

                    const fpMap = mapRef.current;

                    if (fpMap?.isStyleLoaded()) {
                        setEditingFootprintDisplay(
                            fpMap,
                            null,
                            manualDrawingRef.current ? draftRingRef.current : []
                        );
                    }
                } else {
                    draw.clear();
                    draw.addFeatures(feats);

                    setStats(polygonStats(parsed));

                    setEditingFootprintDisplay(
                        map,
                        parsed,
                        manualDrawingRef.current ? draftRingRef.current : []
                    );
                }
            }
        } finally {
            const bump = () => {
                if (map.isStyleLoaded()) {
                    bringCurrentBuildingLayersToFront(map);
                }
            };
            bump();
            requestAnimationFrame(bump);

            queueMicrotask(() => {
                loadingExternalRef.current = false;
            });
        }

        return () => {
            cancelInitialCamera();
        };
    }, [geometryJson, mapReady]);

    useEffect(() => {
        const map = mapRef.current;

        if (!mapReady || !manualDrawing || !map?.isStyleLoaded()) {
            return;
        }

        const onMapClick = (e: maplibregl.MapMouseEvent) => {
            draftRingRef.current.push([e.lngLat.lng, e.lngLat.lat]);
            setDraftPointsCount(draftRingRef.current.length);
            devLog("draw point added");

            const parsed = parsePolygonOrMultiPolygon(geometryJsonRef.current.trim());

            setEditingFootprintDisplay(map, parsed, draftRingRef.current);
        };

        map.on("click", onMapClick);

        return () => {
            map.off("click", onMapClick);
        };
    }, [mapReady, manualDrawing]);

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
        draftRingRef.current = [];
        setDraftPointsCount(0);
        setManualDrawing(true);
        drawRef.current?.setMode(DRAW_MODE_SELECT);
        setDrawUiMode(DRAW_MODE_POLYGON);

        const map = mapRef.current;
        const parsed = parsePolygonOrMultiPolygon(geometryJsonRef.current.trim());

        if (map?.isStyleLoaded()) {
            setEditingFootprintDisplay(map, parsed, []);
        }
    }, []);

    const activateEditMode = useCallback(() => {
        draftRingRef.current = [];
        setDraftPointsCount(0);
        setManualDrawing(false);

        const draw = drawRef.current;

        if (!draw) {
            return;
        }

        draw.setMode(DRAW_MODE_SELECT);
        setDrawUiMode(DRAW_MODE_SELECT);

        const map = mapRef.current;
        const parsed = parsePolygonOrMultiPolygon(geometryJsonRef.current.trim());

        if (map?.isStyleLoaded()) {
            setEditingFootprintDisplay(map, parsed, []);
        }
    }, []);

    const deletePolygonFeatures = useCallback(() => {
        draftRingRef.current = [];
        setDraftPointsCount(0);
        setManualDrawing(false);

        const draw = drawRef.current;

        if (!draw) {
            return;
        }

        const polygons = draw.getSnapshot().filter((f) => f.geometry.type === "Polygon");
        const ids = featureIds(polygons);

        if (ids.length > 0) {
            draw.removeFeatures(ids);
        }

        const map = mapRef.current;

        if (map?.isStyleLoaded()) {
            setEditingFootprintDisplay(map, null, []);
        }

        emitFromDraw();
    }, [emitFromDraw]);

    const clearAllDrawing = useCallback(() => {
        draftRingRef.current = [];
        setDraftPointsCount(0);
        setManualDrawing(false);

        drawRef.current?.clear();

        const map = mapRef.current;

        if (map?.isStyleLoaded()) {
            setEditingFootprintDisplay(map, null, []);
        }

        emitFromDraw();
    }, [emitFromDraw]);

    const refreshBasemapBuildingsTiles = useCallback(() => {
        const map = mapRef.current;

        if (!map?.isStyleLoaded()) {
            return;
        }

        const ok = reloadMapBuildingsVectorTiles(map);
        devLog("building basemap tiles refresh", ok ? "ok" : "skipped");
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

    const debugParsed = parsePolygonOrMultiPolygon(geometryJson.trim());
    const debugCentroid = debugParsed ? centerLngLatFromParsed(debugParsed) : null;

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
                        <button
                            type="button"
                            title="Reload Martin building tiles if a new footprint is missing (cache)"
                            onClick={() => refreshBasemapBuildingsTiles()}
                            className="rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
                        >
                            Refresh tiles
                        </button>
                    </div>

                    <div className="pointer-events-auto flex flex-wrap gap-1.5 rounded-lg bg-white/95 p-1.5 shadow-md ring-1 ring-gray-200">
                        <button
                            type="button"
                            onClick={() => activateManualDraw()}
                            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                                drawUiMode === DRAW_MODE_POLYGON
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
                                drawUiMode === DRAW_MODE_SELECT && !manualDrawing
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
                                className="rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
                            >
                                Finish
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={deletePolygonFeatures}
                            className="rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
                        >
                            Delete
                        </button>
                        <button
                            type="button"
                            onClick={clearAllDrawing}
                            className="rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
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
                Gray fills are buildings from the live tile layer (same source as the public map). After saving, use
                Refresh tiles if a new footprint does not appear yet. Draw adds your footprint; Edit moves vertices.
                GeoJSON stays in sync with the field below.
            </p>
        </div>
    );
}
