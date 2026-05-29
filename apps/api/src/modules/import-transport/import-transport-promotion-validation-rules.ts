import {
    partitionValidationIssues,
    resolveValidationStatusFromIssues,
    type RouteStopValidationInput,
    type RouteValidationInput,
    type StopValidationInput,
    type VariantValidationInput,
    validateRouteCandidate,
    validateRouteStopCandidate,
    validateStopCandidate,
    validateVariantCandidate,
} from "./import-transport-validation-rules.js";
import type { ImportTransportValidationIssueDraft } from "./import-transport-validation.types.js";
import type { ImportTransportPromotionItemValidationStatus } from "./import-transport-promotion-validation.types.js";

export type PromotionItemValidationOutcome = {
    item_validation_status: ImportTransportPromotionItemValidationStatus;
    error_message: string | null;
    issues: ImportTransportValidationIssueDraft[];
};

export function mapIssuesToItemValidationStatus(
    issues: ImportTransportValidationIssueDraft[]
): ImportTransportPromotionItemValidationStatus {
    const status = resolveValidationStatusFromIssues(issues);
    if (status === "blocked") {
        return "blocked";
    }
    if (status === "warning") {
        return "warning";
    }
    return "valid";
}

export function validatePromotionRouteItem(input: RouteValidationInput): PromotionItemValidationOutcome {
    const issues = validateRouteCandidate(input);
    return buildOutcome(issues);
}

export function validatePromotionStopItem(input: StopValidationInput): PromotionItemValidationOutcome {
    const issues = validateStopCandidate(input);
    return buildOutcome(issues);
}

export function validatePromotionVariantItem(
    input: VariantValidationInput,
    dependency: { route_promotable: boolean; route_id: string | null }
): PromotionItemValidationOutcome {
    const issues = validateVariantCandidate(input);
    if (!dependency.route_promotable) {
        issues.unshift({
            issue_code: "parent_route_not_promotable",
            severity: "error",
            message: "Parent route is not promoted or promotable for this batch.",
            details: { raw_route_id: dependency.route_id },
        });
    }
    return buildOutcome(issues);
}

export function validatePromotionRouteStopItem(
    input: RouteStopValidationInput,
    dependency: {
        variant_promotable: boolean;
        stop_promotable: boolean;
        raw_route_variant_id: string | null;
        raw_stop_id: string | null;
    }
): PromotionItemValidationOutcome {
    const issues = validateRouteStopCandidate(input);
    if (!dependency.variant_promotable) {
        issues.unshift({
            issue_code: "parent_variant_not_promotable",
            severity: "error",
            message: "Parent route variant is not promoted or promotable for this batch.",
            details: { raw_route_variant_id: dependency.raw_route_variant_id },
        });
    }
    if (!dependency.stop_promotable) {
        issues.unshift({
            issue_code: "parent_stop_not_promotable",
            severity: "error",
            message: "Parent stop is not promoted or promotable for this batch.",
            details: { raw_stop_id: dependency.raw_stop_id },
        });
    }
    return buildOutcome(issues);
}

function buildOutcome(issues: ImportTransportValidationIssueDraft[]): PromotionItemValidationOutcome {
    const itemStatus = mapIssuesToItemValidationStatus(issues);
    const { errors, warnings } = partitionValidationIssues(issues);
    const primary = errors[0] ?? warnings[0];
    return {
        item_validation_status: itemStatus,
        error_message: primary?.message ?? null,
        issues,
    };
}

export function batchCanPromote(
    summaries: Array<{ blocked: number; pending: number }>
): boolean {
    return summaries.every((row) => row.blocked === 0 && row.pending === 0);
}

export function batchValidationStatusFromSummaries(
    summaries: Array<{ valid: number; warning: number; blocked: number; skipped: number; pending: number }>
): string {
    const totals = summaries.reduce(
        (acc, row) => ({
            valid: acc.valid + row.valid,
            warning: acc.warning + row.warning,
            blocked: acc.blocked + row.blocked,
            skipped: acc.skipped + row.skipped,
            pending: acc.pending + row.pending,
        }),
        { valid: 0, warning: 0, blocked: 0, skipped: 0, pending: 0 }
    );
    if (totals.blocked > 0) {
        return "failed";
    }
    if (totals.pending > 0) {
        return "in_progress";
    }
    if (totals.warning > 0) {
        return "passed_with_warnings";
    }
    return "passed";
}
