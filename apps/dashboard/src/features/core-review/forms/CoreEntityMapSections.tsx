"use client";

import type { MutableRefObject } from "react";
import type { Geometry } from "geojson";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { Control, UseFormSetValue, UseFormWatch } from "react-hook-form";

import type { CoreGeometryValidationResult } from "@/src/components/core-review/geometry";
import CoreAddressFormExtras from "@/src/features/addresses/CoreAddressFormExtras";
import type { ValidateStreetGeometryResponse } from "@/src/lib/api";
import {
    getCoreEntityConfig,
    type CoreEntityFormValues,
    type CoreEntityKey,
} from "@/src/lib/core-review/entityConfigs";
import type { CoreEntityConfig } from "@/src/lib/core-review/entityConfigs/types";

import type { CoreReviewAddressDetail } from "../config/types";
import CoreEntityGeometrySection from "./CoreEntityGeometrySection";
import type { StreetSplitMapProps } from "./StreetEditExtras";

export type CoreEntityMapSectionsProps = {
    entityKey: CoreEntityKey;
    /** When omitted, resolved via {@link getCoreEntityConfig}. */
    config?: CoreEntityConfig;
    control: Control<CoreEntityFormValues>;
    watch: UseFormWatch<CoreEntityFormValues>;
    setValue: UseFormSetValue<CoreEntityFormValues>;
    disabled: boolean;
    externalId: string | null;
    detail: unknown | null;
    onGeometryValidation: (result: CoreGeometryValidationResult | null) => void;
    onApiValidation: (result: ValidateStreetGeometryResponse | null) => void;
    roadClassId?: string;
    snapExcludePublicId?: string | null;
    selectedEntityName?: string | null;
    streetSplitMapProps?: StreetSplitMapProps | null;
    mapSurfaceRef?: MutableRefObject<MaplibreMap | null>;
};

function resolveEntityConfig(entityKey: CoreEntityKey, config?: CoreEntityConfig): CoreEntityConfig {
    return config ?? getCoreEntityConfig(entityKey);
}

function resolveSelectedStreetName(entityKey: CoreEntityKey, detail: unknown | null): string | null {
    if (entityKey !== "streets" || !detail || typeof detail !== "object") {
        return null;
    }
    if ("canonical_name" in detail && detail.canonical_name) {
        return String(detail.canonical_name);
    }
    return null;
}

function resolveAddressDetail(entityKey: CoreEntityKey, detail: unknown | null): CoreReviewAddressDetail | null {
    if (entityKey !== "addresses" || !detail) {
        return null;
    }
    return detail as CoreReviewAddressDetail;
}

/** Primary map section — geometry editor or address location extras. Updates form state only. */
export default function CoreEntityMapSections({
    entityKey,
    config: configProp,
    control,
    watch,
    setValue,
    disabled,
    externalId,
    detail,
    onGeometryValidation,
    onApiValidation,
    roadClassId,
    snapExcludePublicId: snapExcludePublicIdProp,
    selectedEntityName: selectedEntityNameProp,
    streetSplitMapProps = null,
    mapSurfaceRef,
}: CoreEntityMapSectionsProps) {
    const config = resolveEntityConfig(entityKey, configProp);

    if (entityKey === "addresses" && config.geometry) {
        const pointGeom = watch("point_geom") as Geometry | null | undefined;
        const addressDetail = resolveAddressDetail(entityKey, detail);

        return (
            <CoreAddressFormExtras
                control={control}
                pointGeom={pointGeom ?? null}
                setValue={setValue}
                disabled={disabled}
                initialComponents={addressDetail?.components}
            />
        );
    }

    if (!config.geometry) {
        return null;
    }

    const selectedStreetName =
        selectedEntityNameProp ?? resolveSelectedStreetName(entityKey, detail);
    const snapExcludePublicId =
        snapExcludePublicIdProp ??
        (entityKey === "streets" ? externalId : null);

    return (
        <div className="space-y-4">
            <CoreEntityGeometrySection
                config={config.geometry}
                control={control}
                externalId={externalId}
                selectedEntityName={selectedStreetName}
                snapExcludePublicId={snapExcludePublicId}
                disabled={disabled}
                roadClassId={roadClassId}
                onGeometryValidation={onGeometryValidation}
                onApiValidation={onApiValidation}
                streetSplitMapProps={entityKey === "streets" ? streetSplitMapProps : null}
                mapSurfaceRef={entityKey === "places" ? mapSurfaceRef : undefined}
            />
            {config.secondaryGeometry && entityKey !== "addresses" ? (
                <CoreEntityGeometrySection
                    config={config.secondaryGeometry}
                    control={control}
                    externalId={externalId}
                    disabled={disabled}
                    onGeometryValidation={onGeometryValidation}
                />
            ) : null}
        </div>
    );
}

/** Address entrance geometry — rendered below the primary map in the form shell left column. */
export function CoreEntityMapEntranceSection({
    entityKey,
    config: configProp,
    control,
    externalId,
    disabled,
    onGeometryValidation,
}: Pick<
    CoreEntityMapSectionsProps,
    "entityKey" | "config" | "control" | "externalId" | "disabled" | "onGeometryValidation"
>) {
    const config = resolveEntityConfig(entityKey, configProp);

    if (entityKey !== "addresses" || !config.secondaryGeometry) {
        return null;
    }

    return (
        <CoreEntityGeometrySection
            config={config.secondaryGeometry}
            control={control}
            externalId={externalId}
            disabled={disabled}
            onGeometryValidation={onGeometryValidation}
        />
    );
}
