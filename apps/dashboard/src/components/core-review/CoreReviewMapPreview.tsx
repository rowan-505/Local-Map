"use client";

import type { MutableRefObject } from "react";
import { useMemo } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";

import DataReviewCandidateMap, {
    type DataReviewGeometryKind,
    type ImportReviewEntityType,
} from "@/src/components/map/DataReviewCandidateMap";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import type { ImportReviewGeoJson } from "@/src/lib/api";
import { normalizeImportReviewGeoJson } from "@/src/lib/importReviewDrawerMapGeometry";

import { coreReviewFitButtonLabel } from "./coreReviewMapGeometry";

export type CoreReviewMapPreviewProps = {
    geometry: ImportReviewGeoJson | null | undefined;
    geometryKind: DataReviewGeometryKind;
    entityType: ImportReviewEntityType;
    externalId?: string | null;
    title?: string;
    emptyHint?: string;
    loading?: boolean;
    loadingLabel?: string;
    error?: string | null;
    size?: "default" | "drawer";
    className?: string;
    enabled?: boolean;
    mapSurfaceRef?: MutableRefObject<MaplibreMap | null>;
};

function PreviewMessage({
    message,
    tone,
}: {
    message: string;
    tone: "muted" | "error";
}) {
    const toneClass =
        tone === "error"
            ? "border-red-200 bg-red-50 text-red-800"
            : "border-slate-200 bg-slate-50 text-slate-600";
    return (
        <div
            className={`rounded-lg border px-3 py-8 text-center text-sm ${toneClass}`}
            role="status"
        >
            {message}
        </div>
    );
}

/**
 * Core review map preview — same MapLibre shell as import review ({@link DataReviewCandidateMap}):
 * basemap modes (map / satellite / hybrid), fit control, and optional vertex dots.
 */
export default function CoreReviewMapPreview({
    geometry,
    geometryKind,
    entityType,
    externalId = null,
    title = "Map preview",
    emptyHint = "No geometry available for this record.",
    loading = false,
    loadingLabel = "Loading map…",
    error = null,
    size = "drawer",
    className,
    enabled = true,
    mapSurfaceRef,
}: CoreReviewMapPreviewProps) {
    const clientMounted = useClientMounted();

    const parsed = useMemo(() => normalizeImportReviewGeoJson(geometry ?? null), [geometry]);

    const hasRenderable = useMemo(() => {
        if (!parsed) {
            return false;
        }
        if (geometryKind === "point") {
            return parsed.type === "Point" || parsed.type === "MultiPoint";
        }
        if (geometryKind === "polygon") {
            return parsed.type === "Polygon" || parsed.type === "MultiPolygon";
        }
        return parsed.type === "LineString" || parsed.type === "MultiLineString";
    }, [parsed, geometryKind]);

    const mapStableKey = useMemo(
        () =>
            JSON.stringify({
                id: externalId,
                kind: geometryKind,
                type: parsed?.type ?? "none",
            }),
        [externalId, geometryKind, parsed?.type],
    );

    const fitButtonLabel = coreReviewFitButtonLabel(geometryKind);

    if (!enabled) {
        return null;
    }

    if (loading) {
        return (
            <div
                className={`flex min-h-[220px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600 ${className ?? ""}`}
                aria-live="polite"
            >
                {loadingLabel}
            </div>
        );
    }

    if (error?.trim()) {
        return (
            <div className={className}>
                <PreviewMessage message={error.trim()} tone="error" />
            </div>
        );
    }

    if (!hasRenderable) {
        return (
            <div className={className}>
                <PreviewMessage message={emptyHint} tone="muted" />
            </div>
        );
    }

    if (!clientMounted) {
        return (
            <div
                className={`flex min-h-[220px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600 ${className ?? ""}`}
            >
                Loading map…
            </div>
        );
    }

    return (
        <DataReviewCandidateMap
            key={mapStableKey}
            geometry={geometry ?? null}
            geometryKind={geometryKind}
            entityType={entityType}
            externalId={externalId}
            title={title}
            size={size}
            fitButtonLabel={fitButtonLabel}
            mapSurfaceRef={mapSurfaceRef}
            className={
                className ??
                "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
            }
        />
    );
}
