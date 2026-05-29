import { IMPORT_TRANSPORT_MODE_TYPES } from "./import-transport.config.js";
import type {
    ImportTransportCandidateValidationStatus,
    ImportTransportValidationIssueDraft,
} from "./import-transport-validation.types.js";

function issue(
    issue_code: string,
    message: string,
    severity: "warning" | "error",
    details?: Record<string, unknown>
): ImportTransportValidationIssueDraft {
    return { issue_code, message, severity, ...(details ? { details } : {}) };
}

function isBlank(value: string | null | undefined): boolean {
    return value == null || value.trim() === "";
}

function isConfidenceOutOfRange(value: number | null | undefined): boolean {
    if (value == null || Number.isNaN(value)) {
        return false;
    }
    return value < 0 || value > 100;
}

export type RouteValidationInput = {
    id: string;
    route_code: string | null;
    public_name: string | null;
    transport_mode: string | null;
    confidence_score: number | null;
    operator_match_status: string | null;
    has_operator: boolean;
    duplicate_route_code: boolean;
};

export type StopValidationInput = {
    id: string;
    stop_code: string | null;
    stop_name: string | null;
    stop_name_local: string | null;
    admin_area_code: string | null;
    confidence_score: number | null;
    geometry_present: boolean;
    geometry_valid: boolean;
    geometry_srid: number | null;
    nearby_stop_id: string | null;
    nearby_stop_distance_m: number | null;
};

export type VariantValidationInput = {
    id: string;
    raw_route_id: string | null;
    parent_route_exists: boolean;
    variant_code: string | null;
    direction_name: string | null;
    origin_name: string | null;
    destination_name: string | null;
    distance_m: number | null;
    geometry_present: boolean;
    geometry_valid: boolean;
    duplicate_variant: boolean;
};

export type RouteStopValidationInput = {
    id: string;
    raw_route_variant_id: string | null;
    raw_stop_id: string | null;
    variant_exists: boolean;
    stop_exists: boolean;
    stop_sequence: number | null;
    distance_from_start_m: number | null;
    duplicate_stop_sequence: boolean;
    duplicate_consecutive_stop: boolean;
};

export function validateRouteCandidate(input: RouteValidationInput): ImportTransportValidationIssueDraft[] {
    const issues: ImportTransportValidationIssueDraft[] = [];

    if (isBlank(input.route_code)) {
        issues.push(issue("route_code_missing", "Route code is required.", "error"));
    }

    const mode = input.transport_mode?.trim() ?? "";
    if (
        isBlank(mode) ||
        !(IMPORT_TRANSPORT_MODE_TYPES as readonly string[]).includes(mode)
    ) {
        issues.push(issue("mode_type_invalid", "Transport mode is missing or invalid.", "error", { mode }));
    }

    if (input.duplicate_route_code) {
        issues.push(
            issue(
                "duplicate_route_code",
                "Another route in this batch uses the same route code and mode.",
                "error"
            )
        );
    }

    if (isConfidenceOutOfRange(input.confidence_score)) {
        issues.push(
            issue(
                "confidence_score_out_of_range",
                "Confidence score must be between 0 and 100.",
                "error",
                { confidence_score: input.confidence_score }
            )
        );
    }

    if (isBlank(input.public_name)) {
        issues.push(issue("public_name_missing", "Public name is missing.", "warning"));
    }

    if (!input.has_operator || input.operator_match_status === "unmatched") {
        issues.push(issue("operator_unknown", "Operator is missing or unmatched.", "warning"));
    }

    return issues;
}

export function validateStopCandidate(input: StopValidationInput): ImportTransportValidationIssueDraft[] {
    const issues: ImportTransportValidationIssueDraft[] = [];

    if (!input.geometry_present) {
        issues.push(issue("geometry_missing", "Stop geometry is missing.", "error"));
    } else {
        if (!input.geometry_valid) {
            issues.push(issue("geometry_invalid", "Stop geometry is invalid.", "error"));
        }
        if (input.geometry_srid != null && input.geometry_srid !== 4326) {
            issues.push(
                issue(
                    "geometry_srid_invalid",
                    "Stop geometry SRID must be 4326.",
                    "error",
                    { srid: input.geometry_srid }
                )
            );
        }
    }

    if (isBlank(input.stop_name) && isBlank(input.stop_name_local)) {
        issues.push(issue("name_missing", "Stop name is required.", "error"));
    }

    if (input.nearby_stop_id) {
        issues.push(
            issue(
                "duplicate_stop_too_close",
                "Another stop in this batch is too close to this stop.",
                "error",
                {
                    nearby_stop_id: input.nearby_stop_id,
                    distance_m: input.nearby_stop_distance_m,
                }
            )
        );
    }

    if (isConfidenceOutOfRange(input.confidence_score)) {
        issues.push(
            issue(
                "confidence_score_out_of_range",
                "Confidence score must be between 0 and 100.",
                "error",
                { confidence_score: input.confidence_score }
            )
        );
    }

    if (isBlank(input.stop_code)) {
        issues.push(issue("stop_code_missing", "Stop code is missing.", "warning"));
    }

    if (isBlank(input.admin_area_code)) {
        issues.push(issue("admin_area_missing", "Admin area is missing.", "warning"));
    }

    return issues;
}

export function validateVariantCandidate(input: VariantValidationInput): ImportTransportValidationIssueDraft[] {
    const issues: ImportTransportValidationIssueDraft[] = [];

    if (isBlank(input.raw_route_id) || !input.parent_route_exists) {
        issues.push(
            issue(
                "parent_route_missing",
                "Parent route candidate is missing for this variant.",
                "error"
            )
        );
    }

    if (!input.geometry_present) {
        issues.push(issue("geometry_missing", "Variant geometry is missing.", "error"));
    } else if (!input.geometry_valid) {
        issues.push(issue("geometry_invalid", "Variant geometry is invalid.", "error"));
    }

    if (input.duplicate_variant) {
        issues.push(
            issue(
                "duplicate_variant",
                "Another variant for this route uses the same direction or variant code.",
                "error"
            )
        );
    }

    if (isBlank(input.origin_name) || isBlank(input.destination_name)) {
        issues.push(
            issue(
                "origin_destination_missing",
                "Origin or destination name is missing.",
                "warning"
            )
        );
    }

    if (input.distance_m == null) {
        issues.push(issue("distance_not_calculated", "Variant distance has not been calculated.", "warning"));
    }

    return issues;
}

export function validateRouteStopCandidate(
    input: RouteStopValidationInput
): ImportTransportValidationIssueDraft[] {
    const issues: ImportTransportValidationIssueDraft[] = [];

    if (isBlank(input.raw_route_variant_id) || !input.variant_exists) {
        issues.push(issue("route_variant_missing", "Route variant is missing.", "error"));
    }

    if (isBlank(input.raw_stop_id) || !input.stop_exists) {
        issues.push(issue("stop_missing", "Stop is missing.", "error"));
    }

    if (input.stop_sequence == null || input.stop_sequence <= 0) {
        issues.push(issue("stop_sequence_missing", "Stop sequence must be a positive integer.", "error"));
    }

    if (input.duplicate_stop_sequence) {
        issues.push(
            issue(
                "duplicate_stop_sequence",
                "Another row in this variant uses the same stop sequence.",
                "error"
            )
        );
    }

    if (input.duplicate_consecutive_stop) {
        issues.push(
            issue(
                "duplicate_consecutive_stop",
                "This stop repeats consecutively in the variant sequence.",
                "error"
            )
        );
    }

    if (input.distance_from_start_m == null) {
        issues.push(
            issue(
                "distance_from_start_missing",
                "Distance from start has not been calculated.",
                "warning"
            )
        );
    }

    return issues;
}

export function resolveValidationStatusFromIssues(
    issues: ImportTransportValidationIssueDraft[]
): ImportTransportCandidateValidationStatus {
    const hasError = issues.some((row) => row.severity === "error" || row.severity === "critical");
    if (hasError) {
        return "blocked";
    }
    const hasWarning = issues.some((row) => row.severity === "warning");
    if (hasWarning) {
        return "warning";
    }
    return "valid";
}

export function partitionValidationIssues(issues: ImportTransportValidationIssueDraft[]): {
    errors: ImportTransportValidationIssueDraft[];
    warnings: ImportTransportValidationIssueDraft[];
} {
    return {
        errors: issues.filter((row) => row.severity === "error" || row.severity === "critical"),
        warnings: issues.filter((row) => row.severity === "warning"),
    };
}

export function validationIssuesRequireConfirmation(
    status: ImportTransportCandidateValidationStatus
): boolean {
    return status === "warning";
}

export function promotionBlockedByValidationStatus(
    status: ImportTransportCandidateValidationStatus | string | null | undefined
): boolean {
    const normalized = (status ?? "not_validated").trim().toLowerCase();
    return normalized === "blocked" || normalized === "not_validated";
}
