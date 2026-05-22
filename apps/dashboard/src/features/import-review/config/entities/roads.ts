import {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";
import { REF_ROAD_CLASS_ID, REF_ADMIN_AREA_ID } from "../refSources";

export const roadsImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "roads",
    apiFamily: "roads",
    label: "Road",
    pluralLabel: "Roads",
    geometryType: "line",
    mapLayerType: "line",
    mapEntityType: "road",
    riskLevel: "high",
    /** TODO: migrate to ImportReviewEntityPage after porting road routing-validation drawer UX. */
    /** TODO: roads use dedicated effective-state path — table still shows raw columns until unified. */
    legacyDedicatedPage: true,
    detailTitleField: "name_en",
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        { key: "name_mm", label: "Name MM", source: "row" },
        { key: "name_en", label: "Name EN", source: "row" },
        { key: "class_code", label: "Road class", source: "row" },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["name_mm", "name_en", "external_id", "class_code"],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: [
        "name_mm",
        "name_en",
        "admin_area_id",
        "road_class_id",
        "surface",
        "is_oneway",
    ],
    refDropdownFields: [REF_ROAD_CLASS_ID, REF_ADMIN_AREA_ID],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    /** Legacy ImportReviewEntityPage reads supportsBulkApproval via shim (was false). */
    supportsBulkActions: false,
    supportsMapPreview: true,
    supportsVertexPreview: true,
    supportsGeometryEditLater: true,
    supportsPromotion: false,
    supportsOverrideEditor: true,
});
