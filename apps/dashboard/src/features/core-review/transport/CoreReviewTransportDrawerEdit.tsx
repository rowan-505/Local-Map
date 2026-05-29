"use client";

import CoreReviewMapPreview from "@/src/components/core-review/CoreReviewMapPreview";

import CoreEntityDrawerEditForm from "../drawer/CoreEntityDrawerEditForm";
import type { useCoreEntityEditForm } from "../drawer/useCoreEntityEditForm";
import {
    combineLineGeometriesForPreview,
    extractRoutePathGeometries,
} from "./coreReviewTransportMapGeometry";

export type CoreReviewTransportDrawerEditProps = {
    editForm: ReturnType<typeof useCoreEntityEditForm>;
    recordId: string;
    /** Show read-only core_transport.route_paths below the editable form. */
    showRoutePaths?: boolean;
};

export default function CoreReviewTransportDrawerEdit({
    editForm,
    recordId,
    showRoutePaths = false,
}: CoreReviewTransportDrawerEditProps) {
    const routePathGeometries = showRoutePaths
        ? extractRoutePathGeometries(
              editForm.detail && typeof editForm.detail === "object"
                  ? (editForm.detail as Record<string, unknown>).routePaths
                  : null,
          )
        : [];
    const routePathsPreview = combineLineGeometriesForPreview(null, routePathGeometries);

    return (
        <div className="space-y-4">
            <CoreEntityDrawerEditForm form={editForm} recordId={recordId} />

            {showRoutePaths && routePathGeometries.length > 0 && routePathsPreview ? (
                <div className="space-y-2">
                    <p className="text-sm text-slate-600">
                        Reference route paths from core_transport.route_paths (read-only). Edit the
                        variant path in the map editor above.
                    </p>
                    <CoreReviewMapPreview
                        enabled
                        geometry={routePathsPreview}
                        geometryKind="line"
                        entityType="road"
                        title="Reference route paths"
                        size="drawer"
                    />
                </div>
            ) : null}
        </div>
    );
}
