import type { ImportTransportApiFamily } from "../config/types";

export const IMPORT_TRANSPORT_API_FAMILY_ENTITY_KIND: Record<ImportTransportApiFamily, string> = {
    routes: "route",
    stops: "stop",
    variants: "route_variant",
    route_stops: "route_stop",
};
