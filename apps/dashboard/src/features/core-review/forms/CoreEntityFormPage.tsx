"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import type { Map as MaplibreMap } from "maplibre-gl";

import BuildingLinkedPlacesPanel from "@/src/components/buildings/BuildingLinkedPlacesPanel";
import PlaceLinkedBuildingsPanel from "@/src/components/places/PlaceLinkedBuildingsPanel";
import type { CoreGeometryValidationResult } from "@/src/components/core-review/geometry";
import { CoreReviewErrorCard, CoreReviewLoadingCard } from "@/src/components/core-review/CoreReviewStateCard";
import { useBuildingTileVersion, useDashboardTileVersions } from "@/src/components/map/BuildingTileVersionContext";
import { DASHBOARD_STREET_MVT_SESSION_BUST_KEY, scheduleBuildingTileRefresh } from "@/src/components/map/placeMapConfig";
import {
    ensureRoadClassSelected,
    prepareLocalStreetGeometryForSave,
} from "@/src/features/streets/streetSaveLocalChecks";
import {
    getPlaceFormOptions,
    validateStreetGeometry,
    type PlaceDetail,
    type Street,
    type ValidateStreetGeometryResponse,
} from "@/src/lib/api";
import {
    getCoreEntityConfig,
    type CoreEntityFormMode,
    type CoreEntityFormValues,
    type CoreEntityKey,
} from "@/src/lib/core-review/entityConfigs";
import { getFormGeometry } from "@/src/lib/core-review/geometryFieldUtils";
import { dashDevLog } from "@/src/lib/dashDevLog";

import CoreEntityFieldRenderer from "./CoreEntityFieldRenderer";
import CoreEntityFormShell from "./CoreEntityFormShell";
import CoreEntityGeometrySection, {
    SAVE_WITH_TOPOLOGY_WARNINGS_CONFIRM,
} from "./CoreEntityGeometrySection";
import CoreEntityNamesMetadata from "./CoreEntityNamesMetadata";
import CoreEntityValidationPanel from "./CoreEntityValidationPanel";
import CoreEntityWriteApiBanner from "./CoreEntityWriteApiBanner";
import CoreFormActions from "./CoreFormActions";
import CorePlaceCoordinatesField from "./CorePlaceCoordinatesField";
import CoreReadonlyMetadata from "./CoreReadonlyMetadata";
import CoreReviewEntityFormLifecycleActions from "../lifecycle/CoreReviewEntityFormLifecycleActions";
import { isCoreReviewRowDeleted } from "../lifecycle/coreReviewLifecycleUtils";
import StreetEditExtras, { type StreetSplitMapProps } from "./StreetEditExtras";
import { collectRefSources, useCoreEntityRefs } from "./useCoreEntityRefs";

// TODO: Add beforeunload / router guard when a shared unsaved-changes pattern exists in the dashboard.

export type CoreEntityFormPageProps = {
    entityKey: CoreEntityKey;
    mode: CoreEntityFormMode;
    id?: string;
};

function sanitizeSaveError(err: unknown): string {
    const raw = err instanceof Error ? err.message : "Request failed";
    const looksTechnical =
        raw.length > 400 ||
        /\b(pg_|postgresql|prisma|P1012|syntax error at|violates(?: foreign key)?|duplicate key value|permission denied for relation|syntax error\b)/i.test(
            raw,
        );
    return looksTechnical ? "Saving failed. Please try again." : raw;
}

export default function CoreEntityFormPage({ entityKey, mode, id }: CoreEntityFormPageProps) {
    const config = getCoreEntityConfig(entityKey);
    const router = useRouter();
    const { bumpPlaceTileVersion, bumpStreetTileVersion, bumpRoadLabelTileVersion } = useDashboardTileVersions();
    const { bumpBuildingTileVersion } = useBuildingTileVersion();

    const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
    const [isLoading, setIsLoading] = useState(mode === "edit");
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [geometryValidation, setGeometryValidation] = useState<CoreGeometryValidationResult | null>(null);
    const [apiGeometryValidation, setApiGeometryValidation] = useState<ValidateStreetGeometryResponse | null>(
        null,
    );
    const [streetSplitMapProps, setStreetSplitMapProps] = useState<StreetSplitMapProps | null>(null);
    const placeHostMapRef = useRef<MaplibreMap | null>(null);

    const geometryFieldKey = config.geometry?.fieldKey ?? "geom";

    const refSources = useMemo(
        () => collectRefSources(config.editableFields),
        [config.editableFields],
    );
    const refStates = useCoreEntityRefs(refSources);

    const schema = useMemo(() => config.formSchema(mode), [config, mode]);

    const {
        control,
        handleSubmit,
        reset,
        watch,
        setValue,
        formState: { errors },
    } = useForm<CoreEntityFormValues>({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- entity schemas vary by config; RHF resolver typing is unified at runtime.
        resolver: zodResolver(schema as any) as Resolver<CoreEntityFormValues>,
        defaultValues: config.defaultFormValues,
    });

    const roadClassId = watch("road_class_id") as string | undefined;
    const editReason = watch("edit_reason") as string | undefined;
    const isRecordDeleted =
        mode === "edit" && detail ? isCoreReviewRowDeleted(detail) : false;

    const handleStreetSplitMapPropsChange = useCallback((props: StreetSplitMapProps) => {
        setStreetSplitMapProps(props);
    }, []);

    const reloadDetail = useCallback(async () => {
        if (mode !== "edit" || !id) {
            return;
        }
        setIsLoading(true);
        setLoadError("");
        try {
            const data = await config.fetchDetail(id);
            setDetail(data as Record<string, unknown>);
            reset(config.detailToFormValues(data));
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : `Failed to load ${config.label.toLowerCase()}`);
            setDetail(null);
        } finally {
            setIsLoading(false);
        }
    }, [config, id, mode, reset]);

    useEffect(() => {
        if (mode === "edit" && id) {
            void reloadDetail();
        }
    }, [mode, id, reloadDetail]);

    useEffect(() => {
        if (mode !== "create" || entityKey !== "places") {
            return;
        }

        let mounted = true;
        void getPlaceFormOptions().then((options) => {
            if (!mounted) {
                return;
            }
            const manual = options.source_types.find((s) => s.code === "manual");
            const published = options.publish_statuses.find((s) => s.code === "published");
            if (manual?.id) {
                setValue("sourceTypeId", manual.id);
            }
            if (published?.id) {
                setValue("publishStatusId", published.id);
            }
        });
        return () => {
            mounted = false;
        };
    }, [entityKey, mode, setValue]);

    const onSubmit = handleSubmit(async (values) => {
        if (!config.writeApiAvailable) {
            return;
        }

        setSaveError(null);
        setSaveSuccess(null);
        setIsSaving(true);

        try {
            if (entityKey === "streets") {
                const geom = getFormGeometry(values, geometryFieldKey);
                const prep = prepareLocalStreetGeometryForSave(
                    geom && typeof geom === "object" && "type" in geom && geom.type === "LineString"
                        ? (geom as { type: "LineString"; coordinates: number[][] })
                        : null,
                );
                if (!prep.ok) {
                    setSaveError(prep.message);
                    setIsSaving(false);
                    return;
                }

                const roadClass = ensureRoadClassSelected(String(values.road_class_id ?? ""));
                if (!roadClass) {
                    setSaveError("Select a road class before saving.");
                    setIsSaving(false);
                    return;
                }

                const check = await validateStreetGeometry({
                    geometry: prep.sanitized,
                    ...(mode === "edit" && id ? { streetId: id } : {}),
                });
                setApiGeometryValidation(check);

                if (!check.isValid) {
                    setIsSaving(false);
                    return;
                }

                if (check.warnings.length > 0) {
                    if (!window.confirm(SAVE_WITH_TOPOLOGY_WARNINGS_CONFIRM)) {
                        setIsSaving(false);
                        return;
                    }
                }

                values = { ...values, [geometryFieldKey]: prep.sanitized };
            }

            if (mode === "create") {
                const payload = config.formValuesToCreatePayload(values);
                dashDevLog(`${entityKey}:create:save-payload`, payload);
                const created = await config.createEntity(payload);
                config.onAfterCreate?.(created);

                if (entityKey === "buildings") {
                    const tileVersion = bumpBuildingTileVersion();
                    scheduleBuildingTileRefresh(null, tileVersion);
                    window.setTimeout(() => {
                        router.push(config.editRoute(config.getDetailId(created)));
                    }, 0);
                    return;
                }

                if (entityKey === "places") {
                    bumpPlaceTileVersion();
                    try {
                        sessionStorage.setItem(
                            "placeCreateSuccess",
                            `Place "${config.getDetailId(created)}" created successfully.`,
                        );
                    } catch {
                        /* ignore */
                    }
                    router.push(config.listRoute);
                    return;
                }

                if (entityKey === "streets") {
                    const streetTileVersion = bumpStreetTileVersion();
                    bumpRoadLabelTileVersion();
                    try {
                        sessionStorage.setItem(DASHBOARD_STREET_MVT_SESSION_BUST_KEY, String(streetTileVersion));
                    } catch {
                        /* ignore */
                    }
                    window.setTimeout(() => {
                        router.push(config.editRoute(config.getDetailId(created)));
                    }, 0);
                    return;
                }

                router.push(config.editRoute(config.getDetailId(created)));
                setSaveSuccess(`${config.label} created successfully.`);
                return;
            } else if (id) {
                const payload = config.formValuesToUpdatePayload(values);
                dashDevLog(`${entityKey}:edit:save-payload`, payload);
                await config.updateEntity(id, payload);
                const fresh = await config.fetchDetail(id);
                setDetail(fresh as Record<string, unknown>);
                reset(config.detailToFormValues(fresh));
                config.onAfterUpdate?.(fresh);
                setSaveSuccess(`${config.label} saved successfully.`);

                if (entityKey === "buildings") {
                    const tileVersion = bumpBuildingTileVersion();
                    scheduleBuildingTileRefresh(null, tileVersion);
                } else if (entityKey === "places") {
                    bumpPlaceTileVersion();
                } else if (entityKey === "streets") {
                    bumpStreetTileVersion();
                    bumpRoadLabelTileVersion();
                }
            }
        } catch (err) {
            dashDevLog(`${entityKey}:${mode}:save-error`, err);
            setSaveError(sanitizeSaveError(err));
        } finally {
            setIsSaving(false);
        }
    });

    if (mode === "edit" && !id) {
        return (
            <main className="p-6">
                <CoreReviewErrorCard message="Missing record id." />
            </main>
        );
    }

    if (isLoading) {
        return (
            <main className="p-6">
                <CoreReviewLoadingCard message={`Loading ${config.label.toLowerCase()}…`} />
            </main>
        );
    }

    if (loadError) {
        return (
            <main className="p-6">
                <CoreReviewErrorCard message={loadError} />
            </main>
        );
    }

    const title = mode === "create" ? `Create ${config.label}` : `Edit ${config.label}`;
    const description =
        mode === "create"
            ? config.createDescription
            : detail
              ? config.editDescription?.(detail as never)
              : undefined;

    const externalId =
        mode === "edit" && detail
            ? "public_id" in detail
                ? String(detail.public_id)
                : "publicId" in detail
                  ? String(detail.publicId)
                  : null
            : null;

    const formDisabled = !config.writeApiAvailable || isRecordDeleted || isSaving;
    const showPointCoordinates = config.geometry?.geometryType === "point";

    const selectedStreetName =
        entityKey === "streets" && detail && "canonical_name" in detail
            ? String((detail as Street).canonical_name)
            : null;

    const visibleFields = config.editableFields.filter((field) => {
        if (field.createOnly && mode === "edit") {
            return false;
        }
        if (field.editOnly && mode === "create") {
            return false;
        }
        return true;
    });

    const placeDetail = entityKey === "places" && detail ? (detail as PlaceDetail) : null;
    const streetDetail = entityKey === "streets" && detail ? (detail as Street) : null;
    const busStopNames =
        entityKey === "bus-stops" && detail && Array.isArray((detail as { names?: unknown }).names)
            ? ((detail as { names: { id?: string; name: string; languageCode?: string | null; nameType?: string; isPrimary?: boolean }[] }).names.map(
                  (n) => ({
                      id: n.id,
                      name: n.name,
                      language_code: n.languageCode,
                      name_type: n.nameType,
                      is_primary: n.isPrimary,
                  }),
              ))
            : null;

    const mapSection = config.geometry ? (
        <div className="space-y-4">
            <CoreEntityGeometrySection
                config={config.geometry}
                control={control}
                externalId={externalId}
                selectedEntityName={selectedStreetName}
                snapExcludePublicId={entityKey === "streets" ? externalId : null}
                disabled={formDisabled}
                roadClassId={roadClassId}
                onGeometryValidation={setGeometryValidation}
                onApiValidation={setApiGeometryValidation}
                streetSplitMapProps={entityKey === "streets" ? streetSplitMapProps : null}
                mapSurfaceRef={entityKey === "places" ? placeHostMapRef : undefined}
            />
            {config.secondaryGeometry ? (
                <CoreEntityGeometrySection
                    config={config.secondaryGeometry}
                    control={control}
                    externalId={externalId}
                    disabled={formDisabled}
                    onGeometryValidation={setGeometryValidation}
                />
            ) : null}
        </div>
    ) : null;

    return (
        <CoreEntityFormShell
            mode={mode}
            title={title}
            description={description}
            backHref={config.listRoute}
            backLabel={`Back to ${config.labelPlural.toLowerCase()}`}
            onSubmit={config.writeApiAvailable ? (e) => void onSubmit(e) : undefined}
            headerActions={
                mode === "edit" && id ? (
                    <CoreReviewEntityFormLifecycleActions
                        entityKey={entityKey}
                        recordId={id}
                        detail={detail}
                        listRoute={config.listRoute}
                        onReload={reloadDetail}
                        onSuccess={(message) => {
                            setSaveError(null);
                            setSaveSuccess(message);
                        }}
                        onError={(message) => {
                            setSaveSuccess(null);
                            setSaveError(message);
                        }}
                    />
                ) : undefined
            }
            headerNotice={
                <>
                    {!config.writeApiAvailable ? <CoreEntityWriteApiBanner /> : null}
                    {config.formNotice ?? null}
                    {isRecordDeleted ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                            This record is soft-deleted. Restore it to edit fields or save changes again.
                        </div>
                    ) : null}
                </>
            }
            mapSection={mapSection}
            validationSection={
                <CoreEntityValidationPanel
                    fieldErrors={errors}
                    geometryValidation={geometryValidation}
                    apiGeometryValidation={apiGeometryValidation}
                    formError={saveError}
                />
            }
            fieldsSection={
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
                            disabled={formDisabled}
                            refStates={refStates}
                        />
                    ))}
                </>
            }
            metadataSection={
                mode === "edit" ? (
                    <>
                        <CoreReadonlyMetadata detail={detail} fields={config.readonlyMetadata} />
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
                ) : null
            }
            extrasSection={
                <>
                    {mode === "edit" && entityKey === "buildings" && detail && "public_id" in detail ? (
                        <BuildingLinkedPlacesPanel buildingPublicId={String(detail.public_id)} />
                    ) : null}
                    {mode === "edit" && entityKey === "streets" && streetDetail && id ? (
                        <StreetEditExtras
                            street={streetDetail}
                            streetId={id}
                            isSaving={isSaving}
                            editReason={String(editReason ?? "")}
                            onSplitMapPropsChange={handleStreetSplitMapPropsChange}
                            onReload={reloadDetail}
                        />
                    ) : null}
                </>
            }
            leftColumnBelowMapSection={
                mode === "edit" && entityKey === "places" && placeDetail ? (
                    <PlaceLinkedBuildingsPanel
                        placePublicId={placeDetail.public_id}
                        placeLat={placeDetail.lat}
                        placeLng={placeDetail.lng}
                        hostMapRef={placeHostMapRef}
                    />
                ) : null
            }
            actions={
                <CoreFormActions
                    cancelHref={config.listRoute}
                    submitLabel={
                        mode === "create" ? `Create ${config.label.toLowerCase()}` : "Save changes"
                    }
                    isSubmitting={isSaving}
                    disabled={formDisabled}
                    showSubmit={config.writeApiAvailable}
                    saveError={null}
                    saveSuccess={saveSuccess}
                />
            }
        />
    );
}
