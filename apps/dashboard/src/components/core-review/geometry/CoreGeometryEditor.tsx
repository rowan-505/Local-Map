"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Geometry } from "geojson";
import type { Map as MaplibreMap } from "maplibre-gl";

import BuildingEditorMap, {
    type BuildingEditorMapDrawOutput,
} from "@/src/components/buildings/BuildingEditorMap";
import { coreReviewFitButtonLabel } from "@/src/components/core-review/coreReviewMapGeometry";
import DataReviewCandidateMap, {
    type ImportReviewEntityType,
} from "@/src/components/map/DataReviewCandidateMap";
import DataReviewMapCard from "@/src/components/map/DataReviewMapCard";
import {
    fitMapToReviewCandidate,
    type DataReviewBasemapMode,
} from "@/src/components/map/dataReviewBasemap";
import PlacePointMapPicker from "@/src/components/map/PlacePointMapPicker";
import {
    MAP_EDITOR_TOOLBAR_CLASS,
    MAP_EDITOR_VIEWPORT_BUILDING_CLASS,
    MAP_EDITOR_VIEWPORT_CLASS,
    mapEditorBtnDanger,
} from "@/src/components/map/mapPreviewUi";
import StreetEditorMap from "@/src/components/streets/StreetEditorMap";
import type { StreetLineStringGeoJson, ImportReviewGeoJson } from "@/src/lib/api";

import {
    coreGeometryTypeToPreviewKind,
    defaultCoreGeometryEditorTitle,
    formatAreaSqM,
    formatLengthM,
    geometryToEditorJson,
    normalizeGeometryForEditor,
    pointGeometryToLatLng,
    validateGeometryForEditor,
    type CoreGeometryType,
    type CoreGeometryValidationResult,
} from "./coreGeometryUtils";

export type { CoreGeometryType, CoreGeometryValidationResult } from "./coreGeometryUtils";
export {
    getGeometryBounds,
    getGeometryType,
    normalizeGeometryForEditor,
    validateGeometryForEditor,
    validateLineGeometry,
    validatePointGeometry,
    validatePolygonGeometry,
} from "./coreGeometryUtils";

export type CoreGeometryEditorProps = {
    geometryType: CoreGeometryType;
    value: Geometry | null;
    onChange: (geometry: Geometry | null) => void;
    readonly?: boolean;
    showVertices?: boolean;
    enableSnapping?: boolean;
    fitOnLoad?: boolean;
    basemapMode?: DataReviewBasemapMode;
    onBasemapModeChange?: (mode: DataReviewBasemapMode) => void;
    onValidationResult?: (result: CoreGeometryValidationResult) => void;
    loading?: boolean;
    title?: string;
    externalId?: string | null;
    className?: string;
    /** Line snapping: exclude this street public id from nearest-point snap targets. */
    snapExcludePublicId?: string | null;
    /** Highlight label for the active line feature. */
    selectedEntityPublicId?: string | null;
    selectedEntityName?: string | null;
    mapSurfaceRef?: MutableRefObject<MaplibreMap | null>;
    /** Street split workflow (edit only). */
    splitPickActive?: boolean;
    onSplitPointClicked?: (lng: number, lat: number) => void;
    splitPreviewLngLat?: { lng: number; lat: number } | null;
};

function previewEntityType(geometryType: CoreGeometryType): ImportReviewEntityType {
    if (geometryType === "point") {
        return "place";
    }
    if (geometryType === "line") {
        return "road";
    }
    return "building";
}

function CoreGeometryValidationPanel({ result }: { result: CoreGeometryValidationResult }) {
    const hasIssues = result.errors.length > 0 || result.warnings.length > 0;

    if (!hasIssues && result.valid) {
        return (
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                <div className="font-semibold">Geometry is valid</div>
                <p className="mt-1 text-xs text-emerald-900/90">Ready to save when other fields are complete.</p>
            </div>
        );
    }

    if (!hasIssues) {
        return null;
    }

    return (
        <div className="space-y-2">
            {result.errors.length > 0 ? (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    <div className="font-semibold">Geometry errors</div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5">
                        {result.errors.map((message) => (
                            <li key={`err-${message}`}>{message}</li>
                        ))}
                    </ul>
                </div>
            ) : null}
            {result.warnings.length > 0 ? (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    <div className="font-semibold">Geometry warnings</div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5">
                        {result.warnings.map((message) => (
                            <li key={`warn-${message}`}>{message}</li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

function CoreGeometryStatsFooter({ result }: { result: CoreGeometryValidationResult }) {
    const { stats } = result;
    const areaLabel = formatAreaSqM(stats.areaSqM);
    const lengthLabel = formatLengthM(stats.lengthM);

    const items: string[] = [];

    if (stats.coordinates) {
        items.push(`Lat ${stats.coordinates.lat.toFixed(7)}, Lng ${stats.coordinates.lng.toFixed(7)}`);
    }
    if (stats.vertexCount > 0 && !stats.coordinates) {
        items.push(`${stats.vertexCount} vertex${stats.vertexCount === 1 ? "" : "es"}`);
    }
    if (lengthLabel) {
        items.push(`Length ${lengthLabel}`);
    }
    if (areaLabel) {
        items.push(`Area ${areaLabel}`);
    }

    if (items.length === 0) {
        return (
            <p className="text-xs text-slate-500">No geometry drawn yet — use the map tools below to add one.</p>
        );
    }

    return <p className="text-xs text-slate-600">{items.join(" · ")}</p>;
}

export default function CoreGeometryEditor({
    geometryType,
    value,
    onChange,
    readonly = false,
    showVertices = false,
    enableSnapping = true,
    fitOnLoad = true,
    basemapMode: basemapModeProp,
    onBasemapModeChange,
    onValidationResult,
    loading = false,
    title,
    externalId = null,
    className,
    snapExcludePublicId = null,
    selectedEntityPublicId = null,
    selectedEntityName = null,
    mapSurfaceRef,
    splitPickActive = false,
    onSplitPointClicked,
    splitPreviewLngLat = null,
}: CoreGeometryEditorProps) {
    const previewKind = coreGeometryTypeToPreviewKind(geometryType);
    const resolvedTitle = title ?? defaultCoreGeometryEditorTitle(geometryType);
    const fitLabel = coreReviewFitButtonLabel(previewKind);

    const [internalBasemapMode, setInternalBasemapMode] = useState<DataReviewBasemapMode>("map");
    const basemapMode = basemapModeProp ?? internalBasemapMode;
    const handleBasemapModeChange = onBasemapModeChange ?? setInternalBasemapMode;

    const internalMapRef = useRef<MaplibreMap | null>(null);

    const [polygonJson, setPolygonJson] = useState(() => geometryToEditorJson(value));
    const [lineSeed, setLineSeed] = useState<StreetLineStringGeoJson | null>(() => {
        const normalized = normalizeGeometryForEditor("line", value);
        return normalized?.type === "LineString" ? normalized : null;
    });
    const [mapEpoch, setMapEpoch] = useState(0);
    const [verticesVisible, setVerticesVisible] = useState(showVertices);
    const fitOnLoadDoneRef = useRef(false);

    useEffect(() => {
        setVerticesVisible(showVertices);
    }, [showVertices]);

    const validation = useMemo(
        () => validateGeometryForEditor(geometryType, value),
        [geometryType, value],
    );

    const hasRenderable = validation.valid || Boolean(value);

    useEffect(() => {
        onValidationResult?.(validation);
    }, [onValidationResult, validation]);

    useEffect(() => {
        if (geometryType === "polygon" || geometryType === "multiPolygon") {
            setPolygonJson(geometryToEditorJson(value));
        }
    }, [geometryType, value]);

    useEffect(() => {
        if (geometryType === "line") {
            const normalized = normalizeGeometryForEditor("line", value);
            setLineSeed(normalized?.type === "LineString" ? normalized : null);
        }
    }, [geometryType, value]);

    useEffect(() => {
        fitOnLoadDoneRef.current = false;
    }, [geometryType, value]);

    useEffect(() => {
        setMapEpoch(1);
    }, []);

    const handleFitGeometry = useCallback(() => {
        const map = internalMapRef.current;
        const normalized = normalizeGeometryForEditor(geometryType, value);
        if (!map || !normalized) {
            return;
        }
        fitMapToReviewCandidate(map, normalized, previewKind, { duration: 550 });
    }, [geometryType, previewKind, value]);

    useEffect(() => {
        if (!fitOnLoad || fitOnLoadDoneRef.current || !value) {
            return;
        }

        const map = internalMapRef.current;
        const normalized = normalizeGeometryForEditor(geometryType, value);
        if (!map || !normalized) {
            return;
        }

        const runFit = () => {
            if (fitOnLoadDoneRef.current) {
                return;
            }
            fitOnLoadDoneRef.current = true;
            fitMapToReviewCandidate(map, normalized, previewKind, { duration: 0 });
        };

        if (map.isStyleLoaded()) {
            requestAnimationFrame(runFit);
        } else {
            map.once("load", runFit);
        }
    }, [fitOnLoad, geometryType, previewKind, value]);

    const handleMapReady = useCallback(
        (map: MaplibreMap | null) => {
            internalMapRef.current = map;
            if (mapSurfaceRef) {
                mapSurfaceRef.current = map;
            }
        },
        [mapSurfaceRef],
    );

    const handleResetGeometry = useCallback(() => {
        onChange(null);
        if (geometryType === "line") {
            setLineSeed(null);
            setMapEpoch((epoch) => epoch + 1);
        }
        if (geometryType === "polygon" || geometryType === "multiPolygon") {
            setPolygonJson("");
        }
    }, [geometryType, onChange]);

    const handlePointChange = useCallback(
        (coords: { lat: number; lng: number }) => {
            onChange({
                type: "Point",
                coordinates: [coords.lng, coords.lat],
            });
        },
        [onChange],
    );

    const handleLineChange = useCallback(
        (line: StreetLineStringGeoJson | null) => {
            onChange(line);
        },
        [onChange],
    );

    const handlePolygonDrawOutput = useCallback(
        (output: BuildingEditorMapDrawOutput) => {
            setPolygonJson(output.geometryJson);
            if (!output.geometryJson.trim()) {
                onChange(null);
                return;
            }

            try {
                const parsed = JSON.parse(output.geometryJson) as Geometry;
                onChange(parsed);
            } catch {
                onChange(null);
            }
        },
        [onChange],
    );

    const pointCoords = pointGeometryToLatLng(value);

    if (loading) {
        return (
            <DataReviewMapCard
                className={className}
                header={{
                    title: resolvedTitle,
                    externalId,
                    hasRenderable: false,
                    onFit: () => undefined,
                    fitButtonLabel: fitLabel,
                    basemapMode,
                    onBasemapModeChange: handleBasemapModeChange,
                    palette: "core",
                }}
                footer={
                    <p className="text-sm text-slate-600" role="status">
                        Loading map…
                    </p>
                }
            >
                <div
                    className={
                        geometryType === "polygon" || geometryType === "multiPolygon"
                            ? MAP_EDITOR_VIEWPORT_BUILDING_CLASS
                            : MAP_EDITOR_VIEWPORT_CLASS
                    }
                    aria-hidden
                />
            </DataReviewMapCard>
        );
    }

    if (readonly) {
        return (
            <DataReviewCandidateMap
                geometry={value as ImportReviewGeoJson | null}
                geometryKind={previewKind}
                entityType={previewEntityType(geometryType)}
                externalId={externalId}
                title={resolvedTitle}
                className={className}
                fitButtonLabel={fitLabel}
                mapSurfaceRef={mapSurfaceRef ?? internalMapRef}
            />
        );
    }

    const showVertexToggle = geometryType === "polygon" || geometryType === "multiPolygon";

    return (
        <DataReviewMapCard
            className={className}
            header={{
                title: resolvedTitle,
                externalId,
                hasRenderable,
                onFit: handleFitGeometry,
                fitButtonLabel: fitLabel,
                basemapMode,
                onBasemapModeChange: handleBasemapModeChange,
                showVerticesToggle: showVertexToggle,
                showVertices: verticesVisible,
                onShowVerticesChange: setVerticesVisible,
                palette: "core",
            }}
            toolbar={
                <div className={MAP_EDITOR_TOOLBAR_CLASS}>
                    <button
                        type="button"
                        onClick={handleResetGeometry}
                        disabled={!value}
                        className={mapEditorBtnDanger(Boolean(value))}
                    >
                        Reset geometry
                    </button>
                </div>
            }
            footer={
                <div className="space-y-3 px-3 py-3">
                    <CoreGeometryStatsFooter result={validation} />
                    <CoreGeometryValidationPanel result={validation} />
                </div>
            }
            bodyClassName="p-0"
        >
            {geometryType === "point" ? (
                <PlacePointMapPicker
                    lat={pointCoords?.lat ?? null}
                    lng={pointCoords?.lng ?? null}
                    onChange={handlePointChange}
                    basemapMode={basemapMode}
                    onMapReady={handleMapReady}
                    mapSurfaceRef={mapSurfaceRef ?? internalMapRef}
                    viewportClassName={MAP_EDITOR_VIEWPORT_CLASS}
                />
            ) : null}

            {geometryType === "line" ? (
                <StreetEditorMap
                    mapEpoch={mapEpoch}
                    seedLine={lineSeed}
                    onLineStringChange={handleLineChange}
                    snapExcludeStreetPublicId={snapExcludePublicId}
                    selectedStreetPublicId={selectedEntityPublicId}
                    selectedStreetName={selectedEntityName}
                    dataReviewBasemapMode={basemapMode}
                    onMapInstance={handleMapReady}
                    mapViewportClassName={MAP_EDITOR_VIEWPORT_CLASS}
                    defaultSnapToRoad={enableSnapping}
                    hideSnapControl={!enableSnapping}
                    splitPickActive={splitPickActive}
                    onSplitPointClicked={onSplitPointClicked}
                    splitPreviewLngLat={splitPreviewLngLat}
                />
            ) : null}

            {geometryType === "polygon" || geometryType === "multiPolygon" ? (
                <BuildingEditorMap
                    geometryJson={polygonJson}
                    onDrawOutput={handlePolygonDrawOutput}
                    basemapMode={basemapMode}
                    showVertexPreview={verticesVisible}
                    editorMapSurfaceRef={mapSurfaceRef ?? internalMapRef}
                    className=""
                />
            ) : null}
        </DataReviewMapCard>
    );
}
