"use client";

import { useMemo } from "react";

import DataReviewCandidateMap from "@/src/components/map/DataReviewCandidateMap";
import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import { useClientMounted } from "@/src/hooks/useClientMounted";

import { IMPORT_TRANSPORT_LOADING } from "../utils/loadingMessages";
import ImportTransportInlineSpinner from "./ImportTransportInlineSpinner";

export type ImportTransportMapPreviewProps = {
    geometry: Record<string, unknown> | null;
    geometryKind: DataReviewGeometryKind;
    externalId?: string | null;
    title?: string;
    subtitle?: string | null;
    isLoading?: boolean;
    size?: "default" | "drawer";
    className?: string;
    enabled?: boolean;
};

export default function ImportTransportMapPreview({
    geometry,
    geometryKind,
    externalId = null,
    title = "Map preview",
    subtitle = null,
    isLoading = false,
    size = "default",
    className,
    enabled = true,
}: ImportTransportMapPreviewProps) {
    const clientMounted = useClientMounted();

    const mapStableKey = useMemo(
        () =>
            JSON.stringify({
                id: externalId,
                kind: geometryKind,
                type: geometry?.type ?? "none",
            }),
        [externalId, geometryKind, geometry?.type]
    );

    if (!enabled) {
        return null;
    }

    if (isLoading) {
        return (
            <div className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 ${className ?? ""}`}>
                <ImportTransportInlineSpinner
                    label={IMPORT_TRANSPORT_LOADING.loadingGeometry}
                    className="justify-center w-full"
                />
            </div>
        );
    }

    if (!geometry) {
        return (
            <div
                className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-600 ${className ?? ""}`}
                role="status"
            >
                {IMPORT_TRANSPORT_LOADING.noGeometryAvailable}
            </div>
        );
    }

    if (!clientMounted) {
        return (
            <div className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-600 ${className ?? ""}`}>
                {IMPORT_TRANSPORT_LOADING.loadingMap}
            </div>
        );
    }

    return (
        <div className={className}>
            <DataReviewCandidateMap
                key={mapStableKey}
                geometry={geometry as never}
                geometryKind={geometryKind}
                entityType="generic"
                externalId={externalId}
                title={title}
                subtitle={subtitle}
                size={size}
                className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
            />
        </div>
    );
}
