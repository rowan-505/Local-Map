import {
    IMPORT_TRANSPORT_DEFAULT_SORT,
    IMPORT_TRANSPORT_FAMILY_FILTER_FIELDS,
} from "../constants";
import { createImportTransportEntityConfig } from "../createEntityConfig";

export const routesImportTransportEntityConfig = createImportTransportEntityConfig({
    slug: "routes",
    apiFamily: "routes",
    label: "Route",
    pluralLabel: "Routes",
    geometryType: "none",
    tableColumns: [
        { key: "route_code", label: "Route code", mono: true },
        { key: "public_name", label: "Public name" },
        { key: "mode_type", label: "Mode type" },
        { key: "operator", label: "Operator" },
        { key: "review_status", label: "Review status" },
        { key: "validation_status", label: "Validation" },
        { key: "promotion_status", label: "Promotion" },
        { key: "confidence_score", label: "Confidence" },
    ],
    searchableFields: ["route_code", "public_name"],
    filterFields: IMPORT_TRANSPORT_FAMILY_FILTER_FIELDS.routes,
    defaultSort: IMPORT_TRANSPORT_DEFAULT_SORT,
    supportsMapPreview: false,
    detailTitleField: "public_name",
    detailSubtitleField: "route_code",
});
