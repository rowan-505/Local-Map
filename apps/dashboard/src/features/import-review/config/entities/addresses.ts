import {
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";

const ADDRESS_TABLE_COLUMNS = [
    { key: "source_name", label: "Source / place", source: "row" as const },
    { key: "source_type_hint", label: "Source type", source: "row" as const },
    { key: "house_number", label: "House #", source: "row" as const },
    { key: "street", label: "Street", source: "row" as const },
    { key: "locality", label: "Township/locality", source: "row" as const },
    { key: "confidence_score", label: "Confidence", source: "row" as const },
    { key: "validation_status", label: "Validation", source: "row" as const },
    { key: "match_status", label: "Match", source: "row" as const },
    { key: "auto_action", label: "Auto action", source: "row" as const },
    { key: "review_status", label: "Review status", source: "row" as const },
    { key: "promotion_status", label: "Promotion", source: "row" as const },
    { key: "updated_at", label: "Updated", source: "row" as const },
];

export const addressesImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "addresses",
    apiFamily: "addresses",
    label: "Address",
    pluralLabel: "Addresses",
    geometryType: "point",
    mapLayerType: "point",
    mapEntityType: "generic",
    riskLevel: "low",
    tableColumns: [...IMPORT_REVIEW_DEFAULT_ID_COLUMNS, ...ADDRESS_TABLE_COLUMNS],
    searchableFields: [
        "full_address",
        "house_number",
        "street",
        "locality",
        "city",
        "postcode",
        "external_id",
    ],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: [],
    refDropdownFields: [],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    supportsBulkActions: true,
    supportsMapPreview: true,
    supportsVertexPreview: false,
    supportsGeometryEditLater: false,
    supportsPromotion: true,
    supportsOverrideEditor: false,
    detailTitleField: "display_full_address",
    detailSubtitleField: "external_id",
});
