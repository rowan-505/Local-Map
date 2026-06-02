import {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";
import { REF_ROAD_CLASS_ID, REF_ADMIN_AREA_ID } from "../refSources";
import { getImportReviewNameColumns } from "../../utils/importReviewNaming";

export const roadsImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "roads",
    apiFamily: "roads",
    label: "Road",
    pluralLabel: "Roads",
    geometryType: "line",
    mapLayerType: "line",
    mapEntityType: "road",
    riskLevel: "high",
    legacyDedicatedPage: false,
    detailTitleField: "name_en",
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        ...getImportReviewNameColumns(),
        { key: "class_code", label: "Road class", source: "row" },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["name_mm", "name_en", "external_id", "class_code"],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: [
        "name_mm",
        "name_en",
        "canonical_name",
        "admin_area_id",
        "road_class_id",
        "surface",
        "is_oneway",
        "bridge",
        "tunnel",
        "layer",
        "access",
        "speed_kph",
    ],
    refDropdownFields: [REF_ROAD_CLASS_ID, REF_ADMIN_AREA_ID],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    /** Legacy ImportReviewEntityPage reads supportsBulkApproval via shim (was false). */
    supportsBulkActions: false,
    supportsMapPreview: true,
    supportsVertexPreview: true,
    supportsGeometryEditLater: true,
    supportsPromotion: true,
    supportsOverrideEditor: true,
});
