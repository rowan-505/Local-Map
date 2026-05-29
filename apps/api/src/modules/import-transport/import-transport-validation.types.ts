import type { ImportTransportFamily } from "./import-transport.config.js";

export const IMPORT_TRANSPORT_CANDIDATE_VALIDATION_STATUSES = [
    "not_validated",
    "valid",
    "warning",
    "blocked",
] as const;

export type ImportTransportCandidateValidationStatus =
    (typeof IMPORT_TRANSPORT_CANDIDATE_VALIDATION_STATUSES)[number];

export type ImportTransportValidationSeverity = "warning" | "error" | "critical" | "info";

export type ImportTransportValidationIssueDraft = {
    issue_code: string;
    severity: ImportTransportValidationSeverity;
    message: string;
    details?: Record<string, unknown>;
};

export type ImportTransportValidationIssueRecord = {
    id: string;
    import_batch_id: string;
    entity_kind: string | null;
    entity_id: string | null;
    entity_source_id: string | null;
    issue_code: string;
    severity: string;
    issue_status: string;
    message: string;
    details: Record<string, unknown>;
    created_at: string;
    resolved_at: string | null;
};

export type ImportTransportValidateCandidateResult = {
    family: ImportTransportFamily;
    candidate_id: string;
    validation_status: ImportTransportCandidateValidationStatus;
    issues: ImportTransportValidationIssueRecord[];
    errors: ImportTransportValidationIssueDraft[];
    warnings: ImportTransportValidationIssueDraft[];
    requires_confirmation: boolean;
    promotion_blocked: boolean;
};

export type ImportTransportBatchValidationResult = {
    import_batch_id: string;
    families: ImportTransportFamily[];
    validated_count: number;
    valid_count: number;
    warning_count: number;
    blocked_count: number;
    results_by_family: Record<
        ImportTransportFamily,
        {
            validated_count: number;
            valid_count: number;
            warning_count: number;
            blocked_count: number;
        }
    >;
};

export type ImportTransportValidationIssuesListResponse = {
    items: ImportTransportValidationIssueRecord[];
    total: number;
    limit: number;
    offset: number;
};

export const IMPORT_TRANSPORT_FAMILY_ENTITY_KIND: Record<ImportTransportFamily, string> = {
    routes: "route",
    stops: "stop",
    variants: "route_variant",
    route_stops: "route_stop",
};

export const IMPORT_TRANSPORT_STOP_DUPLICATE_DISTANCE_M = 25;
