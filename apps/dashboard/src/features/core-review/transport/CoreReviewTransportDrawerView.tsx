"use client";

import { useEffect, useMemo, useState } from "react";

import CoreReviewMapPreview from "@/src/components/core-review/CoreReviewMapPreview";
import { CoreReviewDetailField } from "@/src/components/core-review/CoreReviewStateCard";
import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type { ImportReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";
import { getCoreReviewDetail, isAbortError, type CoreReviewEntitySlug, type ImportReviewGeoJson } from "@/src/lib/api";

import type { CoreReviewIdKind } from "../config/entity-config-types";
import {
    resolveTransportMapPreviewGeometry,
} from "./coreReviewTransportMapGeometry";
import type { CoreReviewTransportRouteStopRow } from "./coreReviewTransportShared";
import {
    JsonReadonlyBlock,
    RouteStopsDetailTable,
} from "./coreReviewTransportUi";

export type CoreReviewTransportDrawerViewProps = {
    apiSlug: CoreReviewEntitySlug;
    rowId: string;
    idKind: CoreReviewIdKind;
    geometryKind: DataReviewGeometryKind | "none";
    mapEntityType: ImportReviewEntityType;
    listGeometry: ImportReviewGeoJson | null;
    listFields: { label: string; value: React.ReactNode }[];
    successMessage?: string | null;
    showRouteStops?: boolean;
    /** Overlay core_transport.route_paths on the variant map preview when available. */
    showRoutePaths?: boolean;
};

export default function CoreReviewTransportDrawerView({
    apiSlug,
    rowId,
    idKind,
    geometryKind,
    mapEntityType,
    listGeometry,
    listFields,
    successMessage,
    showRouteStops = false,
    showRoutePaths = false,
}: CoreReviewTransportDrawerViewProps) {
    const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
    const [detailLoading, setDetailLoading] = useState(true);
    const [detailError, setDetailError] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        setDetailLoading(true);
        setDetailError("");

        void getCoreReviewDetail<Record<string, unknown>>(apiSlug, rowId, { signal: controller.signal })
            .then((res) => {
                if (active) {
                    setDetail(res.data);
                }
            })
            .catch((err) => {
                if (!active || isAbortError(err)) {
                    return;
                }
                setDetailError(err instanceof Error ? err.message : "Failed to load detail");
                setDetail(null);
            })
            .finally(() => {
                if (active && !controller.signal.aborted) {
                    setDetailLoading(false);
                }
            });

        return () => {
            active = false;
            controller.abort();
        };
    }, [apiSlug, rowId]);

    const previewGeometry = useMemo(
        () =>
            resolveTransportMapPreviewGeometry(geometryKind, listGeometry, detail, {
                includeRoutePaths: showRoutePaths,
            }),
        [detail, geometryKind, listGeometry, showRoutePaths],
    );

    const routeStops = useMemo(() => {
        const raw = detail?.routeStops;
        return Array.isArray(raw) ? (raw as CoreReviewTransportRouteStopRow[]) : [];
    }, [detail]);

    const mapEnabled = geometryKind !== "none";
    const mapTitle =
        showRoutePaths && previewGeometry.routePathCount > 0
            ? "Variant path & route paths"
            : geometryKind === "point"
              ? "Stop location"
              : "Variant path";
    const mapCaption =
        showRoutePaths && previewGeometry.routePathCount > 0
            ? `${previewGeometry.routePathCount} reference route path${
                  previewGeometry.routePathCount === 1 ? "" : "s"
              } from core_transport.route_paths included.`
            : null;

    return (
        <>
            {successMessage ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    {successMessage}
                </div>
            ) : null}

            {detailError ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    {detailError}
                </div>
            ) : null}

            {mapEnabled ? (
                <div className="space-y-2">
                    <CoreReviewMapPreview
                        enabled
                        geometry={previewGeometry.combined}
                        geometryKind={geometryKind}
                        entityType={mapEntityType}
                        externalId={idKind === "public_id" ? rowId : null}
                        title={mapTitle}
                        emptyHint={
                            geometryKind === "point"
                                ? "No stop location geometry available."
                                : "No variant line geometry available."
                        }
                        loading={detailLoading}
                        error={detailError || null}
                        size="drawer"
                    />
                    {mapCaption ? (
                        <p className="text-xs text-slate-600">{mapCaption}</p>
                    ) : null}
                </div>
            ) : (
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
                    No map geometry for this entity type.
                </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                {listFields.map((field) => (
                    <CoreReviewDetailField key={field.label} label={field.label}>
                        {field.value}
                    </CoreReviewDetailField>
                ))}
                <JsonReadonlyBlock label="Source refs" value={detail?.sourceRefs} />
                <JsonReadonlyBlock label="Normalized data" value={detail?.normalizedData} />
            </div>

            {showRouteStops ? (
                <div className="space-y-2">
                    <h3 className="text-sm font-medium text-slate-900">Route stops</h3>
                    <RouteStopsDetailTable stops={routeStops} />
                </div>
            ) : null}
        </>
    );
}
