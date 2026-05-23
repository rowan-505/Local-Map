"use client";

import { useEffect, useState } from "react";

import CoreReviewMapPreview from "@/src/components/core-review/CoreReviewMapPreview";
import { CoreReviewDetailField } from "@/src/components/core-review/CoreReviewStateCard";
import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type { ImportReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";
import { getCoreReviewDetail, isAbortError, type ImportReviewGeoJson } from "@/src/lib/api";
import { VerifiedBadge } from "@/src/components/review/ReviewStatusBadge";

import type { CoreReviewAddressDetail, CoreReviewAddressRow } from "../config/types";
import { dash } from "../utils/formatters";

function yesNo(value: boolean): string {
    return value ? "Yes" : "No";
}

function groupComponentsForTable(
    components: CoreReviewAddressDetail["components"],
): Array<{ typeCode: string; en: string | null; my: string | null; und: string | null }> {
    const byType = new Map<string, { en: string | null; my: string | null; und: string | null }>();
    for (const c of components ?? []) {
        const entry = byType.get(c.componentTypeCode) ?? { en: null, my: null, und: null };
        if (c.languageCode === "en") {
            entry.en = c.componentValue;
        } else if (c.languageCode === "my") {
            entry.my = c.componentValue;
        } else {
            entry.und = c.componentValue;
        }
        byType.set(c.componentTypeCode, entry);
    }
    return [...byType.entries()]
        .map(([typeCode, vals]) => ({ typeCode, ...vals }))
        .sort((a, b) => a.typeCode.localeCompare(b.typeCode));
}

export type CoreReviewAddressDrawerViewProps = {
    rowId: string;
    listRow: CoreReviewAddressRow;
    listGeometry: ImportReviewGeoJson | null;
    listRowUpdatedAt: string | null;
    geometryKind: DataReviewGeometryKind | "none";
    mapEntityType: ImportReviewEntityType;
    successMessage?: string | null;
};

export default function CoreReviewAddressDrawerView(props: CoreReviewAddressDrawerViewProps) {
    return (
        <AddressDrawerViewContent
            key={`${props.rowId}:${props.listRowUpdatedAt ?? ""}`}
            {...props}
        />
    );
}

function AddressDrawerViewContent({
    rowId,
    listRow,
    listGeometry,
    geometryKind,
    mapEntityType,
    successMessage,
}: CoreReviewAddressDrawerViewProps) {
    const [detail, setDetail] = useState<CoreReviewAddressDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        let active = true;

        void getCoreReviewDetail<CoreReviewAddressDetail>("addresses", rowId, {
            signal: controller.signal,
        })
            .then((res) => {
                if (active) {
                    setDetail(res.data);
                }
            })
            .catch((err) => {
                if (!active || isAbortError(err)) {
                    return;
                }
                setError(err instanceof Error ? err.message : "Failed to load address detail");
                setDetail(null);
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
            controller.abort();
        };
    }, [rowId]);

    const pointGeom =
        (detail?.geometry as ImportReviewGeoJson | null | undefined) ?? listGeometry;
    const entranceGeom = detail?.entranceGeometry as ImportReviewGeoJson | null | undefined;
    const mapEnabled = geometryKind !== "none";
    const mapGeometryKind: DataReviewGeometryKind =
        geometryKind === "none" ? "point" : geometryKind;

    const displayDetail = detail ?? listRow;

    return (
        <>
            {successMessage ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    {successMessage}
                </div>
            ) : null}

            {loading ? <p className="text-sm text-slate-600">Loading address detail…</p> : null}
            {error ? <p className="text-sm text-red-700">{error}</p> : null}

            <div className="space-y-4">
                {mapEnabled ? (
                    <CoreReviewMapPreview
                        enabled
                        geometry={pointGeom}
                        geometryKind={mapGeometryKind}
                        entityType={mapEntityType}
                        externalId={rowId}
                        title="Point"
                        loading={loading}
                        error={error || null}
                        size="drawer"
                    />
                ) : null}
                {entranceGeom ? (
                    <CoreReviewMapPreview
                        enabled
                        geometry={entranceGeom}
                        geometryKind="point"
                        entityType={mapEntityType}
                        title="Entrance"
                        size="drawer"
                    />
                ) : null}

                <section className="space-y-2 rounded-xl border border-slate-200 p-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Generated full address (readonly)
                    </h3>
                    <p className="text-xs text-slate-500">
                        Composed from production address components in the API.
                    </p>
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                            <span className="text-slate-500">English</span>
                            <p className="text-slate-900">
                                {dash(displayDetail.generatedFullAddressEn)}
                            </p>
                        </div>
                        <div>
                            <span className="text-slate-500">Myanmar</span>
                            <p className="text-slate-900">
                                {dash(displayDetail.generatedFullAddressMy)}
                            </p>
                        </div>
                    </div>
                    {detail?.cachedFullAddress &&
                    detail.cachedFullAddress !== detail.displayFullAddress ? (
                        <p className="text-xs text-amber-800">
                            Cached DB value differs from composed display — save components to refresh.
                        </p>
                    ) : null}
                </section>

                <div className="grid gap-4 sm:grid-cols-2">
                    <CoreReviewDetailField label="Public ID">{displayDetail.publicId}</CoreReviewDetailField>
                    <CoreReviewDetailField label="House #">
                        {dash(displayDetail.houseNumber)}
                    </CoreReviewDetailField>
                    <CoreReviewDetailField label="Admin area">
                        {dash(displayDetail.adminAreaName)}
                    </CoreReviewDetailField>
                    <CoreReviewDetailField label="Street">
                        {dash(displayDetail.streetNameEn ?? displayDetail.streetNameMy)}
                    </CoreReviewDetailField>
                    <CoreReviewDetailField label="Public">
                        {yesNo(displayDetail.isPublic)}
                    </CoreReviewDetailField>
                    <CoreReviewDetailField label="Verified">
                        <VerifiedBadge verified={displayDetail.isVerified} />
                    </CoreReviewDetailField>
                    <CoreReviewDetailField label="Updated">
                        {dash(displayDetail.updatedAt)}
                    </CoreReviewDetailField>
                </div>

                {detail?.components && detail.components.length > 0 ? (
                    <section className="space-y-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Production components
                        </h3>
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="min-w-full text-left text-xs">
                                <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                        <th className="px-2 py-2">Type</th>
                                        <th className="px-2 py-2">EN</th>
                                        <th className="px-2 py-2">MY</th>
                                        <th className="px-2 py-2">UND</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {groupComponentsForTable(detail.components).map((row) => (
                                        <tr key={row.typeCode}>
                                            <td className="px-2 py-2 font-mono">{row.typeCode}</td>
                                            <td className="px-2 py-2">{dash(row.en)}</td>
                                            <td className="px-2 py-2">{dash(row.my)}</td>
                                            <td className="px-2 py-2">{dash(row.und)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                ) : null}
            </div>
        </>
    );
}
