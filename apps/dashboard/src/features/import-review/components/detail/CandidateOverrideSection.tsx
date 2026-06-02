"use client";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";
import type { ImportReviewFormOptionsBundle } from "../../hooks/useImportReviewFormOptions";
import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";

import type { ImportReviewEntityConfig } from "../../config/types";
import ImportReviewOverrideEditor from "../ImportReviewOverrideEditor";

export default function CandidateOverrideSection({
    config,
    row,
    apiScope,
    canEdit,
    isSavingOverrides,
    overrideSaveMessage,
    overrideSaveTechnicalError = "",
    onSaveOverrides,
    formOptions = null,
    formOptionsLoading = false,
    formOptionsError = "",
}: {
    config: ImportReviewEntityConfig;
    row: ImportReviewBuildingListItem;
    apiScope: ImportReviewScopeQueryParams | null;
    canEdit: boolean;
    isSavingOverrides: boolean;
    overrideSaveMessage: string | null;
    overrideSaveTechnicalError?: string | null;
    onSaveOverrides: (
        patch: Record<string, unknown>,
        reviewNote: string | null,
        saveOptions?: {
            verifyPatchKeys?: readonly string[];
            referenceFieldsDevLog?: Record<string, unknown>;
        }
    ) => Promise<ImportReviewBuildingListItem>;
    formOptions?: ImportReviewFormOptionsBundle | null;
    formOptionsLoading?: boolean;
    formOptionsError?: string;
}) {
    if (!config.supportsOverrideEditor && config.overrideEditableFields.length === 0) {
        return null;
    }

    return (
        <ImportReviewOverrideEditor
            config={config}
            row={row}
            apiScope={apiScope}
            canEdit={canEdit}
            isSaving={isSavingOverrides}
            saveMessage={overrideSaveMessage}
            saveTechnicalError={overrideSaveTechnicalError}
            onSave={onSaveOverrides}
            formOptions={formOptions}
            formOptionsLoading={formOptionsLoading}
            formOptionsError={formOptionsError}
        />
    );
}
