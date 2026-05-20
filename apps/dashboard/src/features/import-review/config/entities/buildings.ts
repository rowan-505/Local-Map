import {
    IMPORT_REVIEW_BUILDINGS_EXTRA_FILTER_FIELDS,
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";
import { REF_BUILDING_TYPE_ID } from "../refSources";

export const buildingsImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "buildings",
    apiFamily: "buildings",
    label: "Building",
    pluralLabel: "Buildings",
    geometryType: "polygon",
    mapLayerType: "polygon",
    mapEntityType: "building",
    riskLevel: "low",
    /** /import-review/buildings uses ImportReviewEntityPageShell; legacy client is data-review sidebar map only. */
    legacyDedicatedPage: false,
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        { key: "name", label: "Name", source: "row" },
        { key: "class_code", label: "Class", source: "row" },
        { key: "building_type", label: "Building type", source: "row" },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["name", "canonical_name", "external_id", "class_code"],
    filterFields: [...IMPORT_REVIEW_STANDARD_FILTER_FIELDS, ...IMPORT_REVIEW_BUILDINGS_EXTRA_FILTER_FIELDS],
    overrideEditableFields: [
        "name",
        "canonical_name",
        "class_code",
        "building_type",
        "building_type_id",
        "levels",
        "height_m",
    ],
    refDropdownFields: [REF_BUILDING_TYPE_ID],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    supportsBulkActions: true,
    supportsMapPreview: true,
    supportsVertexPreview: true,
    supportsGeometryEditLater: false,
    supportsPromotion: true,
    supportsOverrideEditor: true,
});
