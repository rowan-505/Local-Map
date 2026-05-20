import {
    IMPORT_REVIEW_DEFAULT_STATUS_COLOR_RULES,
    IMPORT_REVIEW_REVIEW_EDITABLE_FIELDS,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    importReviewRoutePath,
} from "./constants";
import type { ImportReviewEntityConfig, ImportReviewEntityConfigInput } from "./types";

export function createImportReviewEntityConfig(
    input: ImportReviewEntityConfigInput
): ImportReviewEntityConfig {
    const supportsOverrideEditor =
        input.supportsOverrideEditor ??
        (input.overrideEditableFields.length > 0 || input.supportsGeometryEditLater);

    return {
        ...input,
        routePath: input.routePath ?? importReviewRoutePath(input.slug),
        reviewEditableFields: input.reviewEditableFields ?? IMPORT_REVIEW_REVIEW_EDITABLE_FIELDS,
        supportsOverrideEditor,
        statusColorRules: input.statusColorRules ?? IMPORT_REVIEW_DEFAULT_STATUS_COLOR_RULES,
        detailTitleField: input.detailTitleField ?? "canonical_name",
        detailSubtitleField: input.detailSubtitleField ?? "external_id",
    };
}
