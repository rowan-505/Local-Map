import {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";

export const busRouteStopsImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "bus-route-stops",
    apiFamily: "bus_route_stops",
    label: "Bus route stop",
    pluralLabel: "Bus route stops",
    geometryType: "none",
    mapLayerType: "point",
    mapEntityType: "generic",
    riskLevel: "medium",
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        { key: "route_variant_id", label: "Variant ID", source: "row", mono: true },
        { key: "stop_id", label: "Stop ID", source: "row", mono: true },
        { key: "stop_sequence", label: "Sequence", source: "row" },
        { key: "distance_from_start_m", label: "Distance from start (m)", source: "row" },
        { key: "is_timing_point", label: "Timing point", source: "row" },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["external_id", "canonical_name"],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: [
        "route_variant_id",
        "stop_id",
        "stop_sequence",
        "distance_from_start_m",
        "is_timing_point",
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
