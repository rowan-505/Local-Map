"use client";

/**
 * Reusable read-only MapLibre preview for all Transport detail pages
 * (route, stop, terminal, infrastructure line).
 *
 * It wraps the shared dashboard map building blocks:
 *   - `createPreviewBaseMap()`  — PMTiles-only basemap (no Martin MVT overlays)
 *   - `MapPreviewCard` + `mapPreviewUi` tokens — card chrome
 *   - `DataReviewMapHeaderControls` — Map / Sat / Hyb switch, Fit, Show vertices
 *   - `dataReviewBasemap` helpers — satellite raster layer + mode toggling
 *   - `mapVertexPreview` — line vertex dots
 *
 * One persistent map instance is created per mount; switching overlay data
 * (route variant, stop position, …) only swaps GeoJSON source data — the
 * basemap / PMTiles is never reloaded. The whole-country basemap comes from the
 * shared dashboard config; when that config is missing the failure is surfaced
 * in the card instead of being hardcoded.
 */
import type {
    Feature,
    FeatureCollection,
    Geometry,
    Point,
    Position,
} from "geojson";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import { useClientMounted } from "@/src/hooks/useClientMounted";
import { createPreviewBaseMap } from "@/src/components/map/createPreviewBaseMap";
import DataReviewMapHeaderControls from "@/src/components/map/DataReviewMapHeaderControls";
import {
    applyPreviewCompositeBasemapMode,
    ensureDataReviewSatelliteLayer,
    type DataReviewBasemapMode,
} from "@/src/components/map/dataReviewBasemap";
import { PLACE_MAP_DEFAULT_CENTER } from "@/src/components/map/placeMapConfig";
import { extractVerticesFromGeometry } from "@/src/components/map/mapVertexPreview";
import TransportMapLayerToggle from "./TransportMapLayerToggle";
import { useTransportDashboardBasemapMode } from "./transportBasemapMode";
import {
    coordsToLineStringGeometry,
    findPathSegmentForInsert,
    insertPathVertex,
    movePathVertex,
} from "./reviewMapPathEdit";
import { dashboardMyanmarTextFont } from "@/src/lib/map/dashboardMapFonts";
import MapPreviewCard from "@/src/components/map/MapPreviewCard";

import type { GeoJsonGeometry } from "./types";

export type TransportPreviewLngLat = { lng: number; lat: number };

export type TransportPreviewStop = TransportPreviewLngLat & {
    /** Route-stop row id — used for review-map selection + feature-state. */
    id?: string | null;
    sequence?: number | null;
    name?: string | null;
    /** Local preview moved but not saved to API. */
    moved?: boolean;
};

export type TransportPreviewMapProps = {
    title?: string;
    externalId?: string | null;
    subtitle?: string | null;
    className?: string;
    /** Viewport height utility classes for the map container. */
    heightClassName?: string;
    /** Message shown when nothing is renderable. */
    emptyHint?: string;
    /** Zoom used before the first fit and when no geometry exists (lower = more country). */
    initialZoom?: number;
    /** Zoom used when fitting to a single point (stop / terminal). */
    pointZoom?: number;

    /** Generic entity geometry: Point | MultiPoint | LineString | MultiLineString. */
    geometry?: GeoJsonGeometry | null;
    /** Saved route path from transport.route_paths (solid line). */
    routePath?: GeoJsonGeometry | null;
    /** Visual style for {@link routePath} (review map path-kind labeling). */
    routePathLineStyle?: { color: string; width: number; opacity: number } | null;
    /** In-map legend label for the saved route path overlay. */
    routePathLegendLabel?: string | null;
    /** Ordered route stops → numbered points (+ dashed connector when no `routePath`). */
    routeStops?: ReadonlyArray<TransportPreviewStop>;
    /**
     * Review map: unsaved stop move previews keyed by route_stop id. Merged into
     * the main stops source as display coordinates (draft wins over saved geom).
     */
    stopMoveDrafts?: Readonly<Record<string, { lng: number; lat: number }>>;
    /** Secondary linked point (e.g. a terminal's linked stop). */
    linkedPoint?: TransportPreviewLngLat | null;

    /** Single editable point (stop / terminal location), rendered as a marker. */
    editablePoint?: TransportPreviewLngLat | null;
    /** Marker colour for {@link editablePoint}. */
    editablePointColor?: string;
    /** When true the marker is draggable and map clicks move it. */
    pointDraggable?: boolean;
    /** Called when the marker is dragged or the map is clicked while editing. */
    onPointChange?: (coords: TransportPreviewLngLat) => void;
    /** In-map hint shown while editing. */
    editingHint?: string | null;

    /**
     * Draft LineString being drawn (ordered [lng, lat] positions). Rendered as a
     * dashed magenta line (≥ 2 points) plus numbered vertex dots, above all other
     * overlays. Lightweight + MapLibre-native — no drawing library.
     */
    draftPath?: ReadonlyArray<[number, number]> | null;
    /** When true, map clicks append a point via {@link onDraftPathAddPoint}. */
    pathDrawing?: boolean;
    /** Called with the clicked position while {@link pathDrawing} is true. */
    onDraftPathAddPoint?: (coords: TransportPreviewLngLat) => void;

    /** A one-time auto-fit runs whenever this key changes (e.g. publicId / variant id). */
    autoFitKey?: string | null;
    /** Increment to trigger an external Fit action (e.g. review-map top bar). */
    fitRequestId?: number;
    /**
     * With {@link fitRequestId}: `stop` centers {@link fitRequestStopId}; `variant`
     * fits all stops plus visible path and sequence guide (review map).
     */
    fitRequestMode?: "default" | "variant" | "stop";
    /** Route-stop id to center when {@link fitRequestMode} is `stop`. */
    fitRequestStopId?: string | null;
    /** When false, omit the MapPreviewCard header — map fills the container. */
    chromeless?: boolean;
    /**
     * When false, hide the Map / Sat / Hyb control (parent toolbar provides it).
     * Default: true for header maps, false for chromeless unless explicitly set.
     */
    showBasemapToggle?: boolean;
    /** Controlled basemap mode (defaults to shared transport localStorage mode). */
    basemapMode?: DataReviewBasemapMode;
    onBasemapModeChange?: (mode: DataReviewBasemapMode) => void;
    /** When false, hide the dashed stop-sequence connector (stop markers still render). */
    showStopSequenceGuide?: boolean;
    /**
     * When true, draw the stop-sequence guide even if a saved route path is shown
     * (review map). Default: guide only when there is no route path overlay.
     */
    allowStopSequenceGuideWithPath?: boolean;
    /** Highlight + label one ordered route stop (review map list selection). */
    selectedStopId?: string | null;
    /**
     * Review map: click map to preview-move the selected stop. Ignored while
     * {@link pathDrawing} is true.
     */
    onStopMovePreview?: (coords: TransportPreviewLngLat) => void;
    /** In-map hint while awaiting a map click to move the selected stop. */
    stopMoveHint?: string | null;
    /** Review map path edit: show route-path vertices and allow vertex selection. */
    pathEditActive?: boolean;
    pathEditDraftCoords?: ReadonlyArray<[number, number]> | null;
    selectedPathVertexIndex?: number | null;
    onPathVertexSelect?: (vertexIndex: number) => void;
    onPathEditDraftChange?: (coords: Array<[number, number]>) => void;
    pathEditHint?: string | null;
};

const DEFAULT_HEIGHT_CLASS =
    "h-[72vh] min-h-[420px] w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100";
const DEFAULT_INITIAL_ZOOM = 6;
const DEFAULT_POINT_ZOOM = 15;

const SRC_PATH = "transport-preview-path";
const SRC_STOP_PREVIEW = "transport-preview-stop-line";
const SRC_GEOM_LINE = "transport-preview-geom-line";
const SRC_GEOM_POINT = "transport-preview-geom-point";
const SRC_STOPS = "transport-preview-stops";
const SRC_LINKED = "transport-preview-linked";
const SRC_VERTICES = "transport-preview-vertices";
const SRC_PATH_VERTEX_SELECTED = "transport-preview-path-vertex-selected";
const SRC_DRAFT_PATH = "transport-preview-draft-path";
const SRC_DRAFT_VERTICES = "transport-preview-draft-vertices";
const SRC_EDITABLE_POINT = "transport-preview-editable-point";

const LYR_PATH = "transport-preview-path-line";
const LYR_STOP_PREVIEW_CASING = "transport-preview-stop-dashed-casing";
const LYR_STOP_PREVIEW = "transport-preview-stop-dashed";
const LYR_STOP_PREVIEW_ARROWS = "transport-preview-stop-guide-arrows";

/** Shared dash for stop-sequence guide casing + main line. */
const STOP_SEQUENCE_GUIDE_DASH: [number, number] = [1.2, 2.4];
const STOP_SEQUENCE_GUIDE_COLOR = "#F97316";

/** Updated each render so module-level `ensureLayers` can style for the active basemap mode. */
let transportPreviewBasemapMode: DataReviewBasemapMode = "map";
const LYR_GEOM_LINE = "transport-preview-geom-line-line";
const LYR_GEOM_POINT = "transport-preview-geom-point-circle";
const LYR_STOPS_CIRCLE = "transport-preview-stops-circle";
const LYR_STOPS_LABEL = "transport-preview-stops-label";
const LYR_LINKED = "transport-preview-linked-circle";
const LYR_VERTICES = "transport-preview-vertices-circle";
const LYR_PATH_VERTEX_SELECTED = "transport-preview-path-vertex-selected";
const LYR_DRAFT_PATH = "transport-preview-draft-path-line";
const LYR_DRAFT_VERTICES = "transport-preview-draft-vertices-circle";
const LYR_EDITABLE_POINT = "transport-preview-editable-point-circle";

const ORDERED_LAYER_IDS = [
    LYR_PATH,
    LYR_STOP_PREVIEW_CASING,
    LYR_STOP_PREVIEW,
    LYR_STOP_PREVIEW_ARROWS,
    LYR_GEOM_LINE,
    LYR_GEOM_POINT,
    LYR_STOPS_CIRCLE,
    LYR_LINKED,
    LYR_VERTICES,
    LYR_PATH_VERTEX_SELECTED,
    LYR_STOPS_LABEL,
    LYR_DRAFT_PATH,
    LYR_DRAFT_VERTICES,
    LYR_EDITABLE_POINT,
] as const;

function emptyFc(): FeatureCollection<Geometry> {
    return { type: "FeatureCollection", features: [] };
}

/** True when lng/lat are finite WGS84 coordinates suitable for GeoJSON / map fit. */
function isValidPreviewPoint(
    point: TransportPreviewLngLat | null | undefined,
): point is TransportPreviewLngLat {
    return (
        point !== null &&
        point !== undefined &&
        Number.isFinite(point.lng) &&
        Number.isFinite(point.lat) &&
        point.lng >= -180 &&
        point.lng <= 180 &&
        point.lat >= -90 &&
        point.lat <= 90
    );
}

function editablePointFc(
    point: TransportPreviewLngLat | null | undefined,
): FeatureCollection<Geometry> {
    if (!isValidPreviewPoint(point)) {
        return emptyFc();
    }
    return singleFeature({
        type: "Point",
        coordinates: [point.lng, point.lat],
    });
}

/**
 * Set data on an overlay source we own.
 *
 * Unlike the shared `addOrUpdateGeoJsonSource`, this does NOT gate on
 * `map.isStyleLoaded()`. Adding sources (and the remote PMTiles basemap sources)
 * can momentarily flip `isStyleLoaded()` to false in the same tick, which would
 * cause a guarded `setData` to silently skip and leave the overlay empty. The
 * caller guarantees the source already exists via {@link ensureLayers}.
 */
function setSourceData(
    map: maplibregl.Map,
    sourceId: string,
    data: FeatureCollection<Geometry>,
): void {
    const source = map.getSource(sourceId);
    if (source instanceof maplibregl.GeoJSONSource) {
        source.setData(data);
    }
}

function isDrawable(value: GeoJsonGeometry | null | undefined): value is GeoJsonGeometry {
    return Boolean(value && typeof value.type === "string" && "coordinates" in value);
}

function isLineGeometry(value: GeoJsonGeometry | null | undefined): boolean {
    return Boolean(value && (value.type === "LineString" || value.type === "MultiLineString"));
}

function isPointGeometry(value: GeoJsonGeometry | null | undefined): boolean {
    return Boolean(value && (value.type === "Point" || value.type === "MultiPoint"));
}

function collectPositions(coordinates: unknown, out: Position[]): void {
    if (!Array.isArray(coordinates)) {
        return;
    }
    if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
        out.push([coordinates[0], coordinates[1]]);
        return;
    }
    for (const c of coordinates) {
        collectPositions(c, out);
    }
}

function singleFeature(geometry: GeoJsonGeometry): FeatureCollection<Geometry> {
    return {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: geometry as unknown as Geometry }],
    };
}

function stopsToDisplayFeatures(
    stops: ReadonlyArray<TransportPreviewStop>,
    drafts?: Readonly<Record<string, { lng: number; lat: number }>>,
): {
    fc: FeatureCollection<Point>;
    ordered: Position[];
} {
    const features: Feature<Point>[] = [];
    const ordered: Position[] = [];
    for (const stop of stops) {
        if (!stop.id) {
            continue;
        }
        const draft = drafts?.[stop.id];
        const lng = draft?.lng ?? stop.lng;
        const lat = draft?.lat ?? stop.lat;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            continue;
        }
        const coords: Position = [lng, lat];
        ordered.push(coords);
        features.push({
            type: "Feature",
            properties: {
                id: stop.id,
                sequence: stop.sequence ?? features.length + 1,
                name: stop.name ?? "",
                moved: Boolean(draft),
            },
            geometry: { type: "Point", coordinates: coords },
        });
    }
    return { fc: { type: "FeatureCollection", features }, ordered };
}

/** Re-apply selection after setData — GeoJSON updates clear feature-state. */
function reapplySelectedStopFeatureState(
    map: maplibregl.Map,
    selectedStopId: string | null,
): void {
    if (!selectedStopId) {
        return;
    }
    try {
        map.setFeatureState({ source: SRC_STOPS, id: selectedStopId }, { selected: true });
    } catch {
        // Feature may not be in the source yet on the same tick as setData.
    }
}

/** Valid MapLibre paint: one interpolate per property; case lives inside stops. */
const STOP_CIRCLE_RADIUS_PAINT: maplibregl.ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    9,
    [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        7,
        ["boolean", ["get", "moved"], false],
        5,
        3.5,
    ],
    14,
    [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        10,
        ["boolean", ["get", "moved"], false],
        7,
        6,
    ],
    18,
    [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        13,
        ["boolean", ["get", "moved"], false],
        9,
        8,
    ],
];

const STOP_CIRCLE_COLOR_PAINT: maplibregl.ExpressionSpecification = [
    "case",
    ["boolean", ["feature-state", "selected"], false],
    "#ea580c",
    ["boolean", ["get", "moved"], false],
    "#d97706",
    "#1d4ed8",
];

const STOP_CIRCLE_STROKE_WIDTH_PAINT: maplibregl.ExpressionSpecification = [
    "case",
    ["boolean", ["feature-state", "selected"], false],
    3,
    ["boolean", ["get", "moved"], false],
    2.5,
    2,
];

const STOP_CIRCLE_STROKE_COLOR_PAINT: maplibregl.ExpressionSpecification = [
    "case",
    ["boolean", ["feature-state", "selected"], false],
    "#ffffff",
    ["boolean", ["get", "moved"], false],
    "#f59e0b",
    "#ffffff",
];

function applyStopPinLayerStyles(map: maplibregl.Map): void {
    if (!map.getLayer(LYR_STOPS_CIRCLE)) {
        return;
    }
    map.setPaintProperty(LYR_STOPS_CIRCLE, "circle-radius", STOP_CIRCLE_RADIUS_PAINT);
    map.setPaintProperty(LYR_STOPS_CIRCLE, "circle-color", STOP_CIRCLE_COLOR_PAINT);
    map.setPaintProperty(LYR_STOPS_CIRCLE, "circle-opacity", 0.95);
    map.setPaintProperty(LYR_STOPS_CIRCLE, "circle-stroke-width", STOP_CIRCLE_STROKE_WIDTH_PAINT);
    map.setPaintProperty(LYR_STOPS_CIRCLE, "circle-stroke-color", STOP_CIRCLE_STROKE_COLOR_PAINT);

    if (!map.getLayer(LYR_STOPS_LABEL)) {
        return;
    }
    map.setLayoutProperty(LYR_STOPS_LABEL, "text-field", ["to-string", ["get", "sequence"]]);
    map.setLayoutProperty(LYR_STOPS_LABEL, "text-size", 11);
    map.setLayoutProperty(LYR_STOPS_LABEL, "text-offset", [0, 1.2]);
    map.setLayoutProperty(LYR_STOPS_LABEL, "text-anchor", "top");
    map.setLayoutProperty(LYR_STOPS_LABEL, "text-allow-overlap", true);
    map.setLayoutProperty(LYR_STOPS_LABEL, "text-ignore-placement", false);
    map.setLayoutProperty(LYR_STOPS_LABEL, "text-optional", true);
    map.setPaintProperty(LYR_STOPS_LABEL, "text-color", [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        "#c2410c",
        ["case", ["boolean", ["get", "moved"], false], "#b45309", "#1e3a8a"],
    ]);
    map.setPaintProperty(LYR_STOPS_LABEL, "text-halo-color", "#ffffff");
    map.setPaintProperty(LYR_STOPS_LABEL, "text-halo-width", [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        2,
        1.4,
    ]);
}

function pathEditVerticesFc(geometry: Geometry): FeatureCollection<Point> {
    const base = extractVerticesFromGeometry(geometry);
    const features: Feature<Point>[] = base.features.map((feature, vertexIndex) => ({
        type: "Feature",
        properties: { vertexIndex, label: vertexIndex + 1 },
        geometry: feature.geometry as Point,
    }));
    return { type: "FeatureCollection", features };
}

function applyPathEditOverlay(
    map: maplibregl.Map,
    coords: ReadonlyArray<[number, number]>,
    selectedPathVertexIndex: number | null,
): boolean {
    if (!map.isStyleLoaded()) {
        return false;
    }
    ensureLayers(map);

    const pathGeometry = coordsToLineStringGeometry(coords);
    setSourceData(
        map,
        SRC_PATH,
        pathGeometry ? singleFeature(pathGeometry as unknown as GeoJsonGeometry) : emptyFc(),
    );

    const verticesFc =
        pathGeometry !== null ? pathEditVerticesFc(pathGeometry as unknown as Geometry) : emptyFc();
    setSourceData(map, SRC_VERTICES, verticesFc);

    const selectedFeatures =
        selectedPathVertexIndex !== null && selectedPathVertexIndex >= 0
            ? verticesFc.features.filter(
                  (f) => f.properties?.vertexIndex === selectedPathVertexIndex,
              )
            : [];
    setSourceData(map, SRC_PATH_VERTEX_SELECTED, {
        type: "FeatureCollection",
        features: selectedFeatures,
    });

    if (map.getLayer(LYR_VERTICES)) {
        map.setLayoutProperty(LYR_VERTICES, "visibility", "visible");
        map.setPaintProperty(LYR_VERTICES, "circle-radius", 5);
        map.setPaintProperty(LYR_VERTICES, "circle-color", "#4b5563");
        map.setPaintProperty(LYR_VERTICES, "circle-opacity", 0.9);
        map.setPaintProperty(LYR_VERTICES, "circle-stroke-width", 2);
        map.moveLayer(LYR_VERTICES);
        if (map.getLayer(LYR_PATH_VERTEX_SELECTED)) {
            map.moveLayer(LYR_PATH_VERTEX_SELECTED);
        }
        if (map.getLayer(LYR_STOPS_LABEL)) {
            map.moveLayer(LYR_STOPS_LABEL);
        }
    }
    if (map.getLayer(LYR_PATH_VERTEX_SELECTED)) {
        map.setLayoutProperty(
            LYR_PATH_VERTEX_SELECTED,
            "visibility",
            selectedFeatures.length > 0 ? "visible" : "none",
        );
    }
    return true;
}

function resetPathVertexLayerStyle(map: maplibregl.Map) {
    if (!map.getLayer(LYR_VERTICES)) {
        return;
    }
    map.setPaintProperty(LYR_VERTICES, "circle-radius", 2.75);
    map.setPaintProperty(LYR_VERTICES, "circle-color", "#1f2937");
    map.setPaintProperty(LYR_VERTICES, "circle-opacity", 0.65);
    map.setPaintProperty(LYR_VERTICES, "circle-stroke-width", 1);
}

function shouldShowStopSequenceGuide(
    showGuide: boolean,
    orderedLength: number,
    routePath: GeoJsonGeometry | null | undefined,
    allowWithPath: boolean,
): boolean {
    if (!showGuide || orderedLength < 2) {
        return false;
    }
    if (allowWithPath) {
        return true;
    }
    return !isDrawable(routePath);
}

function stopSequenceGuideFc(ordered: Position[]): FeatureCollection<Geometry> {
    if (ordered.length < 2) {
        return emptyFc();
    }
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: { kind: "stop-sequence-guide" },
                geometry: { type: "LineString", coordinates: ordered },
            },
        ],
    };
}

// ─── Shared bounds calculator ────────────────────────────────────────────────

/** Everything the fit calculator can frame, gathered from the component props. */
type FitGeometryInput = {
    routePath?: GeoJsonGeometry | null;
    geometry?: GeoJsonGeometry | null;
    stops: ReadonlyArray<TransportPreviewStop>;
    linkedPoint?: TransportPreviewLngLat | null;
    editablePoint?: TransportPreviewLngLat | null;
};

/** Result of {@link computeFitTarget}: nothing, a single point, or a real bbox. */
type FitTarget =
    | { kind: "empty" }
    | { kind: "point"; center: [number, number] }
    | { kind: "bounds"; bounds: maplibregl.LngLatBounds };

function pushFinite(out: Position[], lng: number, lat: number): void {
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
        out.push([lng, lat]);
    }
}

function collectFitPositions(input: FitGeometryInput): Position[] {
    const positions: Position[] = [];

    if (isDrawable(input.routePath)) {
        collectPositions(input.routePath.coordinates, positions);
    } else {
        const before = positions.length;
        for (const s of input.stops) {
            pushFinite(positions, s.lng, s.lat);
        }
        if (positions.length === before && isDrawable(input.geometry)) {
            collectPositions(input.geometry.coordinates, positions);
        }
    }

    if (isValidPreviewPoint(input.linkedPoint)) {
        pushFinite(positions, input.linkedPoint.lng, input.linkedPoint.lat);
    }
    if (isValidPreviewPoint(input.editablePoint)) {
        pushFinite(positions, input.editablePoint.lng, input.editablePoint.lat);
    }

    return positions;
}

/** Review-map variant fit: all stop points plus visible path and sequence guide. */
function collectReviewVariantFitPositions(input: {
    routePath?: GeoJsonGeometry | null;
    stops: ReadonlyArray<TransportPreviewStop>;
    sequenceGuideOrdered: Position[];
}): Position[] {
    const positions: Position[] = [];
    for (const s of input.stops) {
        pushFinite(positions, s.lng, s.lat);
    }
    for (const [lng, lat] of input.sequenceGuideOrdered) {
        pushFinite(positions, lng, lat);
    }
    if (isDrawable(input.routePath)) {
        collectPositions(input.routePath.coordinates, positions);
    }
    return positions;
}

function positionsToFitTarget(positions: Position[]): FitTarget {
    if (positions.length === 0) {
        return { kind: "empty" };
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const [lng, lat] of positions) {
        bounds.extend([lng, lat]);
    }
    if (bounds.isEmpty()) {
        return { kind: "empty" };
    }
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    if (ne.lng === sw.lng && ne.lat === sw.lat) {
        return { kind: "point", center: [ne.lng, ne.lat] };
    }
    return { kind: "bounds", bounds };
}

function applyFitTarget(
    map: maplibregl.Map,
    target: FitTarget,
    options: { initialZoom: number; pointZoom: number; duration: number },
): void {
    const { initialZoom, pointZoom, duration } = options;
    if (target.kind === "empty") {
        map.flyTo({ center: PLACE_MAP_DEFAULT_CENTER, zoom: initialZoom, duration });
        return;
    }
    if (target.kind === "point") {
        map.flyTo({ center: target.center, zoom: pointZoom, duration });
        return;
    }
    map.fitBounds(target.bounds, { padding: 56, maxZoom: 17, duration });
}

/**
 * Shared bounds calculator for {@link TransportPreviewMap}. Supports Point,
 * MultiPoint, LineString, MultiLineString, route paths, ordered stop points, the
 * dashed stop-sequence preview line, and terminal + linked stop combinations.
 */
function computeFitTarget(input: FitGeometryInput): FitTarget {
    return positionsToFitTarget(collectFitPositions(input));
}

function applyStopSequenceGuideLayerStyles(
    map: maplibregl.Map,
    basemapMode: DataReviewBasemapMode,
): void {
    const imageryOn = basemapMode !== "map";
    const mainWidth = imageryOn
        ? (["interpolate", ["linear"], ["zoom"], 9, 2, 14, 2.5, 18, 3] as const)
        : (["interpolate", ["linear"], ["zoom"], 9, 1.5, 14, 2, 18, 2] as const);
    const casingWidth = imageryOn
        ? (["interpolate", ["linear"], ["zoom"], 9, 4.5, 14, 5, 18, 6] as const)
        : (["interpolate", ["linear"], ["zoom"], 9, 3.5, 14, 4, 18, 5] as const);
    const arrowTextSize = imageryOn
        ? (["interpolate", ["linear"], ["zoom"], 11, 12, 14, 14, 18, 16] as const)
        : (["interpolate", ["linear"], ["zoom"], 11, 10, 14, 12, 18, 14] as const);

    if (map.getLayer(LYR_STOP_PREVIEW_CASING)) {
        map.setPaintProperty(LYR_STOP_PREVIEW_CASING, "line-color", "#ffffff");
        map.setPaintProperty(LYR_STOP_PREVIEW_CASING, "line-opacity", 0.85);
        map.setPaintProperty(LYR_STOP_PREVIEW_CASING, "line-width", casingWidth);
        map.setPaintProperty(LYR_STOP_PREVIEW_CASING, "line-dasharray", STOP_SEQUENCE_GUIDE_DASH);
    }
    if (map.getLayer(LYR_STOP_PREVIEW)) {
        map.setPaintProperty(LYR_STOP_PREVIEW, "line-color", STOP_SEQUENCE_GUIDE_COLOR);
        map.setPaintProperty(LYR_STOP_PREVIEW, "line-opacity", 0.95);
        map.setPaintProperty(LYR_STOP_PREVIEW, "line-width", mainWidth);
        map.setPaintProperty(LYR_STOP_PREVIEW, "line-dasharray", STOP_SEQUENCE_GUIDE_DASH);
    }
    if (map.getLayer(LYR_STOP_PREVIEW_ARROWS)) {
        map.setPaintProperty(LYR_STOP_PREVIEW_ARROWS, "text-color", STOP_SEQUENCE_GUIDE_COLOR);
        map.setPaintProperty(LYR_STOP_PREVIEW_ARROWS, "text-halo-color", "#ffffff");
        map.setPaintProperty(LYR_STOP_PREVIEW_ARROWS, "text-halo-width", imageryOn ? 2 : 1.5);
        map.setPaintProperty(LYR_STOP_PREVIEW_ARROWS, "text-opacity", 0.95);
        map.setLayoutProperty(LYR_STOP_PREVIEW_ARROWS, "text-size", arrowTextSize);
    }
}

function ensureLayers(map: maplibregl.Map): void {
    if (!map.isStyleLoaded()) {
        return;
    }

    // Drop legacy review-map layers from older builds (hot reload / long sessions).
    for (const legacyLayerId of [
        "transport-preview-stops-draft-circle",
        "transport-preview-stops-selected-label",
    ]) {
        if (map.getLayer(legacyLayerId)) {
            map.removeLayer(legacyLayerId);
        }
    }
    if (map.getSource("transport-preview-stops-draft")) {
        map.removeSource("transport-preview-stops-draft");
    }

    for (const id of [
        SRC_PATH,
        SRC_STOP_PREVIEW,
        SRC_GEOM_LINE,
        SRC_GEOM_POINT,
        SRC_LINKED,
        SRC_VERTICES,
        SRC_PATH_VERTEX_SELECTED,
        SRC_DRAFT_PATH,
        SRC_DRAFT_VERTICES,
        SRC_EDITABLE_POINT,
    ]) {
        if (!map.getSource(id)) {
            map.addSource(id, { type: "geojson", data: emptyFc() });
        }
    }

    if (!map.getSource(SRC_STOPS)) {
        map.addSource(SRC_STOPS, { type: "geojson", data: emptyFc(), promoteId: "id" });
    }

    if (!map.getSource(SRC_PATH_VERTEX_SELECTED)) {
        map.addSource(SRC_PATH_VERTEX_SELECTED, {
            type: "geojson",
            data: emptyFc(),
            promoteId: "vertexIndex",
        });
    }

    if (!map.getLayer(LYR_PATH)) {
        map.addLayer({
            id: LYR_PATH,
            type: "line",
            source: SRC_PATH,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#2563eb", "line-width": 4, "line-opacity": 0.9 },
        });
    }

    if (!map.getLayer(LYR_STOP_PREVIEW_CASING)) {
        map.addLayer({
            id: LYR_STOP_PREVIEW_CASING,
            type: "line",
            source: SRC_STOP_PREVIEW,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": "#ffffff",
                "line-width": 4,
                "line-opacity": 0.85,
                "line-dasharray": STOP_SEQUENCE_GUIDE_DASH,
            },
        });
    }

    if (!map.getLayer(LYR_STOP_PREVIEW)) {
        map.addLayer({
            id: LYR_STOP_PREVIEW,
            type: "line",
            source: SRC_STOP_PREVIEW,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": STOP_SEQUENCE_GUIDE_COLOR,
                "line-width": 2,
                "line-opacity": 0.95,
                "line-dasharray": STOP_SEQUENCE_GUIDE_DASH,
            },
        });
    }

    if (!map.getLayer(LYR_STOP_PREVIEW_ARROWS)) {
        map.addLayer({
            id: LYR_STOP_PREVIEW_ARROWS,
            type: "symbol",
            source: SRC_STOP_PREVIEW,
            minzoom: 11,
            layout: {
                "symbol-placement": "line",
                "symbol-spacing": ["interpolate", ["linear"], ["zoom"], 11, 140, 14, 90, 18, 55],
                "text-field": "▸",
                "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 14, 12, 18, 14],
                "text-keep-upright": false,
                "text-rotation-alignment": "map",
                "text-allow-overlap": true,
                "text-ignore-placement": true,
            },
            paint: {
                "text-color": STOP_SEQUENCE_GUIDE_COLOR,
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.5,
                "text-opacity": 0.95,
            },
        });
    }

    if (!map.getLayer(LYR_GEOM_LINE)) {
        map.addLayer({
            id: LYR_GEOM_LINE,
            type: "line",
            source: SRC_GEOM_LINE,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": "#0f766e",
                "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 14, 4, 18, 6],
                "line-opacity": 0.9,
            },
        });
    }

    if (!map.getLayer(LYR_GEOM_POINT)) {
        map.addLayer({
            id: LYR_GEOM_POINT,
            type: "circle",
            source: SRC_GEOM_POINT,
            paint: {
                "circle-radius": 6,
                "circle-color": "#16a34a",
                "circle-opacity": 0.95,
                "circle-stroke-width": 2,
                "circle-stroke-color": "#ffffff",
            },
        });
    }

    if (!map.getLayer(LYR_STOPS_CIRCLE)) {
        map.addLayer({
            id: LYR_STOPS_CIRCLE,
            type: "circle",
            source: SRC_STOPS,
            paint: {
                "circle-radius": STOP_CIRCLE_RADIUS_PAINT,
                "circle-color": STOP_CIRCLE_COLOR_PAINT,
                "circle-opacity": 0.95,
                "circle-stroke-width": STOP_CIRCLE_STROKE_WIDTH_PAINT,
                "circle-stroke-color": STOP_CIRCLE_STROKE_COLOR_PAINT,
            },
        });
    }

    if (!map.getLayer(LYR_STOPS_LABEL)) {
        map.addLayer({
            id: LYR_STOPS_LABEL,
            type: "symbol",
            source: SRC_STOPS,
            minzoom: 12,
            layout: {
                "text-field": ["to-string", ["get", "sequence"]],
                "text-font": dashboardMyanmarTextFont(),
                "text-size": 11,
                "text-offset": [0, 1.2],
                "text-anchor": "top",
                "text-optional": true,
                "text-allow-overlap": true,
            },
            paint: {
                "text-color": "#1e3a8a",
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.4,
            },
        });
    }

    applyStopPinLayerStyles(map);

    if (!map.getLayer(LYR_LINKED)) {
        map.addLayer({
            id: LYR_LINKED,
            type: "circle",
            source: SRC_LINKED,
            paint: {
                "circle-radius": 6,
                "circle-color": "#7c3aed",
                "circle-opacity": 0.95,
                "circle-stroke-width": 2,
                "circle-stroke-color": "#ffffff",
            },
        });
    }

    if (!map.getLayer(LYR_VERTICES)) {
        map.addLayer({
            id: LYR_VERTICES,
            type: "circle",
            source: SRC_VERTICES,
            paint: {
                "circle-radius": 2.75,
                "circle-color": "#1f2937",
                "circle-opacity": 0.65,
                "circle-stroke-width": 1,
                "circle-stroke-color": "#ffffff",
            },
        });
    }

    if (!map.getLayer(LYR_PATH_VERTEX_SELECTED)) {
        map.addLayer({
            id: LYR_PATH_VERTEX_SELECTED,
            type: "circle",
            source: SRC_PATH_VERTEX_SELECTED,
            paint: {
                "circle-radius": 8,
                "circle-color": "#db2777",
                "circle-opacity": 1,
                "circle-stroke-width": 2.5,
                "circle-stroke-color": "#ffffff",
            },
        });
    }

    if (!map.getLayer(LYR_DRAFT_PATH)) {
        map.addLayer({
            id: LYR_DRAFT_PATH,
            type: "line",
            source: SRC_DRAFT_PATH,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": "#db2777",
                "line-width": 3,
                "line-opacity": 0.95,
                "line-dasharray": [1.5, 1.2],
            },
        });
    }

    if (!map.getLayer(LYR_DRAFT_VERTICES)) {
        map.addLayer({
            id: LYR_DRAFT_VERTICES,
            type: "circle",
            source: SRC_DRAFT_VERTICES,
            paint: {
                "circle-radius": 4.5,
                "circle-color": "#db2777",
                "circle-opacity": 1,
                "circle-stroke-width": 2,
                "circle-stroke-color": "#ffffff",
            },
        });
    }

    if (!map.getLayer(LYR_EDITABLE_POINT)) {
        map.addLayer({
            id: LYR_EDITABLE_POINT,
            type: "circle",
            source: SRC_EDITABLE_POINT,
            paint: {
                "circle-radius": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    8,
                    7,
                    14,
                    10,
                    18,
                    12,
                ],
                "circle-color": "#1d4ed8",
                "circle-opacity": 0.95,
                "circle-stroke-width": 3,
                "circle-stroke-color": "#ffffff",
            },
        });
    }

    for (const id of ORDERED_LAYER_IDS) {
        if (map.getLayer(id)) {
            map.moveLayer(id);
        }
    }

    applyStopSequenceGuideLayerStyles(map, transportPreviewBasemapMode);
}

export default function TransportPreviewMap({
    title = "Map preview",
    externalId = null,
    subtitle = null,
    className,
    heightClassName = DEFAULT_HEIGHT_CLASS,
    emptyHint = "No geometry available",
    initialZoom = DEFAULT_INITIAL_ZOOM,
    pointZoom = DEFAULT_POINT_ZOOM,
    geometry = null,
    routePath = null,
    routePathLineStyle = null,
    routePathLegendLabel = null,
    routeStops,
    stopMoveDrafts,
    linkedPoint = null,
    editablePoint = null,
    editablePointColor = "#1d4ed8",
    pointDraggable = false,
    onPointChange,
    editingHint = null,
    draftPath = null,
    pathDrawing = false,
    onDraftPathAddPoint,
    autoFitKey = null,
    fitRequestId = 0,
    fitRequestMode = "default",
    fitRequestStopId = null,
    chromeless = false,
    showBasemapToggle,
    basemapMode: basemapModeProp,
    onBasemapModeChange: onBasemapModeChangeProp,
    showStopSequenceGuide = true,
    allowStopSequenceGuideWithPath = false,
    selectedStopId = null,
    onStopMovePreview,
    stopMoveHint = null,
    pathEditActive = false,
    pathEditDraftCoords = null,
    selectedPathVertexIndex = null,
    onPathVertexSelect,
    onPathEditDraftChange,
    pathEditHint = null,
}: TransportPreviewMapProps) {
    const clientMounted = useClientMounted();
    const transportBasemap = useTransportDashboardBasemapMode();
    const basemapMode = basemapModeProp ?? transportBasemap.basemapMode;
    transportPreviewBasemapMode = basemapMode;
    const setBasemapMode = onBasemapModeChangeProp ?? transportBasemap.setBasemapMode;
    const satelliteConfigured = transportBasemap.satelliteAvailable;
    const showBasemapControl = showBasemapToggle ?? !chromeless;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
    const lastFitKeyRef = useRef<string | null>(null);
    const lastAutoFitSignatureRef = useRef<string | null>(null);
    const onPointChangeRef = useRef<typeof onPointChange>(onPointChange);
    const onDraftPathAddPointRef = useRef<typeof onDraftPathAddPoint>(onDraftPathAddPoint);
    const onStopMovePreviewRef = useRef<typeof onStopMovePreview>(onStopMovePreview);
    const onPathVertexSelectRef = useRef<typeof onPathVertexSelect>(onPathVertexSelect);
    const onPathEditDraftChangeRef = useRef<typeof onPathEditDraftChange>(onPathEditDraftChange);
    const pathEditDragRef = useRef<{
        vertexIndex: number;
        startX: number;
        startY: number;
        moved: boolean;
        coords: Array<[number, number]>;
    } | null>(null);
    const pathEditSuppressClickRef = useRef(false);

    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState<string | null>(null);
    const [showVertices, setShowVertices] = useState(false);
    const [satelliteUnavailable, setSatelliteUnavailable] = useState(false);

    useEffect(() => {
        onPointChangeRef.current = onPointChange;
    }, [onPointChange]);

    useEffect(() => {
        onDraftPathAddPointRef.current = onDraftPathAddPoint;
    }, [onDraftPathAddPoint]);

    useEffect(() => {
        onStopMovePreviewRef.current = onStopMovePreview;
    }, [onStopMovePreview]);

    useEffect(() => {
        onPathVertexSelectRef.current = onPathVertexSelect;
    }, [onPathVertexSelect]);

    useEffect(() => {
        onPathEditDraftChangeRef.current = onPathEditDraftChange;
    }, [onPathEditDraftChange]);

    const stops = useMemo(() => routeStops ?? [], [routeStops]);

    const stopsGeo = useMemo(
        () => stopsToDisplayFeatures(stops, stopMoveDrafts),
        [stops, stopMoveDrafts],
    );

    const showStopSequenceGuideLine = useMemo(
        () =>
            shouldShowStopSequenceGuide(
                showStopSequenceGuide,
                stopsGeo.ordered.length,
                routePath,
                allowStopSequenceGuideWithPath,
            ),
        [showStopSequenceGuide, stopsGeo.ordered.length, routePath, allowStopSequenceGuideWithPath],
    );

    const stopSequenceGuideData = useMemo(
        () => (showStopSequenceGuideLine ? stopSequenceGuideFc(stopsGeo.ordered) : emptyFc()),
        [showStopSequenceGuideLine, stopsGeo.ordered],
    );

    const stopsById = useMemo(() => {
        const out = new Map<string, TransportPreviewStop>();
        for (const stop of stops) {
            if (!stop.id) {
                continue;
            }
            const draft = stopMoveDrafts?.[stop.id];
            out.set(
                stop.id,
                draft
                    ? { ...stop, lng: draft.lng, lat: draft.lat, moved: true }
                    : stop,
            );
        }
        return out;
    }, [stops, stopMoveDrafts]);

    /** A dashed stop-sequence guide connects ordered stops when no route path exists (or in review map). */
    const hasStopPreviewLine = showStopSequenceGuideLine;

    /**
     * The single line whose vertices the "Show vertices" toggle reveals, by priority:
     *   route path (LineString/MultiLineString)
     *   → generic line geometry (infrastructure)
     *   → dashed stop-sequence preview line (vertices == ordered stop coordinates)
     *
     * `null` for point-only maps (stop detail; terminal detail without a linked line),
     * which is what hides the checkbox. This is the shared source of truth for both
     * the toggle's visibility and the vertex layer's data.
     */
    const vertexLineGeometry = useMemo<Geometry | null>(() => {
        if (isLineGeometry(routePath)) {
            return routePath as unknown as Geometry;
        }
        if (isLineGeometry(geometry)) {
            return geometry as unknown as Geometry;
        }
        if (hasStopPreviewLine && stopsGeo.ordered.length >= 2) {
            return { type: "LineString", coordinates: stopsGeo.ordered } as Geometry;
        }
        return null;
    }, [routePath, geometry, hasStopPreviewLine, stopsGeo.ordered]);

    const hasLineGeometry = vertexLineGeometry !== null;
    const hasRenderable =
        isDrawable(routePath) ||
        isDrawable(geometry) ||
        stops.length > 0 ||
        isValidPreviewPoint(linkedPoint) ||
        isValidPreviewPoint(editablePoint);

    // --- Create the map once (basemap never reloads on overlay change). ------
    useEffect(() => {
        if (!clientMounted || !containerRef.current || mapRef.current) {
            return;
        }
        let cancelled = false;

        void (async () => {
            try {
                const map = await createPreviewBaseMap(containerRef.current!, {
                    zoom: initialZoom,
                    navigationMode: "compact",
                    onLoad: (loaded) => {
                        loaded.dragRotate.disable();
                        loaded.touchPitch.disable();
                        loaded.touchZoomRotate.disableRotation();
                        ensureDataReviewSatelliteLayer(loaded);
                        ensureLayers(loaded);
                        applyPreviewCompositeBasemapMode(loaded, basemapMode, {
                            overlayLayerIds: ORDERED_LAYER_IDS,
                        });
                        setMapReady(true);
                    },
                });
                if (cancelled) {
                    map.remove();
                    return;
                }
                mapRef.current = map;
            } catch (err) {
                if (!cancelled) {
                    setMapError(
                        err instanceof Error
                            ? err.message
                            : "Failed to load the basemap. Check the dashboard PMTiles config (NEXT_PUBLIC_BASEMAP_PMTILES_URL / NEXT_PUBLIC_BASEMAP_CURRENT_JSON_URL).",
                    );
                }
            }
        })();

        return () => {
            cancelled = true;
            setMapReady(false);
            markerRef.current?.remove();
            markerRef.current = null;
            mapRef.current?.remove();
            mapRef.current = null;
            lastFitKeyRef.current = null;
            lastAutoFitSignatureRef.current = null;
        };
        // initialZoom is read once at creation; intentionally excluded from deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientMounted]);

    // --- Keep the map sized to its container. --------------------------------
    useEffect(() => {
        const map = mapRef.current;
        const root = containerRef.current;
        if (!map || !mapReady || !root) {
            return;
        }
        const ro = new ResizeObserver(() => map.resize());
        ro.observe(root);
        return () => ro.disconnect();
    }, [mapReady]);

    // --- Basemap mode (Map / Sat / Hyb). -------------------------------------
    // Reuses the shared dashboard satellite raster + dynamic basemap toggling, and
    // never touches the transport overlays (they stay above the imagery), so fit /
    // vertices state is preserved across mode switches.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) {
            return;
        }
        const applied = applyPreviewCompositeBasemapMode(map, basemapMode, {
            overlayLayerIds: ORDERED_LAYER_IDS,
        });
        applyStopSequenceGuideLayerStyles(map, basemapMode);
        setSatelliteUnavailable(
            basemapMode !== "map" && (!applied || !satelliteConfigured),
        );
    }, [mapReady, basemapMode, satelliteConfigured]);

    const fitToContent = useCallback(
        (duration: number) => {
            const map = mapRef.current;
            // Camera moves don't need the style fully loaded — only a live map. The
            // previous `!map.isStyleLoaded()` guard made the Fit button silently
            // no-op while basemap/satellite tiles were still settling.
            if (!map || !mapReady) {
                return;
            }

            const target = computeFitTarget({
                routePath,
                geometry,
                stops,
                linkedPoint,
                editablePoint,
            });

            applyFitTarget(map, target, { initialZoom, pointZoom, duration });
        },
        [mapReady, routePath, geometry, stops, linkedPoint, editablePoint, initialZoom, pointZoom],
    );

    // --- Apply overlay data whenever it changes (basemap untouched). ---------
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) {
            return;
        }

        const apply = () => {
            if (map !== mapRef.current || !map.isStyleLoaded()) {
                return;
            }
            ensureLayers(map);

            // Saved route path (solid) + dashed stop-sequence guide (separate sources).
            const pathDrawable = isDrawable(routePath);
            setSourceData(map, SRC_PATH, pathDrawable ? singleFeature(routePath!) : emptyFc());

            if (map.getLayer(LYR_PATH) && routePathLineStyle) {
                map.setPaintProperty(LYR_PATH, "line-color", routePathLineStyle.color);
                map.setPaintProperty(LYR_PATH, "line-width", routePathLineStyle.width);
                map.setPaintProperty(LYR_PATH, "line-opacity", routePathLineStyle.opacity);
            }

            const { fc: stopsFc } = stopsGeo;
            setSourceData(map, SRC_STOPS, stopsFc as FeatureCollection<Geometry>);
            reapplySelectedStopFeatureState(map, selectedStopId);

            if (showStopSequenceGuideLine) {
                setSourceData(map, SRC_STOP_PREVIEW, stopSequenceGuideData);
            } else {
                setSourceData(map, SRC_STOP_PREVIEW, emptyFc());
            }

            // Generic entity geometry (infrastructure line / generic point).
            setSourceData(
                map,
                SRC_GEOM_LINE,
                isLineGeometry(geometry) ? singleFeature(geometry!) : emptyFc(),
            );
            setSourceData(
                map,
                SRC_GEOM_POINT,
                isPointGeometry(geometry) ? singleFeature(geometry!) : emptyFc(),
            );

            // Linked point + stop/terminal editable point (GeoJSON layers — reliable
            // on light basemap; DOM marker is only used while dragging).
            setSourceData(
                map,
                SRC_LINKED,
                isValidPreviewPoint(linkedPoint)
                    ? singleFeature({
                          type: "Point",
                          coordinates: [linkedPoint.lng, linkedPoint.lat],
                      })
                    : emptyFc(),
            );
            setSourceData(map, SRC_EDITABLE_POINT, editablePointFc(editablePoint));
            if (map.getLayer(LYR_EDITABLE_POINT)) {
                map.setPaintProperty(LYR_EDITABLE_POINT, "circle-color", editablePointColor);
                map.setLayoutProperty(
                    LYR_EDITABLE_POINT,
                    "visibility",
                    isValidPreviewPoint(editablePoint) ? "visible" : "none",
                );
            }

            // Vertices are managed by their own effect (driven by `showVertices` +
            // `vertexLineGeometry`) so toggling never re-runs this data pass.

            for (const id of ORDERED_LAYER_IDS) {
                if (map.getLayer(id)) {
                    map.moveLayer(id);
                }
            }

            // Auto-fit once per autoFitKey when renderable content is ready. For
            // stop/terminal point maps, wait until a valid editablePoint exists.
            const pointReady =
                isValidPreviewPoint(editablePoint) || isValidPreviewPoint(linkedPoint);
            const autoFitSignature =
                autoFitKey !== null
                    ? pointReady || stops.length > 0 || isDrawable(routePath) || isDrawable(geometry)
                        ? `${autoFitKey}:ready`
                        : null
                    : null;
            if (
                autoFitSignature !== null &&
                lastAutoFitSignatureRef.current !== autoFitSignature &&
                hasRenderable
            ) {
                lastAutoFitSignatureRef.current = autoFitSignature;
                lastFitKeyRef.current = autoFitKey;
                fitToContent(600);
            }
        };

        if (!map.isStyleLoaded()) {
            const onIdle = () => {
                if (map !== mapRef.current || !map.isStyleLoaded()) {
                    return;
                }
                map.off("idle", onIdle);
                apply();
            };
            map.on("idle", onIdle);
            return () => {
                map.off("idle", onIdle);
            };
        }

        apply();
    }, [
        mapReady,
        routePath,
        geometry,
        stopsGeo,
        stopSequenceGuideData,
        showStopSequenceGuideLine,
        linkedPoint,
        editablePoint,
        editablePointColor,
        autoFitKey,
        hasRenderable,
        fitToContent,
        routePathLineStyle,
        selectedStopId,
        basemapMode,
    ]);

    const prevSelectedStopIdRef = useRef<string | null>(null);
    const selectionPanTargetRef = useRef<string | null>(null);

    // Selection highlight via feature-state (no GeoJSON rebuild on click).
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) {
            return;
        }

        const apply = () => {
            if (map !== mapRef.current || !map.isStyleLoaded()) {
                return false;
            }
            ensureLayers(map);

            const prev = prevSelectedStopIdRef.current;
            if (prev && prev !== selectedStopId) {
                map.removeFeatureState({ source: SRC_STOPS, id: prev }, "selected");
            }
            if (selectedStopId) {
                map.setFeatureState({ source: SRC_STOPS, id: selectedStopId }, { selected: true });
            }
            prevSelectedStopIdRef.current = selectedStopId;

            const shouldPan = Boolean(
                selectedStopId && selectedStopId !== selectionPanTargetRef.current,
            );
            if (!selectedStopId) {
                selectionPanTargetRef.current = null;
            } else if (shouldPan) {
                selectionPanTargetRef.current = selectedStopId;
            }

            const selected = selectedStopId ? stopsById.get(selectedStopId) : null;
            if (
                shouldPan &&
                selected &&
                Number.isFinite(selected.lng) &&
                Number.isFinite(selected.lat) &&
                !map.getBounds().contains([selected.lng, selected.lat])
            ) {
                map.easeTo({
                    center: [selected.lng, selected.lat],
                    duration: 450,
                    zoom: Math.max(map.getZoom(), pointZoom - 1),
                });
            }

            return true;
        };

        if (apply()) {
            return;
        }

        const onIdle = () => {
            if (apply()) {
                map.off("idle", onIdle);
            }
        };
        map.on("idle", onIdle);
        return () => {
            map.off("idle", onIdle);
        };
    }, [mapReady, selectedStopId, stopsById, pointZoom]);

    useEffect(() => {
        if (!fitRequestId) {
            return;
        }
        const map = mapRef.current;
        if (!map || !mapReady) {
            return;
        }

        const duration = 550;
        const cameraOptions = { initialZoom, pointZoom, duration };

        if (fitRequestMode === "stop" && fitRequestStopId) {
            const selected = stopsById.get(fitRequestStopId);
            if (
                selected &&
                Number.isFinite(selected.lng) &&
                Number.isFinite(selected.lat)
            ) {
                map.flyTo({
                    center: [selected.lng, selected.lat],
                    zoom: pointZoom,
                    duration,
                });
                return;
            }
        }

        if (fitRequestMode === "variant") {
            const displayStops = Array.from(stopsById.values());
            const target = positionsToFitTarget(
                collectReviewVariantFitPositions({
                    routePath,
                    stops: displayStops,
                    sequenceGuideOrdered: showStopSequenceGuideLine ? stopsGeo.ordered : [],
                }),
            );
            applyFitTarget(map, target, cameraOptions);
            return;
        }

        fitToContent(duration);
    }, [
        fitRequestId,
        fitRequestMode,
        fitRequestStopId,
        fitToContent,
        mapReady,
        stopsById,
        routePath,
        showStopSequenceGuideLine,
        stopsGeo.ordered,
        initialZoom,
        pointZoom,
    ]);

    // --- Show vertices toggle (own effect — never recreates the map). --------
    // Reveals the vertices of the active line (`vertexLineGeometry`): route path,
    // infrastructure line, or the dashed stop-sequence preview. Toggling only
    // updates this source/layer; the basemap and overlay data are untouched.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) {
            return;
        }

        const apply = (): boolean => {
            if (map !== mapRef.current || !map.isStyleLoaded()) {
                return false;
            }
            ensureLayers(map);

            const show = showVertices && vertexLineGeometry !== null && !pathEditActive;
            setSourceData(
                map,
                SRC_VERTICES,
                show ? extractVerticesFromGeometry(vertexLineGeometry!) : emptyFc(),
            );

            if (map.getLayer(LYR_VERTICES)) {
                map.setLayoutProperty(LYR_VERTICES, "visibility", show ? "visible" : "none");
                // Keep vertex dots above the line, and stop labels above the dots.
                map.moveLayer(LYR_VERTICES);
                if (map.getLayer(LYR_STOPS_LABEL)) {
                    map.moveLayer(LYR_STOPS_LABEL);
                }
                if (map.getLayer(LYR_STOP_PREVIEW_ARROWS)) {
                    map.moveLayer(LYR_STOP_PREVIEW_ARROWS);
                }
            }
            return true;
        };

        if (apply()) {
            return;
        }

        const onIdle = () => {
            if (apply()) {
                map.off("idle", onIdle);
            }
        };
        map.on("idle", onIdle);
        return () => {
            map.off("idle", onIdle);
        };
    }, [mapReady, showVertices, vertexLineGeometry, pathEditActive]);

    // --- Review map path edit: vertices, selection, drag, click edits. -------
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady || !pathEditActive || !pathEditDraftCoords) {
            return;
        }

        const apply = (): boolean =>
            applyPathEditOverlay(map, pathEditDraftCoords, selectedPathVertexIndex ?? null);

        if (!apply()) {
            const onIdle = () => {
                if (apply()) {
                    map.off("idle", onIdle);
                }
            };
            map.on("idle", onIdle);
            return () => {
                map.off("idle", onIdle);
                resetPathVertexLayerStyle(map);
                setSourceData(map, SRC_PATH_VERTEX_SELECTED, emptyFc());
            };
        }

        return () => {
            resetPathVertexLayerStyle(map);
            setSourceData(map, SRC_PATH_VERTEX_SELECTED, emptyFc());
        };
    }, [mapReady, pathEditActive, pathEditDraftCoords, selectedPathVertexIndex]);

    useEffect(() => {
        const map = mapRef.current;
        if (
            !map ||
            !mapReady ||
            !pathEditActive ||
            !pathEditDraftCoords ||
            !onPathEditDraftChange
        ) {
            return;
        }

        const DRAG_THRESHOLD_PX = 4;

        const readVertexIndex = (feature: maplibregl.MapGeoJSONFeature): number | null => {
            const raw = feature.properties?.vertexIndex;
            const vertexIndex = typeof raw === "number" ? raw : Number(raw);
            return Number.isFinite(vertexIndex) ? vertexIndex : null;
        };

        const commitDraft = (coords: Array<[number, number]>) => {
            onPathEditDraftChangeRef.current?.(coords);
        };

        const onMouseDown = (e: maplibregl.MapMouseEvent) => {
            const hits = map.queryRenderedFeatures(e.point, { layers: [LYR_VERTICES] });
            const vertexIndex = hits[0] ? readVertexIndex(hits[0]) : null;
            if (vertexIndex === null) {
                return;
            }
            e.preventDefault();
            onPathVertexSelectRef.current?.(vertexIndex);
            pathEditDragRef.current = {
                vertexIndex,
                startX: e.point.x,
                startY: e.point.y,
                moved: false,
                coords: pathEditDraftCoords.map((coord) => [coord[0], coord[1]] as [number, number]),
            };
            map.dragPan.disable();
            map.getCanvas().style.cursor = "grabbing";
        };

        const onMouseMove = (e: maplibregl.MapMouseEvent) => {
            const drag = pathEditDragRef.current;
            if (drag) {
                if (
                    !drag.moved &&
                    (Math.abs(e.point.x - drag.startX) > DRAG_THRESHOLD_PX ||
                        Math.abs(e.point.y - drag.startY) > DRAG_THRESHOLD_PX)
                ) {
                    drag.moved = true;
                }
                if (drag.moved) {
                    drag.coords = movePathVertex(
                        drag.coords,
                        drag.vertexIndex,
                        e.lngLat.lng,
                        e.lngLat.lat,
                    );
                    applyPathEditOverlay(map, drag.coords, drag.vertexIndex);
                }
                return;
            }

            const hits = map.queryRenderedFeatures(e.point, { layers: [LYR_VERTICES] });
            map.getCanvas().style.cursor = hits.length > 0 ? "pointer" : "";
        };

        const onMouseUp = () => {
            const drag = pathEditDragRef.current;
            if (!drag) {
                return;
            }

            pathEditDragRef.current = null;
            map.dragPan.enable();

            if (drag.moved) {
                pathEditSuppressClickRef.current = true;
                commitDraft(drag.coords);
            }
            map.getCanvas().style.cursor = "pointer";
        };

        const onClick = (e: maplibregl.MapMouseEvent) => {
            if (pathEditSuppressClickRef.current) {
                pathEditSuppressClickRef.current = false;
                return;
            }

            const coords = [...pathEditDraftCoords];
            const vertexHits = map.queryRenderedFeatures(e.point, { layers: [LYR_VERTICES] });
            const vertexIndex = vertexHits[0] ? readVertexIndex(vertexHits[0]) : null;
            if (vertexIndex !== null) {
                onPathVertexSelectRef.current?.(vertexIndex);
                return;
            }

            if (selectedPathVertexIndex !== null && selectedPathVertexIndex >= 0) {
                commitDraft(
                    movePathVertex(coords, selectedPathVertexIndex, e.lngLat.lng, e.lngLat.lat),
                );
                return;
            }

            const pathHits = map.queryRenderedFeatures(e.point, { layers: [LYR_PATH] });
            if (pathHits.length > 0) {
                const segment = findPathSegmentForInsert(coords, e.lngLat.lng, e.lngLat.lat);
                if (segment) {
                    const inserted = insertPathVertex(
                        coords,
                        segment.segmentIndex,
                        segment.lng,
                        segment.lat,
                    );
                    if (inserted) {
                        commitDraft(inserted.coords);
                        onPathVertexSelectRef.current?.(inserted.newVertexIndex);
                    }
                }
            }
        };

        const onMouseLeave = () => {
            if (!pathEditDragRef.current) {
                map.getCanvas().style.cursor = "";
            }
        };

        map.on("mousedown", onMouseDown);
        map.on("mousemove", onMouseMove);
        map.on("mouseup", onMouseUp);
        map.on("click", onClick);
        map.on("mouseleave", onMouseLeave);
        return () => {
            pathEditDragRef.current = null;
            pathEditSuppressClickRef.current = false;
            map.off("mousedown", onMouseDown);
            map.off("mousemove", onMouseMove);
            map.off("mouseup", onMouseUp);
            map.off("click", onClick);
            map.off("mouseleave", onMouseLeave);
            map.dragPan.enable();
            if (mapRef.current) {
                mapRef.current.getCanvas().style.cursor = "";
            }
        };
    }, [
        mapReady,
        pathEditActive,
        pathEditDraftCoords,
        selectedPathVertexIndex,
        onPathEditDraftChange,
    ]);

    // --- Editable marker (draggable only — static pin uses GeoJSON layer). ----
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) {
            return;
        }

        const removeMarker = () => {
            markerRef.current?.remove();
            markerRef.current = null;
        };

        if (!pointDraggable || !isValidPreviewPoint(editablePoint)) {
            removeMarker();
            return;
        }

        const syncMarker = () => {
            if (!mapRef.current || !isValidPreviewPoint(editablePoint)) {
                removeMarker();
                return;
            }
            const lngLat: [number, number] = [editablePoint.lng, editablePoint.lat];
            if (!markerRef.current) {
                const marker = new maplibregl.Marker({
                    color: editablePointColor,
                    draggable: true,
                })
                    .setLngLat(lngLat)
                    .addTo(mapRef.current);
                marker.on("dragend", () => {
                    const ll = marker.getLngLat();
                    onPointChangeRef.current?.({ lng: ll.lng, lat: ll.lat });
                });
                markerRef.current = marker;
            } else {
                markerRef.current.setLngLat(lngLat);
                markerRef.current.setDraggable(true);
            }
        };

        let attached = false;
        let idleHandler: (() => void) | null = null;
        const attach = () => {
            if (attached || map !== mapRef.current) {
                return;
            }
            attached = true;
            syncMarker();
            map.on("resize", syncMarker);
        };

        if (map.isStyleLoaded()) {
            attach();
        } else {
            idleHandler = () => {
                if (map !== mapRef.current || !map.isStyleLoaded()) {
                    return;
                }
                map.off("idle", idleHandler!);
                attach();
            };
            map.on("idle", idleHandler);
        }

        return () => {
            if (idleHandler) {
                map.off("idle", idleHandler);
            }
            map.off("resize", syncMarker);
            removeMarker();
        };
    }, [mapReady, editablePoint, pointDraggable, editablePointColor]);

    // --- Click-to-place while editing. ---------------------------------------
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady || !pointDraggable || !onPointChange) {
            return;
        }
        const handler = (e: maplibregl.MapMouseEvent) => {
            onPointChangeRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
        };
        map.on("click", handler);
        map.getCanvas().style.cursor = "crosshair";
        return () => {
            map.off("click", handler);
            if (mapRef.current) {
                mapRef.current.getCanvas().style.cursor = "";
            }
        };
    }, [mapReady, pointDraggable, onPointChange]);

    // --- Draft path overlay (dashed line ≥2 pts + numbered vertices). --------
    // Own effect so appending a point only updates these two sources — the
    // basemap and the other overlays are untouched.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) {
            return;
        }
        const apply = (): boolean => {
            if (map !== mapRef.current || !map.isStyleLoaded()) {
                return false;
            }
            ensureLayers(map);
            const coords = (draftPath ?? []).filter(
                (c) => Number.isFinite(c[0]) && Number.isFinite(c[1]),
            ) as Position[];
            setSourceData(
                map,
                SRC_DRAFT_PATH,
                coords.length >= 2
                    ? {
                          type: "FeatureCollection",
                          features: [
                              {
                                  type: "Feature",
                                  properties: {},
                                  geometry: { type: "LineString", coordinates: coords },
                              },
                          ],
                      }
                    : emptyFc(),
            );
            setSourceData(map, SRC_DRAFT_VERTICES, {
                type: "FeatureCollection",
                features: coords.map((c, i) => ({
                    type: "Feature",
                    properties: { index: i + 1 },
                    geometry: { type: "Point", coordinates: c },
                })),
            });
            if (map.getLayer(LYR_DRAFT_PATH)) map.moveLayer(LYR_DRAFT_PATH);
            if (map.getLayer(LYR_DRAFT_VERTICES)) map.moveLayer(LYR_DRAFT_VERTICES);
            return true;
        };
        if (apply()) {
            return;
        }
        const onIdle = () => {
            if (apply()) {
                map.off("idle", onIdle);
            }
        };
        map.on("idle", onIdle);
        return () => {
            map.off("idle", onIdle);
        };
    }, [mapReady, draftPath]);

    // --- Click-to-add while drawing a path. ----------------------------------
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady || !pathDrawing || !onDraftPathAddPoint) {
            return;
        }
        const handler = (e: maplibregl.MapMouseEvent) => {
            onDraftPathAddPointRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
        };
        map.on("click", handler);
        map.getCanvas().style.cursor = "crosshair";
        return () => {
            map.off("click", handler);
            if (mapRef.current) {
                mapRef.current.getCanvas().style.cursor = "";
            }
        };
    }, [mapReady, pathDrawing, onDraftPathAddPoint]);

    // --- Click map to preview-move selected review-map stop. ----------------
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady || pathDrawing || pathEditActive || !onStopMovePreview) {
            return;
        }
        const handler = (e: maplibregl.MapMouseEvent) => {
            onStopMovePreviewRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
        };
        map.on("click", handler);
        map.getCanvas().style.cursor = "crosshair";
        return () => {
            map.off("click", handler);
            if (mapRef.current) {
                mapRef.current.getCanvas().style.cursor = "";
            }
        };
    }, [mapReady, pathDrawing, pathEditActive, onStopMovePreview]);

    const handleFit = useCallback(() => {
        fitToContent(550);
    }, [fitToContent]);

    const mapInteractionHint = pathEditHint ?? editingHint ?? stopMoveHint;
    const showRoutePathLegend = Boolean(
        routePathLegendLabel && isDrawable(routePath) && routePathLineStyle,
    );

    const mapBody = (
        <div className={chromeless ? "relative min-h-0 flex-1" : "relative p-2"}>
            {clientMounted ? (
                <div ref={containerRef} className={heightClassName} />
            ) : (
                <div className={heightClassName} aria-hidden />
            )}

            {mapInteractionHint ? (
                <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-md bg-white/95 px-3 py-2 text-xs text-blue-900 shadow ring-1 ring-blue-200">
                    {mapInteractionHint}
                </div>
            ) : null}

            {showStopSequenceGuideLine ? (
                <div
                    className={`pointer-events-none absolute left-4 z-10 rounded-md border border-amber-200/90 bg-white/92 px-2.5 py-1.5 text-xs text-amber-900 shadow-sm ${
                        mapInteractionHint
                            ? "bottom-14"
                            : showRoutePathLegend
                              ? "bottom-14"
                              : "bottom-4"
                    }`}
                >
                    <span
                        className="mr-2 inline-block w-5 translate-y-[-1px] border-t-2 border-dashed border-amber-600 align-middle"
                        aria-hidden
                    />
                    Stop sequence guide
                    <span className="mt-0.5 block text-[10px] font-normal text-amber-800/80">
                        Dashed · not saved as route path
                    </span>
                </div>
            ) : null}

            {showRoutePathLegend ? (
                <div
                    className={`pointer-events-none absolute right-4 z-10 rounded-md border bg-white/92 px-2.5 py-1.5 text-xs shadow-sm ${
                        mapInteractionHint ? "bottom-14" : "bottom-4"
                    }`}
                    style={{
                        borderColor: `${routePathLineStyle!.color}33`,
                        color: routePathLineStyle!.color,
                    }}
                >
                    <span
                        className="mr-2 inline-block w-5 translate-y-[-1px] border-t-[3px] align-middle"
                        style={{ borderColor: routePathLineStyle!.color }}
                        aria-hidden
                    />
                    {routePathLegendLabel}
                    <span className="mt-0.5 block text-[10px] font-normal text-gray-500">
                        Solid · saved route path
                    </span>
                </div>
            ) : null}

            {satelliteUnavailable ? (
                <div className="pointer-events-none absolute right-4 top-4 z-10 rounded-md bg-amber-50/95 px-3 py-2 text-xs text-amber-800 shadow ring-1 ring-amber-200">
                    {satelliteConfigured
                        ? "Satellite imagery is unavailable. Showing the map basemap."
                        : "Satellite tiles not configured. Showing the map basemap."}
                </div>
            ) : null}

            {showBasemapControl && chromeless ? (
                <div className="absolute right-3 top-3 z-20">
                    <TransportMapLayerToggle
                        value={basemapMode}
                        onChange={setBasemapMode}
                        satelliteAvailable={satelliteConfigured}
                    />
                </div>
            ) : null}

            {!hasRenderable && !mapError ? (
                <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center">
                    <p className="rounded-md bg-white/90 px-4 py-2 text-sm text-gray-500 shadow ring-1 ring-gray-200">
                        {emptyHint}
                    </p>
                </div>
            ) : null}
        </div>
    );

    if (chromeless) {
        return (
            <div className={`flex min-h-0 flex-1 flex-col ${className ?? ""}`}>
                {mapError ? (
                    <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                        {mapError}
                    </div>
                ) : null}
                {mapBody}
            </div>
        );
    }

    return (
        <MapPreviewCard className={className} error={mapError}>
            <DataReviewMapHeaderControls
                title={title}
                externalId={externalId}
                subtitle={subtitle}
                hasRenderable={hasRenderable}
                onFit={handleFit}
                fitButtonLabel="Fit"
                basemapMode={basemapMode}
                onBasemapModeChange={setBasemapMode}
                satelliteAvailable={satelliteConfigured}
                showVerticesToggle={hasLineGeometry}
                showVertices={showVertices}
                onShowVerticesChange={setShowVertices}
            />
            {mapBody}
        </MapPreviewCard>
    );
}
