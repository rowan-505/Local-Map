"use client";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";
import type { ImportReviewFormOptionsResponse } from "@/src/lib/api";
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
    onSaveOverrides: (patch: Record<string, unknown>, reviewNote: string | null) => Promise<void>;
    formOptions?: ImportReviewFormOptionsResponse | null;
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
            onSave={onSaveOverrides}
            formOptions={formOptions}
            formOptionsLoading={formOptionsLoading}
            formOptionsError={formOptionsError}
        />
    );
}
