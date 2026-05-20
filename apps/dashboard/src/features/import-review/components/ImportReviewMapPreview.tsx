"use client";

import { useMemo } from "react";

import DataReviewCandidateMap from "@/src/components/map/DataReviewCandidateMap";
import type {
    DataReviewGeometryKind,
    ImportReviewEntityType,
} from "@/src/components/map/DataReviewCandidateMap";
import { useClientMounted } from "@/src/hooks/useClientMounted";
import type { ImportReviewGeoJson } from "@/src/lib/api";

import ImportReviewInlineSpinner from "./ImportReviewInlineSpinner";
import { IMPORT_REVIEW_LOADING } from "../utils/loadingMessages";
import {
    getImportReviewMapPreviewStatus,
    parseImportReviewMapGeometry,
    resolveEffectiveGeometryKind,
} from "../utils/mapPreviewUtils";

export type ImportReviewMapPreviewProps = {
    geometry: ImportReviewGeoJson | null | undefined;
    geometryKind: DataReviewGeometryKind;
    entityType: ImportReviewEntityType;
    externalId?: string | null;
    title?: string;
    subtitle?: string | null;
    fallbackNote?: string | null;
    /** When true, detail/geometry fetch is in progress — map is not mounted. */
    isLoadingDetail?: boolean;
    isLoadingGeometry?: boolean;
    /** Matched core overlay — reserved for dashed secondary geometry later. */
    matchedCoreGeometry?: ImportReviewGeoJson | null;
    size?: "default" | "drawer";
    className?: string;
    /** When false, MapLibre is not initialized (e.g. closed drawer). Default true. */
    enabled?: boolean;
};

function MapPreviewMessage({ message, tone }: { message: string; tone: "muted" | "warn" | "error" }) {
    const toneClass =
        tone === "error"
            ? "border-red-200 bg-red-50 text-red-900"
            : tone === "warn"
              ? "border-amber-200 bg-amber-50 text-amber-950"
              : "border-gray-200 bg-gray-50 text-gray-600";
    return (
        <div
            className={`rounded-lg border px-3 py-6 text-center text-xs ${toneClass}`}
            role="status"
        >
            {message}
        </div>
    );
}

/**
 * Reusable import-review map preview — wraps {@link DataReviewCandidateMap} with loading /
 * empty / invalid states. MapLibre initializes only when `enabled` and geometry is ready.
 */
export default function ImportReviewMapPreview({
    geometry,
    geometryKind,
    entityType,
    externalId = null,
    title = "Map preview",
    subtitle = null,
    fallbackNote = null,
    isLoadingDetail = false,
    isLoadingGeometry = false,
    matchedCoreGeometry: _matchedCoreGeometry,
    size = "drawer",
    className,
    enabled = true,
}: ImportReviewMapPreviewProps) {
    const clientMounted = useClientMounted();

    const parsedGeometry = useMemo(() => parseImportReviewMapGeometry(geometry), [geometry]);

    const effectiveKind = useMemo(
        () => resolveEffectiveGeometryKind(parsedGeometry, geometryKind),
        [parsedGeometry, geometryKind]
    );

    const status = useMemo(
        () =>
            getImportReviewMapPreviewStatus({
                enabled,
                isLoadingDetail,
                isLoadingGeometry,
                rawGeometry: geometry,
                parsedGeometry,
                effectiveKind,
                fallbackNote,
            }),
        [
            enabled,
            isLoadingDetail,
            isLoadingGeometry,
            geometry,
            parsedGeometry,
            effectiveKind,
            fallbackNote,
        ]
    );

    const mapGeometry = useMemo(
        () => (parsedGeometry ? (parsedGeometry as unknown as ImportReviewGeoJson) : geometry ?? null),
        [parsedGeometry, geometry]
    );

    const mapStableKey = useMemo(
        () =>
            JSON.stringify({
                id: externalId,
                kind: effectiveKind,
                type: parsedGeometry?.type ?? "none",
            }),
        [externalId, effectiveKind, parsedGeometry?.type]
    );

    if (status === "disabled") {
        return null;
    }

    if (status === "loading_geometry") {
        return (
            <div className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 ${className ?? ""}`}>
                <ImportReviewInlineSpinner
                    label={
                        isLoadingDetail
                            ? IMPORT_REVIEW_LOADING.loadingCandidateDetail
                            : IMPORT_REVIEW_LOADING.loadingGeometry
                    }
                    size="md"
                    className="justify-center w-full"
                />
            </div>
        );
    }

    if (status === "no_geometry") {
        return (
            <div className={className}>
                <MapPreviewMessage message={IMPORT_REVIEW_LOADING.noGeometryAvailable} tone="muted" />
            </div>
        );
    }

    if (status === "invalid_geometry") {
        return (
            <div className={className}>
                <MapPreviewMessage message={IMPORT_REVIEW_LOADING.invalidGeometry} tone="error" />
            </div>
        );
    }

    if (!parsedGeometry && fallbackNote?.trim()) {
        return (
            <div className={className}>
                <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                    {fallbackNote}
                </p>
            </div>
        );
    }

    return (
        <div className={className}>
            {fallbackNote?.trim() ? (
                <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                    {fallbackNote}
                </p>
            ) : null}
            {!clientMounted ? (
                <MapPreviewMessage message={IMPORT_REVIEW_LOADING.loadingMap} tone="muted" />
            ) : (
                <div className="relative">
                    <DataReviewCandidateMap
                        key={mapStableKey}
                        geometry={mapGeometry}
                        geometryKind={effectiveKind}
                        entityType={entityType}
                        externalId={externalId}
                        title={title}
                        subtitle={subtitle}
                        size={size}
                        className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
                    />
                </div>
            )}
        </div>
    );
}
