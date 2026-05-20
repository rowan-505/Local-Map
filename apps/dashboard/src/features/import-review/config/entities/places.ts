import {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";
import { REF_POI_CATEGORY_ID } from "../refSources";

export const placesImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "places",
    apiFamily: "places",
    label: "Place",
    pluralLabel: "Places",
    geometryType: "point",
    mapLayerType: "point",
    mapEntityType: "place",
    riskLevel: "low",
    legacyDedicatedPage: false,
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        { key: "canonical_name", label: "Name", source: "row" },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["canonical_name", "name", "external_id"],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: [
        "name",
        "canonical_name",
        "category_id",
        "poi_category_id",
        "class_code",
        "importance_score",
        "popularity_score",
    ],
    refDropdownFields: [REF_POI_CATEGORY_ID],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    supportsBulkActions: true,
    supportsMapPreview: true,
    supportsVertexPreview: false,
    supportsGeometryEditLater: false,
    supportsPromotion: false,
    supportsOverrideEditor: true,
});
