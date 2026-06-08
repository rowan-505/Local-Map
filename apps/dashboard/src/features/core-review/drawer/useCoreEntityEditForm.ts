"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
    hasBlockingStreetGeometryErrors,
    shouldConfirmStreetTopologyWarnings,
    validateStreetGeometryForSave,
} from "@/src/features/streets/streetGeometrySaveValidation";
import type { ValidateStreetGeometryResponse } from "@/src/lib/api";
import {
    getCoreEntityConfig,
    type CoreEntityFormValues,
    type CoreEntityKey,
} from "@/src/lib/core-review/entityConfigs";
import { getFormGeometry } from "@/src/lib/core-review/geometryFieldUtils";
import { dashDevLog } from "@/src/lib/dashDevLog";
import { summarizeCoreReviewSavePayload } from "@/src/lib/core-review/savePayloadUtils";

import { townshipAdminSaveBlockMessage } from "../forms/EntityTownshipAdminField";
import { collectRefSources, useCoreEntityRefs } from "../forms/useCoreEntityRefs";
import { isCoreReviewRowDeleted } from "../lifecycle/coreReviewLifecycleUtils";
import { SAVE_WITH_TOPOLOGY_WARNINGS_CONFIRM } from "../forms/CoreEntityGeometrySection";
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
    const [geometryValidation, setGeometryValidation] = useState<CoreGeometryValidationResult | null>(null);
    const [apiGeometryValidation, setApiGeometryValidation] = useState<ValidateStreetGeometryResponse | null>(
        null,
    );

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
        formState: { errors, isDirty, dirtyFields },
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

        setSaveError(null);
        setSaveSuccess(null);
        setIsSaving(true);

        let resolved: unknown | null = null;

        try {
            const run = handleSubmit(async (values) => {
                try {
                    const townshipBlock = townshipAdminSaveBlockMessage(values);
                    if (townshipBlock) {
                        setSaveError(townshipBlock);
                        return;
                    }

                    if (entityKey === "streets") {
                        const geometryDirty = Boolean(
                            (dirtyFields as Record<string, unknown>)[geometryFieldKey],
                        );

                        const roadClass = ensureRoadClassSelected(String(values.road_class_id ?? ""));
                        if (!roadClass) {
                            setSaveError("Select a road class before saving.");
                            return;
                        }

                        if (geometryDirty) {
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

                            const check = await validateStreetGeometryForSave({
                                geometry: prep.sanitized,
                                streetId: recordId,
                            });
                            setApiGeometryValidation(check);

                            if (hasBlockingStreetGeometryErrors(check)) {
                                setSaveError(check.errors.join("\n"));
                                return;
                            }

                            if (shouldConfirmStreetTopologyWarnings(check)) {
                                if (!window.confirm(SAVE_WITH_TOPOLOGY_WARNINGS_CONFIRM)) {
                                    return;
                                }
                            }

                            values = { ...values, [geometryFieldKey]: prep.sanitized };
                        }
                    }

                    const payload = config.formValuesToUpdatePayload(values);
                    dashDevLog(`${entityKey}:edit:save-payload`, summarizeCoreReviewSavePayload(payload));
                    await config.updateEntity(recordId, payload);
                    const fresh = await config.fetchDetail(recordId);
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
                    setSaveSuccess(`${config.label} saved successfully.`);
                    bumpTilesAfterUpdate();
                    resolved = fresh;
                } catch (err) {
                    dashDevLog(`${entityKey}:edit:save-error`, err);
                    setSaveError(sanitizeSaveError(err));
                }
            });

            await run();
        } finally {
            setIsSaving(false);
        }

        return resolved;
    }, [
        bumpTilesAfterUpdate,
        config,
        dirtyFields,
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
