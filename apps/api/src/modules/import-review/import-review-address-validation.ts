import type {
    AddressCandidateValidationInput,
    AddressCandidateValidationResult,
    AddressValidationIssue,
    AddressValidationStatus,
} from "./import-review-address-validation.types.js";

const ALLOWED_LANGUAGE_CODES = new Set(["en", "my", "und"]);

/** Non-locality / global-only component types. */
const GLOBAL_ONLY_COMPONENT_TYPES = new Set(["country", "postcode", "plus_code"]);

/** Locality or street-level types (at least one required beyond global-only). */
const LOCAL_COMPONENT_TYPES = new Set([
    "region",
    "district",
    "township",
    "city",
    "town",
    "ward",
    "quarter",
    "village_tract",
    "village",
    "street",
    "road",
    "house_number",
    "building",
    "floor",
    "unit",
    "landmark",
]);

const BILINGUAL_LOCAL_TYPES = new Set([
    "region",
    "district",
    "township",
    "city",
    "town",
    "ward",
    "quarter",
    "village_tract",
    "village",
    "street",
    "road",
]);

const CONFIDENCE_WARNING_THRESHOLD = 50;

function issue(
    code: string,
    message: string,
    severity: "error" | "warning",
    extra?: { field?: string; component_id?: string }
): AddressValidationIssue {
    return { code, message, severity, ...extra };
}

function resolveStatus(
    blockers: AddressValidationIssue[],
    warnings: AddressValidationIssue[]
): AddressValidationStatus {
    if (blockers.length > 0) {
        return "blocked";
    }
    if (warnings.length > 0) {
        return "valid_with_warnings";
    }
    return "valid";
}

export function validateAddressCandidate(
    input: AddressCandidateValidationInput
): AddressCandidateValidationResult {
    const blockers: AddressValidationIssue[] = [];
    const warnings: AddressValidationIssue[] = [];

    const activeComponents = input.components.filter((c) => !c.is_deleted);

    if (!input.point_geom_present) {
        blockers.push(
            issue(
                "point_geom_missing",
                "Address candidate must have point_geom before promotion.",
                "error",
                { field: "point_geom" }
            )
        );
    }

    if (input.matched_admin_area_id === null) {
        blockers.push(
            issue(
                "matched_admin_area_id_missing",
                "matched_admin_area_id is required before promotion.",
                "error",
                { field: "matched_admin_area_id" }
            )
        );
    }

    if (activeComponents.length === 0) {
        blockers.push(
            issue(
                "no_address_components",
                "At least one active address_components row is required.",
                "error"
            )
        );
    }

    const trimEmpty = activeComponents.filter((c) => c.component_value.trim() === "");
    for (const row of trimEmpty) {
        blockers.push(
            issue(
                "component_value_empty",
                `component_value is empty for ${row.component_type_code} (${row.language_code}).`,
                "error",
                { field: "component_value", component_id: row.id.toString() }
            )
        );
    }

    for (const row of activeComponents) {
        if (!input.valid_component_type_codes.has(row.component_type_code)) {
            blockers.push(
                issue(
                    "invalid_component_type_code",
                    `Unknown component_type_code: ${row.component_type_code}`,
                    "error",
                    { field: "component_type_code", component_id: row.id.toString() }
                )
            );
        }
        if (!ALLOWED_LANGUAGE_CODES.has(row.language_code)) {
            blockers.push(
                issue(
                    "invalid_language_code",
                    `language_code must be en, my, or und (got ${row.language_code}).`,
                    "error",
                    { field: "language_code", component_id: row.id.toString() }
                )
            );
        }
    }

    const hasLocalComponent = activeComponents.some((c) =>
        LOCAL_COMPONENT_TYPES.has(c.component_type_code)
    );
    const onlyGlobal =
        activeComponents.length > 0 &&
        activeComponents.every((c) => GLOBAL_ONLY_COMPONENT_TYPES.has(c.component_type_code));

    if (activeComponents.length > 0 && !hasLocalComponent && onlyGlobal) {
        blockers.push(
            issue(
                "only_global_components",
                "Only country/postcode/plus_code components present; add a local component (e.g. village, street, house_number).",
                "error"
            )
        );
    }

    const reviewStatus = (input.review_status ?? "").trim().toLowerCase();
    if (reviewStatus === "rejected") {
        blockers.push(
            issue(
                "review_status_rejected",
                "review_status is rejected; candidate cannot be promoted.",
                "error",
                { field: "review_status" }
            )
        );
    }

    const promotionStatus = (input.promotion_status ?? "").trim().toLowerCase();
    if (promotionStatus === "promoted") {
        blockers.push(
            issue(
                "promotion_status_promoted",
                "Candidate is already promoted.",
                "error",
                { field: "promotion_status" }
            )
        );
    }

    if (input.has_core_duplicate) {
        blockers.push(
            issue(
                "duplicate_core_address",
                input.core_duplicate_message ??
                    "Possible duplicate core.core_addresses row detected.",
                "error"
            )
        );
    }

    if (input.matched_street_id === null) {
        warnings.push(
            issue(
                "matched_street_id_missing",
                "matched_street_id is not set; street-level match is recommended.",
                "warning",
                { field: "matched_street_id" }
            )
        );
    }

    const hasHouseNumber = activeComponents.some(
        (c) => c.component_type_code === "house_number" && c.component_value.trim() !== ""
    );
    if (!hasHouseNumber) {
        warnings.push(
            issue(
                "house_number_missing",
                "No house_number component; promotion may still proceed but search precision is reduced.",
                "warning"
            )
        );
    }

    const hasPostcode = activeComponents.some(
        (c) => c.component_type_code === "postcode" && c.component_value.trim() !== ""
    );
    if (!hasPostcode) {
        warnings.push(
            issue(
                "postcode_missing",
                "No postcode component.",
                "warning"
            )
        );
    }

    for (const typeCode of BILINGUAL_LOCAL_TYPES) {
        const hasEn = activeComponents.some(
            (c) => c.component_type_code === typeCode && c.language_code === "en"
        );
        const hasMy = activeComponents.some(
            (c) => c.component_type_code === typeCode && c.language_code === "my"
        );
        if (hasMy && !hasEn) {
            warnings.push(
                issue(
                    "english_components_incomplete",
                    `Myanmar ${typeCode} present without English equivalent.`,
                    "warning"
                )
            );
        }
        if (hasEn && !hasMy) {
            warnings.push(
                issue(
                    "myanmar_components_incomplete",
                    `English ${typeCode} present without Myanmar equivalent.`,
                    "warning"
                )
            );
        }
    }

    for (const row of activeComponents) {
        if (row.address_usage === "locality_hint") {
            warnings.push(
                issue(
                    "admin_locality_hint",
                    `Admin component ${row.component_type_code} (${row.language_code}) uses locality_hint address_usage.`,
                    "warning",
                    { component_id: row.id.toString() }
                )
            );
        }
        if (
            row.component_type_code === "village" &&
            (row.boundary_status === "settlement_extent" || row.boundary_status === "approximate")
        ) {
            warnings.push(
                issue(
                    row.boundary_status === "settlement_extent"
                        ? "village_settlement_extent"
                        : "village_approximate_boundary",
                    `Village component (${row.language_code}) is from ${row.boundary_status} boundary — not an official polygon.`,
                    "warning",
                    { component_id: row.id.toString() }
                )
            );
        }
        if (
            row.confidence_score !== null &&
            row.confidence_score < CONFIDENCE_WARNING_THRESHOLD
        ) {
            warnings.push(
                issue(
                    "confidence_below_threshold",
                    `Component ${row.component_type_code} (${row.language_code}) confidence ${row.confidence_score} is below ${CONFIDENCE_WARNING_THRESHOLD}.`,
                    "warning",
                    { component_id: row.id.toString() }
                )
            );
        }
    }

    if (!input.entrance_geom_present) {
        warnings.push(
            issue(
                "entrance_geom_missing",
                "entrance_geom is not set.",
                "warning",
                { field: "entrance_geom" }
            )
        );
    }

    const validation_status = resolveStatus(blockers, warnings);

    return {
        address_candidate_id: input.id,
        validation_status,
        promotion_blockers: blockers,
        promotion_warnings: warnings,
    };
}
