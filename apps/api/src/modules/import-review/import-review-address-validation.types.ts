export type AddressValidationIssue = {
    code: string;
    message: string;
    severity: "error" | "warning";
    field?: string;
    component_id?: string;
};

export type AddressValidationStatus =
    | "blocked"
    | "valid_with_warnings"
    | "valid";

export type AddressCandidateValidationInput = {
    id: bigint;
    point_geom_present: boolean;
    entrance_geom_present: boolean;
    matched_admin_area_id: bigint | null;
    matched_street_id: bigint | null;
    review_status: string | null;
    promotion_status: string | null;
    promoted_core_address_id: bigint | null;
    components: Array<{
        id: bigint;
        component_type_code: string;
        component_value: string;
        language_code: string;
        confidence_score: number | null;
        source_admin_area_id: bigint | null;
        boundary_status: string | null;
        address_usage: string | null;
        is_deleted: boolean;
    }>;
    valid_component_type_codes: ReadonlySet<string>;
    has_core_duplicate: boolean;
    core_duplicate_message: string | null;
};

export type AddressCandidateValidationResult = {
    address_candidate_id: bigint;
    validation_status: AddressValidationStatus;
    promotion_blockers: AddressValidationIssue[];
    promotion_warnings: AddressValidationIssue[];
};
