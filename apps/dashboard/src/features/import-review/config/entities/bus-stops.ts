import {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";
import { REF_ADMIN_AREA_ID } from "../refSources";

export const busStopsImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "bus-stops",
    apiFamily: "bus_stops",
    label: "Bus stop",
    pluralLabel: "Bus stops",
    geometryType: "point",
    mapLayerType: "point",
    mapEntityType: "generic",
    riskLevel: "low",
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        { key: "name", label: "Name", source: "row" },
        { key: "name_local", label: "Name (local)", source: "normalized" },
        { key: "stop_code", label: "Stop code", source: "normalized", mono: true },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["name", "name_local", "stop_code", "external_id"],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: ["name", "name_local", "stop_code", "admin_area_id"],
    refDropdownFields: [REF_ADMIN_AREA_ID],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    supportsBulkActions: true,
    supportsMapPreview: true,
    supportsVertexPreview: false,
    supportsGeometryEditLater: false,
    supportsPromotion: false,
    supportsOverrideEditor: true,
});
