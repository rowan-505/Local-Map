import {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";
import { REF_LAND_AREA_CLASS_ID } from "../refSources";
import { getImportReviewNameColumns } from "../../utils/importReviewNaming";

export const landAreasImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "land-areas",
    apiFamily: "land_areas",
    label: "Land area",
    pluralLabel: "Land areas",
    geometryType: "polygon",
    mapLayerType: "polygon",
    mapEntityType: "land_area",
    riskLevel: "low",
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        ...getImportReviewNameColumns(),
        { key: "land_area_class_display", label: "Land area class", source: "row" },
        { key: "imported_class_code", label: "Source class", source: "row" },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["name", "external_id", "class_code"],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: ["name_mm", "name_en", "land_area_class_id", "admin_area_id"],
    refDropdownFields: [REF_LAND_AREA_CLASS_ID],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    supportsBulkActions: true,
    supportsMapPreview: true,
    supportsVertexPreview: true,
    supportsGeometryEditLater: false,
    supportsPromotion: false,
    supportsOverrideEditor: true,
});
