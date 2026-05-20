"use client";

import type { ImportReviewGeoJson } from "@/src/lib/api";
import type { ImportReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";
import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";

import ImportReviewMapPreview from "../ImportReviewMapPreview";

export default function CandidateMapSection({
    supportsMapPreview,
    isLoadingDetail,
    isLoadingGeometry,
    geometry,
    geometryKind,
    mapEntityType,
    externalId,
    fallbackNote,
}: {
    supportsMapPreview: boolean;
    isLoadingDetail: boolean;
    isLoadingGeometry: boolean;
    geometry: ImportReviewGeoJson | null;
    geometryKind: DataReviewGeometryKind;
    mapEntityType: ImportReviewEntityType;
    externalId: string | null;
    fallbackNote?: string | null;
}) {
    if (!supportsMapPreview) {
        return (
            <section className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-600">
                Map preview is not enabled for this entity type.
            </section>
        );
    }

    return (
        <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Map preview</h3>
            <ImportReviewMapPreview
                enabled
                geometry={geometry}
                geometryKind={geometryKind}
                entityType={mapEntityType}
                externalId={externalId}
                title="Location"
                fallbackNote={fallbackNote}
                isLoadingDetail={isLoadingDetail}
                isLoadingGeometry={isLoadingGeometry}
                size="drawer"
            />
        </section>
    );
}
