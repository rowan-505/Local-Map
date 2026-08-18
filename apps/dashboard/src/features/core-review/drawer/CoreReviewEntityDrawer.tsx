"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getCoreEntityConfig } from "@/src/lib/core-review/entityConfigs";
import { useDashboardRoleAccess } from "@/src/hooks/useDashboardRoleAccess";
import CoreReviewConfirmDialog from "../lifecycle/CoreReviewConfirmDialog";
import { isCoreReviewRowDeleted } from "../lifecycle/coreReviewLifecycleUtils";
import type { CoreReviewEntityConfig } from "../config/entity-config-types";

import CoreEntityDrawerEditForm from "./CoreEntityDrawerEditForm";
import CoreReviewDrawerActions from "./CoreReviewDrawerActions";
import CoreReviewDrawerShell from "./CoreReviewDrawerShell";
import CoreReviewEntityDrawerView from "./CoreReviewEntityDrawerView";
import { useCoreEntityEditForm } from "./useCoreEntityEditForm";
import {
    useCoreReviewInlineEditDiscardGuard,
    type CoreReviewInlineEditGuard,
} from "./useCoreReviewInlineEditDiscardGuard";
import { useCoreReviewDrawerState } from "./useCoreReviewDrawerState";

export type CoreReviewEntityDrawerProps<T extends Record<string, unknown>> = {
    config: CoreReviewEntityConfig<T>;
    open: boolean;
    row: T | null;
    rowId: string | null;
    onClose: () => void;
    onRowPatched: (rowId: string, updater: (row: T) => T) => void;
    drawerActions?: React.ReactNode;
    /** Receives inline-edit guard when {@link config.supportsInlineEdit} is enabled. */
    onInlineEditGuardReady?: (guard: CoreReviewInlineEditGuard | null) => void;
    /** Opens the drawer directly in edit mode once (deep links). */
    startInEditMode?: boolean;
};

export default function CoreReviewEntityDrawer<T extends Record<string, unknown>>({
    config,
    open,
    row,
    rowId,
    onClose,
    onRowPatched,
    drawerActions,
    onInlineEditGuardReady,
    startInEditMode = false,
}: CoreReviewEntityDrawerProps<T>) {
    const dashboardAccess = useDashboardRoleAccess();
    const drawerState = useCoreReviewDrawerState({
        rowId,
        open,
        startInEditMode: dashboardAccess.canWrite && startInEditMode,
    });
    const formConfig = getCoreEntityConfig(config.entityKey);
    const [saveNotice, setSaveNotice] = useState<{ rowId: string; message: string } | null>(null);

    const editForm = useCoreEntityEditForm({
        entityKey: config.entityKey,
        recordId: rowId ?? "",
        enabled: dashboardAccess.canWrite && open && drawerState.isEditing && Boolean(rowId),
    });

    const viewSuccessMessage =
        open && rowId && saveNotice?.rowId === rowId ? saveNotice.message : null;

    const title = row ? config.getRowTitle(row) : "";
    const subtitle = row ? config.getRowSubtitle?.(row) ?? null : null;
    const listGeometry = row ? config.getGeometry(row) : null;

    const supportsInlineEdit = config.supportsInlineEdit === true && formConfig.writeApiAvailable;
    const canEdit =
        dashboardAccess.canWrite && supportsInlineEdit && row
            ? !isCoreReviewRowDeleted(row as Record<string, unknown>)
            : false;

    const discardInlineEditDraft = useCallback(() => {
        editForm.cancelDraft();
        drawerState.cancelEdit();
    }, [drawerState, editForm]);

    const { guardAction, dialogOpen, confirmDiscard, cancelDiscard } = useCoreReviewInlineEditDiscardGuard({
        enabled: supportsInlineEdit,
        isEditing: drawerState.isEditing,
        isDirty: editForm.isDirty,
        onDiscard: discardInlineEditDraft,
    });

    useEffect(() => {
        if (!supportsInlineEdit) {
            onInlineEditGuardReady?.(null);
            return;
        }
        onInlineEditGuardReady?.(guardAction);
        return () => onInlineEditGuardReady?.(null);
    }, [supportsInlineEdit, guardAction, onInlineEditGuardReady]);

    const handleClose = useCallback(() => {
        guardAction(onClose);
    }, [guardAction, onClose]);

    const handleCancel = useCallback(() => {
        guardAction(() => undefined);
    }, [guardAction]);

    const handleSave = useCallback(async () => {
        const fresh = await editForm.submitUpdate();
        if (!fresh || !rowId) {
            return;
        }

        editForm.setDetail(fresh as Record<string, unknown>);

        if (config.applyDetailToListRow && row) {
            onRowPatched(rowId, (current) => config.applyDetailToListRow!(current, fresh));
        }

        setSaveNotice({ rowId, message: `${formConfig.label} saved successfully.` });
        drawerState.returnToView();
    }, [config, drawerState, editForm, formConfig.label, onRowPatched, row, rowId]);

    const handleEnterEdit = useCallback(() => {
        setSaveNotice(null);
        drawerState.enterEdit();
    }, [drawerState]);

    const viewContent = useMemo(() => {
        if (!row || !rowId) {
            return null;
        }

        const detailFields = config.detailFields(row);

        if (config.extensions?.renderDrawerView) {
            return config.extensions.renderDrawerView({
                row,
                rowId,
                successMessage: viewSuccessMessage,
            });
        }

        return (
            <CoreReviewEntityDrawerView
                apiSlug={config.apiSlug}
                idKind={config.idKind}
                rowId={rowId}
                geometryKind={config.geometryKind}
                mapEntityType={config.mapEntityType}
                listGeometry={listGeometry}
                detailFields={detailFields}
                successMessage={viewSuccessMessage}
            />
        );
    }, [config, listGeometry, row, rowId, viewSuccessMessage]);

    const editContent = useMemo(() => {
        if (!rowId || !drawerState.isEditing) {
            return null;
        }

        if (config.extensions?.renderDrawerEdit) {
            return config.extensions.renderDrawerEdit({
                row,
                rowId,
                editForm,
            });
        }

        return <CoreEntityDrawerEditForm form={editForm} recordId={rowId} />;
    }, [config, drawerState.isEditing, editForm, row, rowId]);

    if (!open || !row || !rowId) {
        return null;
    }

    return (
        <>
            <CoreReviewDrawerShell
                open={open}
                mode={drawerState.mode}
                title={title}
                subtitle={subtitle}
                onClose={handleClose}
                maxWidthClass={
                    drawerState.isEditing && config.geometryKind !== "none"
                        ? "sm:max-w-3xl"
                        : drawerState.isEditing
                          ? "sm:max-w-2xl"
                          : "sm:max-w-xl"
                }
                editActions={
                    <CoreReviewDrawerActions
                        mode={drawerState.mode}
                        canEdit={canEdit}
                        isSaving={editForm.isSaving}
                        formDisabled={editForm.formDisabled}
                        saveError={editForm.saveError}
                        saveStageLabel={editForm.saveStageLabel}
                        onEnterEdit={handleEnterEdit}
                        onCancel={handleCancel}
                        onSave={() => void handleSave()}
                    />
                }
                headerActions={drawerActions}
            >
                {drawerState.mode === "view" ? viewContent : editContent}
            </CoreReviewDrawerShell>

            {supportsInlineEdit ? (
                <CoreReviewConfirmDialog
                    open={dialogOpen}
                    title="Discard unsaved changes?"
                    description="You have unsaved edits in this drawer. Discard them and continue?"
                    confirmLabel="Discard changes"
                    confirmTone="danger"
                    onConfirm={confirmDiscard}
                    onCancel={cancelDiscard}
                />
            ) : null}
        </>
    );
}
