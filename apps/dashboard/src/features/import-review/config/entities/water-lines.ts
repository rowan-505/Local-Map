import {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";
import { REF_WATER_CLASS_ID } from "../refSources";
import { getImportReviewNameColumns } from "../../utils/importReviewNaming";

export const waterLinesImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "water-lines",
    apiFamily: "water_lines",
    label: "Water line",
    pluralLabel: "Water lines",
    geometryType: "line",
    mapLayerType: "line",
    mapEntityType: "water_line",
    riskLevel: "low",
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        ...getImportReviewNameColumns(),
        { key: "effective_class_code", label: "Class", source: "row" },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["name", "external_id", "class_code"],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: ["name_mm", "name_en", "water_class_id"],
    refDropdownFields: [REF_WATER_CLASS_ID],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    supportsBulkActions: true,
    supportsMapPreview: true,
    supportsVertexPreview: true,
    supportsGeometryEditLater: false,
    supportsPromotion: false,
    supportsOverrideEditor: true,
});
