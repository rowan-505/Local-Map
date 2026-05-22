export type ReverseAddressResultType =
    | "exact_address"
    | "building_address"
    | "building_partial_address"
    | "place_address"
    | "street_area_address"
    | "locality_partial_address"
    | "admin_only"
    | "coordinate_only";

export type ReverseAddressDebugComponent = {
    component_type: string;
    value: string;
    language_code: string;
    source: string;
    source_id: string | null;
    confidence_score: number | null;
    match_type: string | null;
    boundary_status: string | null;
    address_usage: string | null;
};

export type ReverseAddressDebugMatched = {
    address_id: string | null;
    building_id: string | null;
    place_id: string | null;
    street_id: string | null;
    admin_area_id: string | null;
};

export type ReverseAddressDebugResponse = {
    result_type: ReverseAddressResultType;
    confidence_score: number;
    full_address_en: string | null;
    full_address_my: string | null;
    display_address: string | null;
    components: ReverseAddressDebugComponent[];
    matched: ReverseAddressDebugMatched;
    alternatives: unknown[];
    warnings: string[];
    debug: {
        lat: number;
        lng: number;
        lang: string;
        decision_reason: string;
        layers: Record<string, unknown>;
    };
};
