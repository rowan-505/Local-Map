import {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";
import { REF_ROAD_CLASS_ID } from "../refSources";

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
    legacyDedicatedPage: true,
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        { key: "canonical_name", label: "Name", source: "row" },
        { key: "class_code", label: "Class", source: "row" },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["canonical_name", "name", "external_id", "class_code"],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: [
        "name",
        "canonical_name",
        "road_class_id",
        "surface",
        "is_oneway",
        "bridge",
        "tunnel",
        "layer",
    ],
    refDropdownFields: [REF_ROAD_CLASS_ID],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    /** Legacy ImportReviewEntityPage reads supportsBulkApproval via shim (was false). */
    supportsBulkActions: false,
    supportsMapPreview: true,
    supportsVertexPreview: true,
    supportsGeometryEditLater: true,
    supportsPromotion: false,
    supportsOverrideEditor: true,
});
