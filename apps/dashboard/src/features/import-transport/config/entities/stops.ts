import {
    IMPORT_TRANSPORT_DEFAULT_SORT,
    IMPORT_TRANSPORT_FAMILY_FILTER_FIELDS,
} from "../constants";
import { createImportTransportEntityConfig } from "../createEntityConfig";

export const stopsImportTransportEntityConfig = createImportTransportEntityConfig({
    slug: "stops",
    apiFamily: "stops",
    label: "Stop",
    pluralLabel: "Stops",
    geometryType: "point",
    tableColumns: [
        { key: "name", label: "Name" },
        { key: "stop_code", label: "Stop code", mono: true },
        { key: "mode_type", label: "Mode type" },
        { key: "admin_area", label: "Admin area" },
        { key: "review_status", label: "Review status" },
        { key: "validation_status", label: "Validation" },
        { key: "promotion_status", label: "Promotion" },
        { key: "confidence_score", label: "Confidence" },
    ],
    searchableFields: ["stop_name", "stop_code", "name"],
    filterFields: IMPORT_TRANSPORT_FAMILY_FILTER_FIELDS.stops,
    defaultSort: IMPORT_TRANSPORT_DEFAULT_SORT,
    supportsMapPreview: true,
    detailTitleField: "name",
    detailSubtitleField: "stop_code",
});
