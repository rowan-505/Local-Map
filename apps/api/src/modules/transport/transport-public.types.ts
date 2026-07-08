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
