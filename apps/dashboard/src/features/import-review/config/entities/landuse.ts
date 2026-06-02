import {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";
import { getImportReviewNameColumns } from "../../utils/importReviewNaming";

export const landuseImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "landuse",
    apiFamily: "landuse",
    label: "Landuse",
    pluralLabel: "Landuse",
    geometryType: "polygon",
    mapLayerType: "polygon",
    mapEntityType: "landuse",
    riskLevel: "low",
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        ...getImportReviewNameColumns(),
        { key: "landuse_class_display", label: "Landuse class", source: "row" },
        { key: "imported_class_code", label: "Source class", source: "row" },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["name", "external_id", "class_code"],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: ["name_mm", "name_en", "landuse_class_id", "admin_area_id"],
    refDropdownFields: [],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    supportsBulkActions: true,
    supportsMapPreview: true,
    supportsVertexPreview: true,
    supportsGeometryEditLater: false,
    supportsPromotion: false,
    supportsOverrideEditor: true,
});
