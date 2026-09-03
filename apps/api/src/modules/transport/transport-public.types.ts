import type { GeoJsonGeometry } from "./transport.types.js";

export type PublicTransportFare = {
    fare_type: string;
    amount_min: number | null;
    amount_max: number | null;
    currency_code: string;
    note: string | null;
};

export type PublicTransportOperator = {
    name: string;
};

export type PublicTransportStopOnRoute = {
    stop_sequence: number;
    public_id: string;
    name_my: string | null;
    name_en: string | null;
    geometry: GeoJsonGeometry | null;
    distance_from_start_m: number | null;
};

export type PublicTransportVariant = {
    variant_code: string;
    direction_name: string | null;
    direction_id: number | null;
    headsign: string | null;
    distance_m: number | null;
    path: {
        path_kind: string;
        distance_m: number | null;
        geometry: GeoJsonGeometry | null;
    } | null;
    stops: PublicTransportStopOnRoute[];
};

export type PublicTransportRouteListItem = {
    route_code: string;
    route_name_my: string | null;
    route_name_en: string | null;
    operator: PublicTransportOperator | null;
    fare: PublicTransportFare | null;
};

export type PublicTransportRouteDetail = PublicTransportRouteListItem & {
    variants: PublicTransportVariant[];
};

export type PublicTransportRouteStopsResponse = {
    route_code: string;
    variants: Array<{
        variant_code: string;
        direction_name: string | null;
        stops: PublicTransportStopOnRoute[];
    }>;
};

export type PublicTransportStopRouteUsage = {
    route_code: string;
    route_name_my: string | null;
    route_name_en: string | null;
    variant_code: string;
    direction_name: string | null;
    stop_sequence: number;
};

/** Normalized public map stop class for detail panels. */
export type PublicTransportStopKind = "bus_stop" | "station" | "terminal";

export type PublicTransportStopNextPreviewItem = {
    stop_sequence: number;
    id: string;
    public_id: string;
    /** Localized display label for the downstream stop. */
    display_name: string;
    /** @deprecated Use `display_name`. Kept for existing API clients. */
    name: string;
    name_mm: string | null;
    name_my: string | null;
    name_en: string | null;
    lat: number;
    lng: number;
};

export type PublicTransportStopRouteServing = {
    route_id: string;
    route_public_id: string;
    route_code: string;
    public_name: string | null;
    variant_id: string;
    variant_public_id: string;
    variant_code: string;
    direction_name: string | null;
    origin_name: string | null;
    destination_name: string | null;
    stop_sequence: number;
};

export type PublicTransportStopNextPreviewGroup = {
    route_id: string;
    route_public_id: string;
    route_code: string;
    public_name: string | null;
    variant_id: string;
    variant_public_id: string;
    variant_code: string;
    direction_name: string | null;
    destination_name: string | null;
    /** Sequence of the selected stop on this variant. */
    current_stop_sequence: number;
    /** @deprecated Use `current_stop_sequence`. Kept for existing API clients. */
    stop_sequence: number;
    next_stops: PublicTransportStopNextPreviewItem[];
    /** @deprecated Use `next_stops`. Kept for existing API clients. */
    stops: PublicTransportStopNextPreviewItem[];
};

/** Public web map terminal detail — aligned with stop detail where practical. */
export type PublicTransportTerminalDetail = {
    id: string;
    publicId: string;
    public_id: string;
    entity_type: "terminal";
    name: string;
    myanmar_name: string | null;
    english_name: string | null;
    name_mm: string | null;
    name_my: string | null;
    name_en: string | null;
    name_und: string | null;
    display_name: string | null;
    primary_name: string | null;
    canonical_name: string | null;
    terminal_code: string | null;
    terminal_role: string;
    mode: string;
    admin_area_name: string | null;
    lat: number;
    lng: number;
    coordinates: readonly [number, number];
    isVerified: boolean;
    verification_status: string;
    status_label: string;
    confidenceScore: number | null;
    route_count: number;
    routes_serving_this_stop: PublicTransportStopRouteServing[];
    address_line?: string;
    plus_code?: string | null;
};

export type PublicStopPhoto = {
    cardUrl: string;
    detailUrl: string;
    width: number | null;
    height: number | null;
    isPrimary: boolean;
    note: string | null;
};

/** Public web map stop detail — mirrors public place detail field naming where practical. */
export type PublicTransportStopDetail = {
    id: string;
    publicId: string;
    public_id: string;
    name: string;
    myanmar_name: string | null;
    english_name: string | null;
    name_mm: string | null;
    /** Myanmar primary label — alias of `name_mm` for public API consumers. */
    name_my: string | null;
    name_en: string | null;
    name_und: string | null;
    display_name: string | null;
    primary_name: string | null;
    canonical_name: string | null;
    stop_code: string | null;
    stop_type: PublicTransportStopKind;
    mode: string;
    admin_area_name: string | null;
    lat: number;
    lng: number;
    coordinates: readonly [number, number];
    isVerified: boolean;
    verification_status: string;
    status_label: string;
    confidenceScore: number | null;
    route_count: number;
    routes_serving_this_stop: PublicTransportStopRouteServing[];
    next_stops_preview: PublicTransportStopNextPreviewGroup[];
    address_line?: string;
    plus_code?: string | null;
    photos?: PublicStopPhoto[];
};

export type PublicTransportRouteSearchStop = {
    route_stop_id: string;
    stop_id: string;
    public_id: string;
    stop_sequence: number;
    name_my: string | null;
    name_en: string | null;
};

export type PublicTransportRouteSearchCandidate = {
    route_id: string;
    route_public_id: string;
    route_code: string;
    public_name: string | null;
    variant_id: string;
    variant_public_id: string;
    variant_code: string;
    direction_name: string | null;
    origin_name: string | null;
    destination_name: string | null;
    origin_stop_sequence: number;
    destination_stop_sequence: number;
    forward_stop_count: number;
    stops: PublicTransportRouteSearchStop[];
};

export type PublicTransportRouteSearchResponse = {
    origin_stop_public_id: string;
    destination_stop_public_id: string;
    candidates: PublicTransportRouteSearchCandidate[];
};
