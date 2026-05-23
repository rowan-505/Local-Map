"use client";

import { useEffect, useState } from "react";

import CoreReviewMapPreview from "@/src/components/core-review/CoreReviewMapPreview";
import { CoreReviewDetailField } from "@/src/components/core-review/CoreReviewStateCard";
import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type { ImportReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";
import {
    getCoreReviewDetail,
    isAbortError,
    type CoreReviewEntitySlug,
    type ImportReviewGeoJson,
} from "@/src/lib/api";

import type { CoreReviewIdKind } from "../config/entity-config-types";

export type CoreReviewEntityDrawerViewProps = {
    apiSlug: CoreReviewEntitySlug;
    idKind: CoreReviewIdKind;
    rowId: string;
    geometryKind: DataReviewGeometryKind | "none";
    mapEntityType: ImportReviewEntityType;
    listGeometry: ImportReviewGeoJson | null;
    detailFields: { label: string; value: React.ReactNode }[];
    successMessage?: string | null;
};

export default function CoreReviewEntityDrawerView({
    apiSlug,
    idKind,
    rowId,
    geometryKind,
    mapEntityType,
    listGeometry,
    detailFields,
    successMessage,
}: CoreReviewEntityDrawerViewProps) {
    const [detailGeometry, setDetailGeometry] = useState<ImportReviewGeoJson | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState("");

    useEffect(() => {
        const c = new AbortController();
        let active = true;

        queueMicrotask(() => {
            if (!active) {
                return;
            }

            if (geometryKind === "none") {
                setDetailGeometry(null);
                setDetailLoading(false);
                return;
            }

            if (listGeometry) {
                setDetailGeometry(listGeometry);
                setDetailLoading(false);
                setDetailError("");
                return;
            }

            setDetailLoading(true);
            setDetailError("");

            void getCoreReviewDetail<Record<string, unknown>>(apiSlug, rowId, { signal: c.signal })
                .then((res) => {
                    if (!active) {
                        return;
                    }
                    const g = res.data.geometry;
                    setDetailGeometry(
                        g && typeof g === "object" && "type" in g ? (g as ImportReviewGeoJson) : null,
                    );
                })
                .catch((err) => {
                    if (!active || isAbortError(err)) {
                        return;
                    }
                    setDetailError(err instanceof Error ? err.message : "Failed to load detail");
                    setDetailGeometry(null);
                })
                .finally(() => {
                    if (active && !c.signal.aborted) {
                        setDetailLoading(false);
                    }
                });
        });

        return () => {
            active = false;
            c.abort();
        };
    }, [rowId, apiSlug, listGeometry, geometryKind]);

    const mapEnabled = geometryKind !== "none";

    return (
        <>
            {successMessage ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    {successMessage}
                </div>
            ) : null}

            {mapEnabled ? (
                <CoreReviewMapPreview
                    enabled
                    geometry={detailGeometry ?? listGeometry}
                    geometryKind={geometryKind}
                    entityType={mapEntityType}
                    externalId={idKind === "public_id" ? rowId : null}
                    title="Map preview"
                    loading={detailLoading}
                    error={detailError || null}
                    size="drawer"
                />
            ) : (
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">
                    No map geometry for this entity type.
                </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                {detailFields.map((f) => (
                    <CoreReviewDetailField key={f.label} label={f.label}>
                        {f.value}
                    </CoreReviewDetailField>
                ))}
            </div>
        </>
    );
}
