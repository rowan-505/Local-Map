"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import CoreReviewMapPreview from "@/src/components/core-review/CoreReviewMapPreview";
import { CoreReviewDetailField } from "@/src/components/core-review/CoreReviewStateCard";
import ReviewDetailDrawer from "@/src/components/review/ReviewDetailDrawer";
import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type { ImportReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";
import {
    getCoreReviewDetail,
    isAbortError,
    type CoreReviewEntitySlug,
    type ImportReviewGeoJson,
} from "@/src/lib/api";

import type { CoreReviewIdKind } from "../config/entity-config-types";

export default function CoreReviewEntityDetailDrawer<T extends Record<string, unknown>>({
    open,
    apiSlug,
    idKind,
    rowId,
    title,
    subtitle,
    geometryKind,
    mapEntityType,
    listGeometry,
    detailFields,
    editPath,
    drawerActions,
    onClose,
}: {
    open: boolean;
    apiSlug: CoreReviewEntitySlug;
    idKind: CoreReviewIdKind;
    rowId: string | null;
    title: string;
    subtitle?: string | null;
    geometryKind: DataReviewGeometryKind | "none";
    mapEntityType: ImportReviewEntityType;
    listGeometry: ImportReviewGeoJson | null;
    detailFields: { label: string; value: React.ReactNode }[];
    editPath?: string;
    drawerActions?: React.ReactNode;
    onClose: () => void;
}) {
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

            if (!open || !rowId) {
                setDetailGeometry(null);
                setDetailError("");
                setDetailLoading(false);
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
                        g && typeof g === "object" && "type" in g ? (g as ImportReviewGeoJson) : null
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
    }, [open, rowId, apiSlug, listGeometry, geometryKind]);

    if (!open || !rowId) {
        return null;
    }

    const mapEnabled = geometryKind !== "none";

    return (
        <ReviewDetailDrawer
            title={title}
            subtitle={subtitle}
            onClose={onClose}
            actions={
                <>
                    {editPath ? (
                        <Link
                            href={editPath}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                        >
                            Edit
                        </Link>
                    ) : null}
                    {drawerActions}
                </>
            }
        >
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
        </ReviewDetailDrawer>
    );
}
