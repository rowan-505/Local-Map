import {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
/** @deprecated UI hidden — use /dashboard/import-transport. Config retained for legacy API/tests. */
import { createImportReviewEntityConfig } from "../createEntityConfig";

export const busRoutesImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "bus-routes",
    apiFamily: "bus_routes",
    label: "Bus route",
    pluralLabel: "Bus routes",
    geometryType: "none",
    mapLayerType: "line",
    mapEntityType: "generic",
    riskLevel: "medium",
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        { key: "route_code", label: "Route code", source: "row", mono: true },
        { key: "public_name", label: "Public name", source: "row" },
        { key: "operator_name", label: "Operator", source: "row" },
        { key: "route_type", label: "Route type", source: "row" },
        { key: "directionality", label: "Directionality", source: "row" },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["route_code", "public_name", "canonical_name", "external_id"],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: [
        "name",
        "name_mm",
        "name_en",
        "public_name",
        "route_code",
        "operator_name",
        "route_type",
        "directionality",
    ],
    refDropdownFields: [],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    supportsBulkActions: true,
    supportsMapPreview: false,
    supportsVertexPreview: false,
    supportsGeometryEditLater: false,
    supportsPromotion: true,
    supportsOverrideEditor: true,
});
