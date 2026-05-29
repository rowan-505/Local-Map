import {
    IMPORT_TRANSPORT_DEFAULT_SORT,
    IMPORT_TRANSPORT_FAMILY_FILTER_FIELDS,
} from "../constants";
import { createImportTransportEntityConfig } from "../createEntityConfig";

export const routeStopsImportTransportEntityConfig = createImportTransportEntityConfig({
    slug: "route-stops",
    apiFamily: "route_stops",
    label: "Route stop",
    pluralLabel: "Route stops",
    geometryType: "none",
    tableColumns: [
        { key: "route_code", label: "Route code", mono: true },
        { key: "variant_code", label: "Variant code", mono: true },
        { key: "stop_name", label: "Stop name" },
        { key: "stop_sequence", label: "Sequence" },
        { key: "validation_status", label: "Validation" },
        { key: "promotion_status", label: "Promotion" },
    ],
    searchableFields: ["route_code", "variant_code", "stop_name", "stop_code"],
    filterFields: IMPORT_TRANSPORT_FAMILY_FILTER_FIELDS["route-stops"],
    defaultSort: "stop_sequence_asc",
    supportsMapPreview: false,
    detailTitleField: "stop_name",
    detailSubtitleField: "route_code",
});
