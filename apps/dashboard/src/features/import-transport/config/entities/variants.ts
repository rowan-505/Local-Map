import {
    IMPORT_TRANSPORT_DEFAULT_SORT,
    IMPORT_TRANSPORT_FAMILY_FILTER_FIELDS,
} from "../constants";
import { createImportTransportEntityConfig } from "../createEntityConfig";

export const variantsImportTransportEntityConfig = createImportTransportEntityConfig({
    slug: "variants",
    apiFamily: "variants",
    label: "Variant",
    pluralLabel: "Variants",
    geometryType: "line",
    tableColumns: [
        { key: "route_code", label: "Route code", mono: true },
        { key: "variant_code", label: "Variant code", mono: true },
        { key: "direction_name", label: "Direction" },
        { key: "origin_name", label: "Origin" },
        { key: "destination_name", label: "Destination" },
        { key: "geometry_status", label: "Geometry" },
        { key: "validation_status", label: "Validation" },
        { key: "promotion_status", label: "Promotion" },
    ],
    searchableFields: ["route_code", "variant_code", "direction_name"],
    filterFields: IMPORT_TRANSPORT_FAMILY_FILTER_FIELDS.variants,
    defaultSort: IMPORT_TRANSPORT_DEFAULT_SORT,
    supportsMapPreview: true,
    detailTitleField: "variant_code",
    detailSubtitleField: "route_code",
});
