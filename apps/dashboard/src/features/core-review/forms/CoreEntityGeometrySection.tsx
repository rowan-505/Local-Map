"use client";

import { useCallback, useState, type MutableRefObject } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { Geometry } from "geojson";
import { Controller, type Control } from "react-hook-form";

import { CoreGeometryEditor, type CoreGeometryValidationResult } from "@/src/components/core-review/geometry";
import { mapEditorBtnSuccess } from "@/src/components/map/mapPreviewUi";
import {
    ensureRoadClassSelected,
    prepareLocalStreetGeometryForSave,
} from "@/src/features/streets/streetSaveLocalChecks";
import { validateStreetGeometry, type ValidateStreetGeometryResponse } from "@/src/lib/api";
import type { CoreEntityGeometryConfig } from "@/src/lib/core-review/entityConfigs/types";
import { dashDevLog } from "@/src/lib/dashDevLog";

import type { StreetSplitMapProps } from "./StreetEditExtras";

export const SAVE_WITH_TOPOLOGY_WARNINGS_CONFIRM =
    "This street has topology warnings. Save anyway?";

function invalidGeometryValidation(message: string): ValidateStreetGeometryResponse {
    return {
        isValid: false,
        errors: [message],
        warnings: [],
        startConnection: null,
        endConnection: null,
        crossings: [],
        duplicates: [],
    };
}

export type CoreEntityGeometrySectionProps = {
    config: CoreEntityGeometryConfig;
    control: Control<Record<string, unknown>>;
    externalId?: string | null;
    selectedEntityName?: string | null;
    snapExcludePublicId?: string | null;
    disabled?: boolean;
    roadClassId?: string;
    onGeometryValidation?: (result: CoreGeometryValidationResult | null) => void;
    onApiValidation?: (result: ValidateStreetGeometryResponse | null) => void;
    streetSplitMapProps?: StreetSplitMapProps | null;
    mapSurfaceRef?: MutableRefObject<MaplibreMap | null>;
};

export default function CoreEntityGeometrySection({
    config,
    control,
    externalId,
    selectedEntityName,
    snapExcludePublicId,
    disabled,
    roadClassId,
    onGeometryValidation,
    onApiValidation,
    streetSplitMapProps,
    mapSurfaceRef,
}: CoreEntityGeometrySectionProps) {
    const [apiValidationBusy, setApiValidationBusy] = useState(false);

    const handleValidateGeometry = useCallback(
        async (geometry: Geometry | null) => {
            if (!config.validateWithApi || !geometry || geometry.type !== "LineString") {
                onApiValidation?.(null);
                return true;
            }

            const local = prepareLocalStreetGeometryForSave(
                geometry as { type: "LineString"; coordinates: number[][] },
            );
            if (!local.ok) {
                onApiValidation?.(invalidGeometryValidation(local.message));
                return false;
            }

            const roadClass = ensureRoadClassSelected(roadClassId);
            if (!roadClass) {
                onApiValidation?.(invalidGeometryValidation("Select a road class before validating geometry."));
                return false;
            }

            setApiValidationBusy(true);
            try {
                const result = await validateStreetGeometry({
                    geometry: local.sanitized,
                    ...(snapExcludePublicId ? { streetId: snapExcludePublicId } : {}),
                });
                onApiValidation?.(result);
                dashDevLog("street:form:validate-geometry", result);
                return result.isValid || result.warnings.length === 0;
            } catch (err) {
                onApiValidation?.(
                    invalidGeometryValidation(
                        err instanceof Error ? err.message : "Geometry validation failed",
                    ),
                );
                return false;
            } finally {
                setApiValidationBusy(false);
            }
        },
        [config.validateWithApi, onApiValidation, roadClassId, snapExcludePublicId],
    );

    return (
        <Controller
            name={config.fieldKey}
            control={control}
            render={({ field }) => (
                <div className="space-y-2">
                    <CoreGeometryEditor
                        geometryType={config.geometryType}
                        value={(field.value as Geometry | null) ?? null}
                        onChange={field.onChange}
                        readonly={disabled}
                        showVertices={config.showVertices}
                        enableSnapping={config.enableSnapping}
                        fitOnLoad
                        title={config.title}
                        externalId={externalId}
                        snapExcludePublicId={snapExcludePublicId}
                        selectedEntityPublicId={externalId}
                        selectedEntityName={selectedEntityName}
                        onValidationResult={onGeometryValidation}
                        splitPickActive={streetSplitMapProps?.splitPickActive}
                        onSplitPointClicked={streetSplitMapProps?.onSplitPointClicked}
                        splitPreviewLngLat={streetSplitMapProps?.splitPreviewLngLat}
                        mapSurfaceRef={mapSurfaceRef}
                    />
                    {config.validateWithApi ? (
                        <button
                            type="button"
                            disabled={disabled || apiValidationBusy}
                            onClick={() =>
                                void handleValidateGeometry((field.value as Geometry | null) ?? null)
                            }
                            className={`${mapEditorBtnSuccess()} disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                            {apiValidationBusy ? "Validating…" : "Validate geometry"}
                        </button>
                    ) : null}
                </div>
            )}
        />
    );
}
