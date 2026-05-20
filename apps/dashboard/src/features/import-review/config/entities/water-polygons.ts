import {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";

export const waterPolygonsImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "water-polygons",
    apiFamily: "water_polygons",
    label: "Water polygon",
    pluralLabel: "Water polygons",
    geometryType: "polygon",
    mapLayerType: "polygon",
    mapEntityType: "water_polygon",
    riskLevel: "low",
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        { key: "name", label: "Name", source: "row" },
        { key: "class_code", label: "Class", source: "row" },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["name", "external_id", "class_code"],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: ["name", "class_code"],
    refDropdownFields: [],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    supportsBulkActions: true,
    supportsMapPreview: true,
    supportsVertexPreview: true,
    supportsGeometryEditLater: false,
    supportsPromotion: false,
    supportsOverrideEditor: true,
});
