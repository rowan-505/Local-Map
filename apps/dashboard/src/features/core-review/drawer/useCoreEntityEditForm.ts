"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";

import type { CoreGeometryValidationResult } from "@/src/components/core-review/geometry";
import { useBuildingTileVersion, useDashboardTileVersions } from "@/src/components/map/BuildingTileVersionContext";
import { scheduleBuildingTileRefresh } from "@/src/components/map/placeMapConfig";
import {
    ensureRoadClassSelected,
    prepareLocalStreetGeometryForSave,
} from "@/src/features/streets/streetSaveLocalChecks";
import {
    isStreetLineStringGeometryUnchanged,
    streetLineStringFromDetail,
} from "@/src/features/streets/streetGeometryCompare";
import {
    formatStreetGeometrySaveSuccessMessage,
    hasBlockingStreetGeometryErrors,
    validateStreetGeometryForSave,
} from "@/src/features/streets/streetGeometrySaveValidation";
import type { UpdateStreetPayload, ValidateStreetGeometryResponse } from "@/src/lib/api";
import {
    getCoreEntityConfig,
    type CoreEntityFormValues,
    type CoreEntityKey,
} from "@/src/lib/core-review/entityConfigs";
import { getFormGeometry } from "@/src/lib/core-review/geometryFieldUtils";
import { dashDevLog } from "@/src/lib/dashDevLog";
import {
    CORE_REVIEW_FORM_VALIDATION_SAVE_ERROR,
    coreReviewSaveStageLabel,
    type CoreReviewSaveStage,
} from "@/src/features/core-review/save/coreReviewSaveStage";
import {
    isCompleteCoreReviewUpdateDetail,
    resolveDetailAfterCoreReviewUpdate,
} from "@/src/lib/core-review/resolveDetailAfterCoreReviewUpdate";
import { summarizeCoreReviewSavePayload } from "@/src/lib/core-review/savePayloadUtils";

import { isTownshipAdminEntity } from "@/src/lib/core-review/townshipAdminPolicy";
import { townshipAdminSaveBlockMessage } from "../forms/EntityTownshipAdminField";
import { collectRefSources, useCoreEntityRefs } from "../forms/useCoreEntityRefs";
import { isCoreReviewRowDeleted } from "../lifecycle/coreReviewLifecycleUtils";
import { tryAcquireInFlightRef } from "./saveInFlightGuard";
import { sanitizeSaveError } from "./sanitizeSaveError";
import { patchCoreReviewListRowEverywhere } from "../hooks/coreReviewCache";
import { applyStreetDetailToListRow } from "../streets/applyStreetDetailToListRow";
import type { CoreReviewStreetRow } from "../config/types";

export type UseCoreEntityEditFormOptions = {
    entityKey: CoreEntityKey;
    recordId: string;
    enabled: boolean;
    initialDetail?: unknown;
};

export function useCoreEntityEditForm({
    entityKey,
    recordId,
    enabled,
    initialDetail,
}: UseCoreEntityEditFormOptions) {
    const config = getCoreEntityConfig(entityKey);
    const { bumpPlaceTileVersion, bumpStreetTileVersion, bumpRoadLabelTileVersion } = useDashboardTileVersions();
    const { bumpBuildingTileVersion } = useBuildingTileVersion();
    const queryClient = useQueryClient();

    const [detail, setDetail] = useState<Record<string, unknown> | null>(
        initialDetail ? (initialDetail as Record<string, unknown>) : null,
    );
    const [isLoading, setIsLoading] = useState(enabled && !initialDetail);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStage, setSaveStage] = useState<CoreReviewSaveStage | null>(null);
    const [geometryValidation, setGeometryValidation] = useState<CoreGeometryValidationResult | null>(null);
    const [apiGeometryValidation, setApiGeometryValidation] = useState<ValidateStreetGeometryResponse | null>(
        null,
    );
    const saveInFlightRef = useRef(false);

    const geometryFieldKey = config.geometry?.fieldKey ?? "geom";

    const refSources = useMemo(
        () => collectRefSources(config.editableFields),
        [config.editableFields],
    );
    const refStates = useCoreEntityRefs(refSources);

    const schema = useMemo(() => config.formSchema("edit"), [config]);

    const {
        control,
        handleSubmit,
        reset,
        watch,
        setValue,
        formState: { errors, isDirty },
    } = useForm<CoreEntityFormValues>({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- entity schemas vary by config; RHF resolver typing is unified at runtime.
        resolver: zodResolver(schema as any) as Resolver<CoreEntityFormValues>,
        defaultValues: config.defaultFormValues,
    });

    const isRecordDeleted = detail ? isCoreReviewRowDeleted(detail) : false;
    const formDisabled = !config.writeApiAvailable || isRecordDeleted || isSaving;

    const reloadDetail = useCallback(async () => {
        setIsLoading(true);
        setLoadError("");
        try {
            const data = await config.fetchDetail(recordId);
            setDetail(data as Record<string, unknown>);
            reset(config.detailToFormValues(data));
            return data;
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : `Failed to load ${config.label.toLowerCase()}`);
            setDetail(null);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [config, recordId, reset]);

    useEffect(() => {
        if (!enabled || !recordId) {
            return;
        }
        if (initialDetail) {
            setDetail(initialDetail as Record<string, unknown>);
            reset(config.detailToFormValues(initialDetail));
            setIsLoading(false);
            setLoadError("");
            return;
        }
        void reloadDetail();
    }, [enabled, initialDetail, config, reset, reloadDetail, recordId]);

    const cancelDraft = useCallback(() => {
        if (detail) {
            reset(config.detailToFormValues(detail));
        }
        setSaveError(null);
        setSaveSuccess(null);
        setGeometryValidation(null);
        setApiGeometryValidation(null);
    }, [config, detail, reset]);

    const bumpTilesAfterUpdate = useCallback(() => {
        if (entityKey === "buildings") {
            const tileVersion = bumpBuildingTileVersion();
            scheduleBuildingTileRefresh(null, tileVersion);
        } else if (entityKey === "places") {
            bumpPlaceTileVersion();
        } else if (entityKey === "streets") {
            bumpStreetTileVersion();
            bumpRoadLabelTileVersion();
        }
    }, [
        bumpBuildingTileVersion,
        bumpPlaceTileVersion,
        bumpRoadLabelTileVersion,
        bumpStreetTileVersion,
        entityKey,
    ]);

    const submitUpdate = useCallback(async (): Promise<unknown | null> => {
        if (!config.writeApiAvailable) {
            return null;
        }

        if (!tryAcquireInFlightRef(saveInFlightRef)) {
            return null;
        }

        setSaveError(null);
        setSaveSuccess(null);
        setIsSaving(true);
        setSaveStage("validating_form");

        let resolved: unknown | null = null;

        try {
            const run = handleSubmit(
                async (values) => {
                try {
                    if (isTownshipAdminEntity(entityKey)) {
                        const townshipBlock = townshipAdminSaveBlockMessage(values);
                        if (townshipBlock) {
                            setSaveError(townshipBlock);
                            return;
                        }
                    }

                    let streetGeometryChanged = false;
                    let streetGeometryValidation: ValidateStreetGeometryResponse | null = null;

                    if (entityKey === "streets") {
                        const roadClass = ensureRoadClassSelected(String(values.road_class_id ?? ""));
                        if (!roadClass) {
                            setSaveError("Select a road class before saving.");
                            return;
                        }

                        const loadedGeometry = streetLineStringFromDetail(detail);
                        const currentGeometry = getFormGeometry(values, geometryFieldKey);
                        streetGeometryChanged = !isStreetLineStringGeometryUnchanged(
                            loadedGeometry,
                            currentGeometry,
                        );

                        if (streetGeometryChanged) {
                            setSaveStage("checking_geometry");
                            const geom = getFormGeometry(values, geometryFieldKey);
                            const prep = prepareLocalStreetGeometryForSave(
                                geom && typeof geom === "object" && "type" in geom && geom.type === "LineString"
                                    ? (geom as { type: "LineString"; coordinates: number[][] })
                                    : null,
                            );
                            if (!prep.ok) {
                                setSaveError(prep.message);
                                return;
                            }

                            streetGeometryValidation = await validateStreetGeometryForSave({
                                geometry: prep.sanitized,
                                streetId: recordId,
                            });
                            setApiGeometryValidation(streetGeometryValidation);

                            if (hasBlockingStreetGeometryErrors(streetGeometryValidation)) {
                                setSaveError(streetGeometryValidation.errors.join("\n"));
                                return;
                            }

                            values = { ...values, [geometryFieldKey]: prep.sanitized };
                        }
                    }

                    let payload = config.formValuesToUpdatePayload(values);
                    if (entityKey === "streets" && !streetGeometryChanged) {
                        const { geometry: _omit, ...metadataOnly } = payload as UpdateStreetPayload;
                        payload = metadataOnly;
                    }
                    dashDevLog(`${entityKey}:edit:save-payload`, summarizeCoreReviewSavePayload(payload));

                    setSaveStage("saving_changes");
                    const slug = config.coreReviewSlug ?? entityKey;
                    const updated = await config.updateEntity(recordId, payload);
                    if (!isCompleteCoreReviewUpdateDetail(slug, updated)) {
                        setSaveStage("refreshing_row");
                    }
                    const fresh = await resolveDetailAfterCoreReviewUpdate({
                        slug,
                        recordId,
                        updated,
                        fetchDetail: config.fetchDetail,
                    });

                    setDetail(fresh as Record<string, unknown>);
                    reset(config.detailToFormValues(fresh));
                    config.onAfterUpdate?.(fresh);
                    if (entityKey === "streets") {
                        patchCoreReviewListRowEverywhere(
                            queryClient,
                            config.coreReviewSlug ?? entityKey,
                            recordId,
                            (row) => applyStreetDetailToListRow(row as CoreReviewStreetRow, fresh),
                        );
                    } else {
                        patchCoreReviewListRowEverywhere(
                            queryClient,
                            config.coreReviewSlug ?? entityKey,
                            recordId,
                            () => fresh as Record<string, unknown> as any,
                        );
                    }
                    setSaveSuccess(
                        entityKey === "streets"
                            ? formatStreetGeometrySaveSuccessMessage(
                                  config.label,
                                  "saved",
                                  streetGeometryValidation,
                              )
                            : `${config.label} saved successfully.`,
                    );
                    bumpTilesAfterUpdate();
                    resolved = fresh;
                } catch (err) {
                    dashDevLog(`${entityKey}:edit:save-error`, err);
                    setSaveError(sanitizeSaveError(err));
                }
            },
                () => {
                    setSaveError(CORE_REVIEW_FORM_VALIDATION_SAVE_ERROR);
                },
            );

            await run();
        } finally {
            saveInFlightRef.current = false;
            setIsSaving(false);
            setSaveStage(null);
        }

        return resolved;
    }, [
        bumpTilesAfterUpdate,
        config,
        detail,
        entityKey,
        geometryFieldKey,
        handleSubmit,
        queryClient,
        recordId,
        reset,
    ]);

    return {
        config,
        control,
        reset,
        watch,
        setValue,
        errors,
        isDirty,
        detail,
        setDetail,
        isLoading,
        loadError,
        isSaving,
        saveStage,
        saveStageLabel: coreReviewSaveStageLabel(saveStage),
        saveError,
        saveSuccess,
        setSaveSuccess,
        setSaveError,
        formDisabled,
        isRecordDeleted,
        refStates,
        geometryValidation,
        setGeometryValidation,
        apiGeometryValidation,
        setApiGeometryValidation,
        submitUpdate,
        cancelDraft,
        reloadDetail,
    };
}
