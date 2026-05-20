import type { ImportReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";

import type { RefDropdownFieldConfig } from "./refSources";

export type ImportReviewEntitySlug =
    | "buildings"
    | "places"
    | "roads"
    | "bus-stops"
    | "landuse"
    | "water-lines"
    | "water-polygons"
    | "addresses"
    | "admin-areas"
    | "routing-barriers";

export type ImportReviewGeometryType = "point" | "line" | "polygon" | "mixed" | "none";

export type ImportReviewMapLayerType = "point" | "line" | "polygon";

export type ImportReviewRiskLevel = "low" | "medium" | "high";

export type ImportReviewEntityColumnSource = "row" | "normalized";

export type ImportReviewTableColumn = {
    key: string;
    label: string;
    source: ImportReviewEntityColumnSource;
    mono?: boolean;
};

export type ImportReviewFilterField =
    | "match_status"
    | "auto_action"
    | "review_status"
    | "review_decision"
    | "promotion_status"
    | "class_code"
    | "q"
    | "sort"
    | "limit"
    | "offset"
    | "include_promoted";

export type ImportReviewReviewField = "review_decision" | "review_note";

export type ImportReviewStatusColorTone =
    | "approved"
    | "rejected"
    | "needs_review"
    | "ignored"
    | "merged"
    | "manual_protected"
    | "default";

export type ImportReviewStatusColorRule = {
    /** Match against review_decision or review_status (lowercased). */
    when: { field: "review_decision" | "review_status"; value: string };
    tone: ImportReviewStatusColorTone;
};

export type ImportReviewStatusColorRules = {
    rules: readonly ImportReviewStatusColorRule[];
    /** Extra ring/highlight when match_status matches. */
    manualProtectedMatchStatus?: string;
};

export type ImportReviewEntityConfig = {
    slug: ImportReviewEntitySlug;
    apiFamily: string;
    label: string;
    pluralLabel: string;
    routePath: string;
    geometryType: ImportReviewGeometryType;
    mapLayerType: ImportReviewMapLayerType;
    /** Styling bucket for DataReviewCandidateMap (legacy component API). */
    mapEntityType: ImportReviewEntityType;
    riskLevel: ImportReviewRiskLevel;
    tableColumns: readonly ImportReviewTableColumn[];
    searchableFields: readonly string[];
    filterFields: readonly ImportReviewFilterField[];
    overrideEditableFields: readonly string[];
    reviewEditableFields: readonly ImportReviewReviewField[];
    refDropdownFields: readonly RefDropdownFieldConfig[];
    defaultSort: string;
    supportsBulkActions: boolean;
    supportsMapPreview: boolean;
    supportsVertexPreview: boolean;
    supportsGeometryEditLater: boolean;
    supportsPromotion: boolean;
    supportsOverrideEditor: boolean;
    /** Row field for drawer title (falls back to canonical_name, name, id). */
    detailTitleField?: string;
    /** Row field for drawer subtitle (falls back to external_id). */
    detailSubtitleField?: string;
    /** When true, route uses dedicated legacy page instead of ImportReviewEntityPage. */
    legacyDedicatedPage?: boolean;
    statusColorRules?: ImportReviewStatusColorRules;
};

export type ImportReviewEntityConfigInput = Omit<
    ImportReviewEntityConfig,
    "routePath" | "reviewEditableFields" | "supportsOverrideEditor"
> & {
    routePath?: string;
    reviewEditableFields?: readonly ImportReviewReviewField[];
    supportsOverrideEditor?: boolean;
};
