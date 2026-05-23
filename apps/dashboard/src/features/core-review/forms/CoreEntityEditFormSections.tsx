"use client";

import { useMemo, type MutableRefObject } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { Control, FieldErrors, UseFormSetValue, UseFormWatch } from "react-hook-form";

import type { CoreGeometryValidationResult } from "@/src/components/core-review/geometry";
import BuildingLinkedPlacesPanel from "@/src/components/buildings/BuildingLinkedPlacesPanel";
import PlaceLinkedBuildingsPanel from "@/src/components/places/PlaceLinkedBuildingsPanel";
import type { PlaceDetail, Street, ValidateStreetGeometryResponse } from "@/src/lib/api";
import type {
    CoreEntityConfig,
    CoreEntityFieldDef,
    CoreEntityFormMode,
    CoreEntityFormValues,
    CoreEntityKey,
} from "@/src/lib/core-review/entityConfigs/types";

import type { CoreRefSourceKind } from "@/src/lib/core-review/entityConfigs/types";

import AdminAreaBoundaryFields from "../admin-areas/AdminAreaBoundaryFields";
import CoreEntityFieldRenderer from "./CoreEntityFieldRenderer";
import CoreEntityMapSections, { CoreEntityMapEntranceSection } from "./CoreEntityMapSections";
import CoreEntityNamesMetadata from "./CoreEntityNamesMetadata";
import CorePlaceCoordinatesField from "./CorePlaceCoordinatesField";
import CoreReadonlyMetadata from "./CoreReadonlyMetadata";
import StreetEditExtras, { type StreetSplitMapProps } from "./StreetEditExtras";
import { resolveStreetGeometryEditContext } from "./streetGeometryEditContext";
import type { CoreRefLoadState } from "./useCoreEntityRefs";

export type CoreEntityEditRefStates = Record<CoreRefSourceKind, CoreRefLoadState>;

export type CoreEntityEditFormSectionsProps = {
    entityKey: CoreEntityKey;
    mode: CoreEntityFormMode;
    config: CoreEntityConfig;
    recordId?: string | null;
    control: Control<CoreEntityFormValues>;
    watch: UseFormWatch<CoreEntityFormValues>;
    setValue: UseFormSetValue<CoreEntityFormValues>;
    errors: FieldErrors<CoreEntityFormValues>;
    refStates: CoreEntityEditRefStates;
    detail: unknown | null;
    disabled: boolean;
    isSaving: boolean;
    externalId: string | null;
    onGeometryValidation: (result: CoreGeometryValidationResult | null) => void;
    onApiValidation: (result: ValidateStreetGeometryResponse | null) => void;
    streetSplitMapProps?: StreetSplitMapProps | null;
    onStreetSplitMapPropsChange?: (props: StreetSplitMapProps) => void;
    placeHostMapRef?: MutableRefObject<MaplibreMap | null>;
    reloadDetail?: () => Promise<unknown | null>;
};

export function resolveCoreEntityExternalId(detail: unknown | null): string | null {
    if (!detail || typeof detail !== "object") {
        return null;
    }
    if ("public_id" in detail && detail.public_id) {
        return String(detail.public_id);
    }
    if ("publicId" in detail && detail.publicId) {
        return String(detail.publicId);
    }
    return null;
}

export function filterVisibleEditableFields(
    fields: CoreEntityFieldDef[],
    mode: CoreEntityFormMode,
): CoreEntityFieldDef[] {
    return fields.filter((field) => {
        if (field.createOnly && mode === "edit") {
            return false;
        }
        if (field.editOnly && mode === "create") {
            return false;
        }
        return true;
    });
}

export function useAdminLevelCode(
    adminLevelId: string | undefined,
    refStates: CoreEntityEditRefStates,
): string {
    return useMemo(() => {
        if (!adminLevelId) {
            return "";
        }
        const match = refStates["reference-options:admin_levels"]?.options.find(
            (option) => option.value === adminLevelId,
        );
        return match?.code?.trim().toLowerCase() ?? "";
    }, [adminLevelId, refStates]);
}

type EditDetailSlices = {
    placeDetail: PlaceDetail | null;
    streetDetail: Street | null;
    busStopNames: Array<{
        id?: string;
        name: string;
        language_code?: string | null;
        name_type?: string;
        is_primary?: boolean;
    }> | null;
};

export function resolveEditDetailSlices(entityKey: CoreEntityKey, detail: unknown | null): EditDetailSlices {
    if (!detail) {
        return { placeDetail: null, streetDetail: null, busStopNames: null };
    }

    const placeDetail = entityKey === "places" ? (detail as PlaceDetail) : null;
    const streetDetail = entityKey === "streets" ? (detail as Street) : null;
    const busStopNames =
        entityKey === "bus-stops" &&
        typeof detail === "object" &&
        detail !== null &&
        "names" in detail &&
        Array.isArray((detail as { names?: unknown }).names)
            ? (
                  detail as {
                      names: {
                          id?: string;
                          name: string;
                          languageCode?: string | null;
                          nameType?: string;
                          isPrimary?: boolean;
                      }[];
                  }
              ).names.map((n) => ({
                  id: n.id,
                  name: n.name,
                  language_code: n.languageCode,
                  name_type: n.nameType,
                  is_primary: n.isPrimary,
              }))
            : null;

    return { placeDetail, streetDetail, busStopNames };
}

/** Primary map editor — geometry, manual API validate button, and street-specific map props. */
export function CoreEntityEditMapSection({
    entityKey,
    config,
    control,
    watch,
    setValue,
    disabled,
    externalId,
    detail,
    recordId,
    onGeometryValidation,
    onApiValidation,
    streetSplitMapProps = null,
    placeHostMapRef,
}: Pick<
    CoreEntityEditFormSectionsProps,
    | "entityKey"
    | "config"
    | "control"
    | "watch"
    | "setValue"
    | "disabled"
    | "externalId"
    | "detail"
    | "recordId"
    | "onGeometryValidation"
    | "onApiValidation"
    | "streetSplitMapProps"
    | "placeHostMapRef"
>) {
    if (!config.geometry) {
        return null;
    }

    const streetContext = resolveStreetGeometryEditContext({
        entityKey,
        watch,
        externalId,
        recordId,
        detail,
        streetSplitMapProps,
    });

    return (
        <CoreEntityMapSections
            entityKey={entityKey}
            config={config}
            control={control}
            watch={watch}
            setValue={setValue}
            disabled={disabled}
            externalId={externalId}
            detail={detail}
            onGeometryValidation={onGeometryValidation}
            onApiValidation={onApiValidation}
            roadClassId={streetContext?.roadClassId}
            snapExcludePublicId={streetContext?.snapExcludePublicId ?? null}
            selectedEntityName={streetContext?.selectedStreetName ?? null}
            streetSplitMapProps={streetContext?.streetSplitMapProps ?? null}
            mapSurfaceRef={entityKey === "places" ? placeHostMapRef : undefined}
        />
    );
}

export function CoreEntityEditFieldsSection({
    entityKey,
    mode,
    config,
    recordId,
    control,
    watch,
    setValue,
    errors,
    refStates,
    disabled,
}: Pick<
    CoreEntityEditFormSectionsProps,
    | "entityKey"
    | "mode"
    | "config"
    | "recordId"
    | "control"
    | "watch"
    | "setValue"
    | "errors"
    | "refStates"
    | "disabled"
>) {
    const adminLevelId = watch("admin_level_id") as string | undefined;
    const boundaryStatus = watch("boundary_status") as string | undefined;
    const addressUsage = watch("address_usage") as string | undefined;
    const adminLevelCode = useAdminLevelCode(adminLevelId, refStates);

    const showPointCoordinates =
        config.geometry?.geometryType === "point" && entityKey !== "addresses";

    const visibleFields = filterVisibleEditableFields(config.editableFields, mode);

    return (
        <>
            {showPointCoordinates ? (
                <CorePlaceCoordinatesField
                    control={control}
                    fieldKey={config.geometry?.fieldKey ?? "point_geom"}
                />
            ) : null}
            {visibleFields.map((field) => (
                <CoreEntityFieldRenderer
                    key={field.key}
                    field={field}
                    mode={mode}
                    control={control}
                    errors={errors}
                    disabled={disabled}
                    refStates={refStates}
                />
            ))}
            {entityKey === "admin-areas" ? (
                <AdminAreaBoundaryFields
                    mode={mode}
                    adminLevelCode={adminLevelCode}
                    control={control}
                    errors={errors}
                    disabled={disabled}
                    resetKey={mode === "edit" ? (recordId ?? "edit") : "create"}
                    boundaryStatus={String(boundaryStatus ?? "")}
                    addressUsage={String(addressUsage ?? "")}
                    setValue={setValue}
                />
            ) : null}
        </>
    );
}

export function CoreEntityEditMetadataSection({
    entityKey,
    mode,
    config,
    detail,
}: Pick<CoreEntityEditFormSectionsProps, "entityKey" | "mode" | "config" | "detail">) {
    if (mode !== "edit") {
        return null;
    }

    const { placeDetail, streetDetail, busStopNames } = resolveEditDetailSlices(entityKey, detail);

    return (
        <>
            <CoreReadonlyMetadata
                detail={detail as Record<string, unknown> | null}
                fields={config.readonlyMetadata}
            />
            {placeDetail?.names?.length ? (
                <CoreEntityNamesMetadata names={placeDetail.names} />
            ) : null}
            {streetDetail?.names?.length ? (
                <CoreEntityNamesMetadata names={streetDetail.names} title="Street name records" />
            ) : null}
            {busStopNames?.length ? (
                <CoreEntityNamesMetadata names={busStopNames} title="Bus stop name records" />
            ) : null}
        </>
    );
}

export function CoreEntityEditExtrasSection({
    entityKey,
    mode,
    config,
    recordId,
    detail,
    isSaving,
    watch,
    onStreetSplitMapPropsChange,
    reloadDetail,
}: Pick<
    CoreEntityEditFormSectionsProps,
    | "entityKey"
    | "mode"
    | "config"
    | "recordId"
    | "detail"
    | "isSaving"
    | "watch"
    | "onStreetSplitMapPropsChange"
    | "reloadDetail"
>) {
    if (mode !== "edit") {
        return null;
    }

    const { streetDetail } = resolveEditDetailSlices(entityKey, detail);
    const editReason = watch("edit_reason") as string | undefined;

    const configExtras =
        config.renderEditExtras && detail
            ? config.renderEditExtras({
                  detail,
                  reload: async () => {
                      if (reloadDetail) {
                          await reloadDetail();
                      }
                  },
                  isSaving,
              })
            : null;

    return (
        <>
            {entityKey === "buildings" && detail && typeof detail === "object" && "public_id" in detail ? (
                <BuildingLinkedPlacesPanel buildingPublicId={String(detail.public_id)} />
            ) : null}
            {entityKey === "streets" && streetDetail && recordId && onStreetSplitMapPropsChange ? (
                <StreetEditExtras
                    street={streetDetail}
                    streetId={recordId}
                    isSaving={isSaving}
                    editReason={String(editReason ?? "")}
                    onSplitMapPropsChange={onStreetSplitMapPropsChange}
                    onReload={async () => {
                        if (reloadDetail) {
                            await reloadDetail();
                        }
                    }}
                />
            ) : null}
            {configExtras}
        </>
    );
}

export function CoreEntityEditBelowMapSection({
    entityKey,
    mode,
    config,
    control,
    externalId,
    detail,
    disabled,
    onGeometryValidation,
    placeHostMapRef,
}: Pick<
    CoreEntityEditFormSectionsProps,
    | "entityKey"
    | "mode"
    | "config"
    | "control"
    | "externalId"
    | "detail"
    | "disabled"
    | "onGeometryValidation"
    | "placeHostMapRef"
>) {
    const { placeDetail } = resolveEditDetailSlices(entityKey, detail);

    if (entityKey === "addresses" && config.secondaryGeometry && onGeometryValidation) {
        return (
            <CoreEntityMapEntranceSection
                entityKey={entityKey}
                config={config}
                control={control}
                externalId={externalId}
                disabled={disabled}
                onGeometryValidation={onGeometryValidation}
            />
        );
    }

    if (mode === "edit" && entityKey === "places" && placeDetail && placeHostMapRef) {
        return (
            <PlaceLinkedBuildingsPanel
                placePublicId={placeDetail.public_id}
                placeLat={placeDetail.lat}
                placeLng={placeDetail.lng}
                hostMapRef={placeHostMapRef}
            />
        );
    }

    return null;
}
