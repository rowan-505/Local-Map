/**
 * Publish-batch validation stages for simple typed-column validation.
 * Only these stages are seeded and executed by ImportReviewPromotionValidationRunner.
 */

export const IMPORT_REVIEW_SIMPLE_PUBLISH_VALIDATION_STAGES = [
    { key: "load_batch", label: "Load batch", progressEnd: 5 },
    { key: "load_items", label: "Load items", progressEnd: 10 },
    { key: "group_by_entity", label: "Group by entity", progressEnd: 15 },
    { key: "validate_candidate_state", label: "Validate items", progressEnd: 90 },
    { key: "write_validation_summary", label: "Write summary", progressEnd: 100 },
] as const;

/** @deprecated Legacy per-item sub-stages used by validation-rules only; not seeded in simple mode. */
export const IMPORT_REVIEW_LEGACY_PUBLISH_ITEM_VALIDATION_STAGES = [
    "validate_candidate_state",
    "validate_geometry",
    "validate_required_fields",
    "validate_references",
    "validate_duplicates",
    "validate_entity_specific_rules",
] as const;

export type ImportReviewLegacyPublishItemValidationStageKey =
    (typeof IMPORT_REVIEW_LEGACY_PUBLISH_ITEM_VALIDATION_STAGES)[number];
