"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import type { Map as MaplibreMap } from "maplibre-gl";

import type { CoreGeometryValidationResult } from "@/src/components/core-review/geometry";
import { CoreReviewErrorCard, CoreReviewLoadingCard } from "@/src/components/core-review/CoreReviewStateCard";
import { useBuildingTileVersion, useDashboardTileVersions } from "@/src/components/map/BuildingTileVersionContext";
import { DASHBOARD_STREET_MVT_SESSION_BUST_KEY, scheduleBuildingTileRefresh } from "@/src/components/map/placeMapConfig";
import {
    ensureRoadClassSelected,
    prepareLocalStreetGeometryForSave,
} from "@/src/features/streets/streetSaveLocalChecks";
import {
    hasBlockingStreetGeometryErrors,
    validateStreetGeometryForSave,
} from "@/src/features/streets/streetGeometrySaveValidation";
import {
    getPlaceFormOptions,
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
import { summarizeCoreReviewSavePayload } from "@/src/lib/core-review/savePayloadUtils";

import { CORE_REVIEW_FORM_VALIDATION_SAVE_ERROR } from "@/src/features/core-review/save/coreReviewSaveStage";

import { useCoreEntityEditForm, sanitizeSaveError } from "../drawer";
import {
    CoreEntityEditBelowMapSection,
    CoreEntityEditExtrasSection,
    CoreEntityEditFieldsSection,
    CoreEntityEditMapSection,
    CoreEntityEditMetadataSection,
    resolveCoreEntityExternalId,
} from "./CoreEntityEditFormSections";
import CoreEntityFormShell from "./CoreEntityFormShell";
import CoreEntityValidationPanel from "./CoreEntityValidationPanel";
import CoreEntityWriteApiBanner from "./CoreEntityWriteApiBanner";
import CoreFormActions from "./CoreFormActions";
import { isTownshipAdminEntity } from "@/src/lib/core-review/townshipAdminPolicy";
import { townshipAdminSaveBlockMessage } from "./EntityTownshipAdminField";
import CoreReviewEntityFormLifecycleActions from "../lifecycle/CoreReviewEntityFormLifecycleActions";
import { isCoreReviewRowDeleted } from "../lifecycle/coreReviewLifecycleUtils";
import type { StreetSplitMapProps } from "./StreetEditExtras";
import { collectRefSources, useCoreEntityRefs } from "./useCoreEntityRefs";

// TODO: Add beforeunload / router guard when a shared unsaved-changes pattern exists in the dashboard.

export type CoreEntityFormPageProps = {
    entityKey: CoreEntityKey;
    mode: CoreEntityFormMode;
    id?: string;
};

export default function CoreEntityFormPage({ entityKey, mode, id }: CoreEntityFormPageProps) {
    const config = getCoreEntityConfig(entityKey);
    const router = useRouter();
    const { bumpPlaceTileVersion, bumpStreetTileVersion, bumpRoadLabelTileVersion } = useDashboardTileVersions();
    const { bumpBuildingTileVersion } = useBuildingTileVersion();

    const isEdit = mode === "edit" && Boolean(id);

    const editForm = useCoreEntityEditForm({
        entityKey,
        recordId: id ?? "",
        enabled: isEdit,
    });

    const [createSaveError, setCreateSaveError] = useState<string | null>(null);
    const [createSaveSuccess, setCreateSaveSuccess] = useState<string | null>(null);
    const [createIsSaving, setCreateIsSaving] = useState(false);
    const [geometryValidation, setGeometryValidation] = useState<CoreGeometryValidationResult | null>(null);
    const [apiGeometryValidation, setApiGeometryValidation] = useState<ValidateStreetGeometryResponse | null>(
        null,
    );
    const [streetSplitMapProps, setStreetSplitMapProps] = useState<StreetSplitMapProps | null>(null);
    const placeHostMapRef = useRef<MaplibreMap | null>(null);

    const geometryFieldKey = config.geometry?.fieldKey ?? "geom";

    const createRefSources = useMemo(
        () => collectRefSources(config.editableFields),
        [config.editableFields],
    );
    const createRefStates = useCoreEntityRefs(createRefSources);

    const createSchema = useMemo(() => config.formSchema("create"), [config]);

    const createForm = useForm<CoreEntityFormValues>({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- entity schemas vary by config; RHF resolver typing is unified at runtime.
        resolver: zodResolver(createSchema as any) as Resolver<CoreEntityFormValues>,
        defaultValues: config.defaultFormValues,
    });

    const control = isEdit ? editForm.control : createForm.control;
    const watch = isEdit ? editForm.watch : createForm.watch;
    const setValue = isEdit ? editForm.setValue : createForm.setValue;
    const errors = isEdit ? editForm.errors : createForm.formState.errors;
    const refStates = isEdit ? editForm.refStates : createRefStates;

    const detail = isEdit ? editForm.detail : null;
    const isLoading = isEdit ? editForm.isLoading : false;
    const loadError = isEdit ? editForm.loadError : "";
    const saveError = isEdit ? editForm.saveError : createSaveError;
    const saveSuccess = isEdit ? editForm.saveSuccess : createSaveSuccess;
    const isSaving = isEdit ? editForm.isSaving : createIsSaving;

    const isRecordDeleted =
        isEdit && detail ? isCoreReviewRowDeleted(detail) : false;

    const handleStreetSplitMapPropsChange = useCallback((props: StreetSplitMapProps) => {
        setStreetSplitMapProps(props);
    }, []);

    const reloadDetail = useCallback(async () => {
        await editForm.reloadDetail();
    }, [editForm]);

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
                createForm.setValue("sourceTypeId", manual.id);
            }
            if (published?.id) {
                createForm.setValue("publishStatusId", published.id);
            }
        });
        return () => {
            mounted = false;
        };
    }, [entityKey, mode, createForm]);

    useEffect(() => {
        if (mode !== "create" || entityKey !== "admin-areas") {
            return;
        }
        const manual = createRefStates["reference-options:source_types"]?.options.find(
            (option) => option.code === "manual",
        );
        if (manual?.value) {
            createForm.setValue("source_type_id", manual.value);
        }
    }, [entityKey, mode, createRefStates, createForm]);

    const onCreateSubmit = createForm.handleSubmit(
        async (values) => {
        if (!config.writeApiAvailable) {
            return;
        }

        setCreateSaveError(null);
        setCreateSaveSuccess(null);
        setCreateIsSaving(true);

        try {
            if (isTownshipAdminEntity(entityKey)) {
                const townshipBlock = townshipAdminSaveBlockMessage(values);
                if (townshipBlock) {
                    setCreateSaveError(townshipBlock);
                    setCreateIsSaving(false);
                    return;
                }
            }

            if (entityKey === "streets") {
                const geom = getFormGeometry(values, geometryFieldKey);
                const prep = prepareLocalStreetGeometryForSave(
                    geom && typeof geom === "object" && "type" in geom && geom.type === "LineString"
                        ? (geom as { type: "LineString"; coordinates: number[][] })
                        : null,
                );
                if (!prep.ok) {
                    setCreateSaveError(prep.message);
                    setCreateIsSaving(false);
                    return;
                }

                const roadClass = ensureRoadClassSelected(String(values.road_class_id ?? ""));
                if (!roadClass) {
                    setCreateSaveError("Select a road class before saving.");
                    setCreateIsSaving(false);
                    return;
                }

                const check = await validateStreetGeometryForSave({
                    geometry: prep.sanitized,
                });
                setApiGeometryValidation(check);

                if (hasBlockingStreetGeometryErrors(check)) {
                    setCreateSaveError(check.errors.join("\n"));
                    return;
                }

                values = { ...values, [geometryFieldKey]: prep.sanitized };
            }

            const payload = config.formValuesToCreatePayload(values);
            dashDevLog(`${entityKey}:create:save-payload`, summarizeCoreReviewSavePayload(payload));
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
            setCreateSaveSuccess(`${config.label} created successfully.`);
        } catch (err) {
            dashDevLog(`${entityKey}:create:save-error`, err);
            setCreateSaveError(sanitizeSaveError(err));
        } finally {
            setCreateIsSaving(false);
        }
    },
        () => {
            setCreateSaveError(CORE_REVIEW_FORM_VALIDATION_SAVE_ERROR);
        },
    );

    const onEditSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void editForm.submitUpdate();
    };

    const onSubmit = isEdit ? onEditSubmit : (e: React.FormEvent<HTMLFormElement>) => void onCreateSubmit(e);

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

    const externalId = isEdit ? resolveCoreEntityExternalId(detail) : null;

    const formDisabled = !config.writeApiAvailable || isRecordDeleted || isSaving;

    const resolvedGeometryValidation = isEdit ? editForm.geometryValidation : geometryValidation;
    const resolvedApiGeometryValidation = isEdit ? editForm.apiGeometryValidation : apiGeometryValidation;
    const setResolvedGeometryValidation = isEdit
        ? editForm.setGeometryValidation
        : setGeometryValidation;
    const setResolvedApiGeometryValidation = isEdit
        ? editForm.setApiGeometryValidation
        : setApiGeometryValidation;

    const editSectionProps = {
        entityKey,
        mode,
        config,
        recordId: id ?? null,
        control,
        watch,
        setValue,
        errors,
        refStates,
        detail,
        disabled: formDisabled,
        isSaving,
        externalId,
        onGeometryValidation: setResolvedGeometryValidation,
        onApiValidation: setResolvedApiGeometryValidation,
        streetSplitMapProps,
        onStreetSplitMapPropsChange: handleStreetSplitMapPropsChange,
        placeHostMapRef,
        reloadDetail: isEdit ? editForm.reloadDetail : undefined,
    };

    const mapSection = config.geometry ? (
        <CoreEntityEditMapSection {...editSectionProps} />
    ) : null;

    return (
        <CoreEntityFormShell
            mode={mode}
            title={title}
            description={description}
            backHref={config.listRoute}
            backLabel={`Back to ${config.labelPlural.toLowerCase()}`}
            onSubmit={config.writeApiAvailable ? onSubmit : undefined}
            headerActions={
                isEdit && id ? (
                    <CoreReviewEntityFormLifecycleActions
                        entityKey={entityKey}
                        recordId={id}
                        detail={detail}
                        listRoute={config.listRoute}
                        onReload={reloadDetail}
                        onSuccess={(message) => {
                            editForm.setSaveError(null);
                            editForm.setSaveSuccess(message);
                        }}
                        onError={(message) => {
                            editForm.setSaveSuccess(null);
                            editForm.setSaveError(message);
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
                    geometryValidation={resolvedGeometryValidation}
                    apiGeometryValidation={resolvedApiGeometryValidation}
                    formError={saveError}
                />
            }
            fieldsSection={<CoreEntityEditFieldsSection {...editSectionProps} />}
            metadataSection={<CoreEntityEditMetadataSection {...editSectionProps} />}
            extrasSection={<CoreEntityEditExtrasSection {...editSectionProps} />}
            leftColumnBelowMapSection={<CoreEntityEditBelowMapSection {...editSectionProps} />}
            actions={
                <CoreFormActions
                    cancelHref={config.listRoute}
                    submitLabel={
                        mode === "create" ? `Create ${config.label.toLowerCase()}` : "Save changes"
                    }
                    isSubmitting={isSaving}
                    disabled={formDisabled}
                    showSubmit={config.writeApiAvailable}
                    saveError={saveError}
                    saveSuccess={saveSuccess}
                    saveStageLabel={isEdit ? editForm.saveStageLabel : null}
                />
            }
        />
    );
}
