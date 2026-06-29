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
import { dashboardMyanmarTextFont } from "@/src/lib/map/dashboardMapFonts";
import MapPreviewCard from "@/src/components/map/MapPreviewCard";

import type { GeoJsonGeometry } from "./types";

export type TransportPreviewLngLat = { lng: number; lat: number };

export type TransportPreviewStop = TransportPreviewLngLat & {
    sequence?: number | null;
    name?: string | null;
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
    /** Verified / selected route path (solid line). */
    routePath?: GeoJsonGeometry | null;
    /** Ordered route stops → numbered points (+ dashed connector when no `routePath`). */
    routeStops?: ReadonlyArray<TransportPreviewStop>;
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
const SRC_DRAFT_PATH = "transport-preview-draft-path";
const SRC_DRAFT_VERTICES = "transport-preview-draft-vertices";

const LYR_PATH = "transport-preview-path-line";
const LYR_STOP_PREVIEW = "transport-preview-stop-dashed";
const LYR_GEOM_LINE = "transport-preview-geom-line-line";
const LYR_GEOM_POINT = "transport-preview-geom-point-circle";
const LYR_STOPS_CIRCLE = "transport-preview-stops-circle";
const LYR_STOPS_LABEL = "transport-preview-stops-label";
const LYR_LINKED = "transport-preview-linked-circle";
const LYR_VERTICES = "transport-preview-vertices-circle";
const LYR_DRAFT_PATH = "transport-preview-draft-path-line";
const LYR_DRAFT_VERTICES = "transport-preview-draft-vertices-circle";

const ORDERED_LAYER_IDS = [
    LYR_PATH,
    LYR_STOP_PREVIEW,
    LYR_GEOM_LINE,
    LYR_GEOM_POINT,
    LYR_STOPS_CIRCLE,
    LYR_LINKED,
    LYR_VERTICES,
    LYR_STOPS_LABEL,
    LYR_DRAFT_PATH,
    LYR_DRAFT_VERTICES,
] as const;

function emptyFc(): FeatureCollection<Geometry> {
    return { type: "FeatureCollection", features: [] };
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

function stopsToFeatures(stops: ReadonlyArray<TransportPreviewStop>): {
    fc: FeatureCollection<Point>;
    ordered: Position[];
} {
    const features: Feature<Point>[] = [];
    const ordered: Position[] = [];
    for (const stop of stops) {
        if (!Number.isFinite(stop.lng) || !Number.isFinite(stop.lat)) {
            continue;
        }
        const coords: Position = [stop.lng, stop.lat];
        ordered.push(coords);
        features.push({
            type: "Feature",
            properties: {
                sequence: stop.sequence ?? features.length + 1,
                name: stop.name ?? "",
            },
            geometry: { type: "Point", coordinates: coords },
        });
    }
    return { fc: { type: "FeatureCollection", features }, ordered };
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

/**
 * Context-aware position set used for fitting. Picks ONE primary geometry source
 * by priority so each detail page frames the right thing:
 *
 *   route path (line)      → fit the verified path
 *   else ordered stops     → fit the stop-sequence (dashed preview) points
 *   else generic geometry  → fit Point / MultiPoint / LineString / MultiLineString
 *
 * Standalone point context (terminal `editablePoint`, linked stop `linkedPoint`)
 * is always included so a terminal + its linked stop are framed together.
 */
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

    if (input.linkedPoint) {
        pushFinite(positions, input.linkedPoint.lng, input.linkedPoint.lat);
    }
    if (input.editablePoint) {
        pushFinite(positions, input.editablePoint.lng, input.editablePoint.lat);
    }

    return positions;
}

/**
 * Shared bounds calculator for {@link TransportPreviewMap}. Supports Point,
 * MultiPoint, LineString, MultiLineString, route paths, ordered stop points, the
 * dashed stop-sequence preview line, and terminal + linked stop combinations.
 */
function computeFitTarget(input: FitGeometryInput): FitTarget {
    const positions = collectFitPositions(input);
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

function ensureLayers(map: maplibregl.Map): void {
    if (!map.isStyleLoaded()) {
        return;
    }

    for (const id of [
        SRC_PATH,
        SRC_STOP_PREVIEW,
        SRC_GEOM_LINE,
        SRC_GEOM_POINT,
        SRC_STOPS,
        SRC_LINKED,
        SRC_VERTICES,
        SRC_DRAFT_PATH,
        SRC_DRAFT_VERTICES,
    ]) {
        if (!map.getSource(id)) {
            map.addSource(id, { type: "geojson", data: emptyFc() });
        }
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

    if (!map.getLayer(LYR_STOP_PREVIEW)) {
        map.addLayer({
            id: LYR_STOP_PREVIEW,
            type: "line",
            source: SRC_STOP_PREVIEW,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": "#d97706",
                "line-width": 2.5,
                "line-opacity": 0.9,
                "line-dasharray": [2, 2],
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
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 14, 6, 18, 8],
                "circle-color": "#1d4ed8",
                "circle-opacity": 0.95,
                "circle-stroke-width": 2,
                "circle-stroke-color": "#ffffff",
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
                "text-offset": [0, 1.1],
                "text-anchor": "top",
                "text-optional": true,
                "text-allow-overlap": false,
            },
            paint: {
                "text-color": "#1e3a8a",
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.4,
            },
        });
    }

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

    for (const id of ORDERED_LAYER_IDS) {
        if (map.getLayer(id)) {
            map.moveLayer(id);
        }
    }
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
    routeStops,
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
}: TransportPreviewMapProps) {
    const clientMounted = useClientMounted();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
    const lastFitKeyRef = useRef<string | null>(null);
    const onPointChangeRef = useRef<typeof onPointChange>(onPointChange);
    const onDraftPathAddPointRef = useRef<typeof onDraftPathAddPoint>(onDraftPathAddPoint);

    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState<string | null>(null);
    const [basemapMode, setBasemapMode] = useState<DataReviewBasemapMode>("map");
    const [showVertices, setShowVertices] = useState(false);
    const [satelliteUnavailable, setSatelliteUnavailable] = useState(false);

    useEffect(() => {
        onPointChangeRef.current = onPointChange;
    }, [onPointChange]);

    useEffect(() => {
        onDraftPathAddPointRef.current = onDraftPathAddPoint;
    }, [onDraftPathAddPoint]);

    const stops = useMemo(() => routeStops ?? [], [routeStops]);

    const validStopCount = useMemo(
        () => stops.filter((s) => Number.isFinite(s.lng) && Number.isFinite(s.lat)).length,
        [stops],
    );
    /** A dashed stop-sequence preview line is drawn when there is no path but ≥2 ordered stops. */
    const hasStopPreviewLine = !isDrawable(routePath) && validStopCount >= 2;

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
        if (hasStopPreviewLine) {
            const ordered = stops
                .filter((s) => Number.isFinite(s.lng) && Number.isFinite(s.lat))
                .map((s) => [s.lng, s.lat] as Position);
            if (ordered.length >= 2) {
                return { type: "LineString", coordinates: ordered };
            }
        }
        return null;
    }, [routePath, geometry, hasStopPreviewLine, stops]);

    const hasLineGeometry = vertexLineGeometry !== null;
    const hasRenderable =
        isDrawable(routePath) ||
        isDrawable(geometry) ||
        stops.length > 0 ||
        linkedPoint !== null ||
        editablePoint !== null;

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
                        applyPreviewCompositeBasemapMode(loaded, "map", {
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
        setSatelliteUnavailable(basemapMode !== "map" && !applied);
    }, [mapReady, basemapMode]);

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

            if (target.kind === "empty") {
                map.flyTo({ center: PLACE_MAP_DEFAULT_CENTER, zoom: initialZoom, duration });
                return;
            }
            if (target.kind === "point") {
                map.flyTo({ center: target.center, zoom: pointZoom, duration });
                return;
            }
            map.fitBounds(target.bounds, { padding: 56, maxZoom: 17, duration });
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

            // Route path (solid) vs dashed stop preview.
            const pathDrawable = isDrawable(routePath);
            setSourceData(map, SRC_PATH, pathDrawable ? singleFeature(routePath!) : emptyFc());

            const { fc: stopsFc, ordered } = stopsToFeatures(stops);
            setSourceData(map, SRC_STOPS, stopsFc as FeatureCollection<Geometry>);

            if (!pathDrawable && ordered.length >= 2) {
                setSourceData(map, SRC_STOP_PREVIEW, {
                    type: "FeatureCollection",
                    features: [
                        {
                            type: "Feature",
                            properties: {},
                            geometry: { type: "LineString", coordinates: ordered },
                        },
                    ],
                });
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

            // Linked point.
            setSourceData(
                map,
                SRC_LINKED,
                linkedPoint
                    ? singleFeature({ type: "Point", coordinates: [linkedPoint.lng, linkedPoint.lat] })
                    : emptyFc(),
            );

            // Vertices are managed by their own effect (driven by `showVertices` +
            // `vertexLineGeometry`) so toggling never re-runs this data pass.

            for (const id of ORDERED_LAYER_IDS) {
                if (map.getLayer(id)) {
                    map.moveLayer(id);
                }
            }

            // One-time fit per autoFitKey.
            if (autoFitKey !== null && lastFitKeyRef.current !== autoFitKey && hasRenderable) {
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
        stops,
        linkedPoint,
        autoFitKey,
        hasRenderable,
        fitToContent,
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

            const show = showVertices && vertexLineGeometry !== null;
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
    }, [mapReady, showVertices, vertexLineGeometry]);

    // --- Editable marker (draggable + click-to-place). -----------------------
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) {
            return;
        }

        if (!editablePoint) {
            markerRef.current?.remove();
            markerRef.current = null;
            return;
        }

        if (!markerRef.current) {
            const marker = new maplibregl.Marker({ color: editablePointColor, draggable: pointDraggable })
                .setLngLat([editablePoint.lng, editablePoint.lat])
                .addTo(map);
            marker.on("dragend", () => {
                const ll = marker.getLngLat();
                onPointChangeRef.current?.({ lng: ll.lng, lat: ll.lat });
            });
            markerRef.current = marker;
        } else {
            markerRef.current.setLngLat([editablePoint.lng, editablePoint.lat]);
            markerRef.current.setDraggable(pointDraggable);
        }
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

    const handleFit = useCallback(() => {
        fitToContent(550);
    }, [fitToContent]);

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
                showVerticesToggle={hasLineGeometry}
                showVertices={showVertices}
                onShowVerticesChange={setShowVertices}
            />
            <div className="relative p-2">
                {clientMounted ? (
                    <div ref={containerRef} className={heightClassName} />
                ) : (
                    <div className={heightClassName} aria-hidden />
                )}

                {editingHint ? (
                    <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-md bg-white/95 px-3 py-2 text-xs text-blue-900 shadow ring-1 ring-blue-200">
                        {editingHint}
                    </div>
                ) : null}

                {satelliteUnavailable ? (
                    <div className="pointer-events-none absolute right-4 top-4 z-10 rounded-md bg-amber-50/95 px-3 py-2 text-xs text-amber-800 shadow ring-1 ring-amber-200">
                        Satellite imagery is unavailable. Showing the map basemap.
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
        </MapPreviewCard>
    );
}
