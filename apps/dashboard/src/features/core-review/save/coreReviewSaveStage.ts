export type CoreReviewSaveStage =
    | "validating_form"
    | "checking_geometry"
    | "saving_changes"
    | "refreshing_row";

export const CORE_REVIEW_SAVE_STAGE_LABEL: Record<CoreReviewSaveStage, string> = {
    validating_form: "Validating form...",
    checking_geometry: "Checking geometry...",
    saving_changes: "Saving changes...",
    refreshing_row: "Refreshing row...",
};

export const CORE_REVIEW_FORM_VALIDATION_SAVE_ERROR =
    "Please fix validation errors before saving.";

export function coreReviewSaveStageLabel(stage: CoreReviewSaveStage | null | undefined): string | null {
    if (!stage) {
        return null;
    }
    return CORE_REVIEW_SAVE_STAGE_LABEL[stage];
}
