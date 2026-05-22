export const REVERSE_ADDRESS_RESULT_TYPES = [
    "exact_address",
    "building_address",
    "building_partial_address",
    "place_address",
    "street_area_address",
    "locality_partial_address",
    "admin_only",
    "coordinate_only",
] as const;

export type ReverseAddressResultType = (typeof REVERSE_ADDRESS_RESULT_TYPES)[number];

export type ReverseAddressLang = "en" | "my";

export type ReverseAddressComponentSource =
    | "core_address"
    | "core_building"
    | "core_place"
    | "core_street"
    | "core_admin_area"
    | "core_landuse"
    | "coordinates";

export type ReverseAddressResolverComponent = {
    component_type_code: string;
    component_value: string;
    language_code: string;
    source: ReverseAddressComponentSource;
    source_id: string | null;
    confidence_score: number | null;
    match_type: string | null;
    boundary_status: string | null;
    address_usage: string | null;
    sort_order: number | null;
};

export type ReverseAddressMatchedIds = {
    address_id: string | null;
    building_id: string | null;
    place_id: string | null;
    street_id: string | null;
    admin_area_id: string | null;
};

export type ReverseAddressResponse = {
    result_type: ReverseAddressResultType;
    confidence_score: number;
    full_address_en: string | null;
    full_address_my: string | null;
    display_address: string | null;
    components: Array<{
        component_type: string;
        value: string;
        language_code: string;
        source: ReverseAddressComponentSource;
        source_id: string | null;
        confidence_score: number | null;
        match_type: string | null;
        boundary_status: string | null;
        address_usage: string | null;
    }>;
    matched: ReverseAddressMatchedIds;
    alternatives: ReverseAddressResponse[];
    warnings: string[];
};

export type ReverseAddressDebugResponse = ReverseAddressResponse & {
    debug: {
        lat: number;
        lng: number;
        lang: ReverseAddressLang;
        decision_reason: string;
        layers: Record<string, unknown>;
    };
};
