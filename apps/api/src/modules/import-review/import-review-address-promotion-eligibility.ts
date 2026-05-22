import type { AddressValidationIssue } from "./import-review-address-validation.types.js";

export type AddressPromotionCandidateSnapshot = {
    id: bigint;
    external_id: string | null;
    review_status: string | null;
    review_decision: string | null;
    validation_status: string | null;
    promotion_status: string | null;
    promotion_blockers: unknown;
    promotion_warnings: unknown;
    promoted_core_address_id: bigint | null;
    point_geom_present: boolean;
};

export type AddressPromotionEligibility = {
    eligible: boolean;
    reasons: string[];
    blockers: AddressValidationIssue[];
};

function jsonbArrayLength(value: unknown): number {
    if (!value || typeof value !== "object" || !Array.isArray(value)) {
        return 0;
    }
    return value.length;
}

function parseIssues(value: unknown, severity: "error" | "warning"): AddressValidationIssue[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const out: AddressValidationIssue[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const row = item as Record<string, unknown>;
        const code = typeof row.code === "string" ? row.code : "unknown";
        const message = typeof row.message === "string" ? row.message : code;
        const sev =
            row.severity === "error" || row.severity === "warning"
                ? row.severity
                : severity;
        if (sev !== severity) {
            continue;
        }
        out.push({
            code,
            message,
            severity: sev,
            ...(typeof row.field === "string" ? { field: row.field } : {}),
            ...(typeof row.component_id === "string"
                ? { component_id: row.component_id }
                : {}),
        });
    }
    return out;
}

const VALID_FOR_PROMOTION = new Set(["valid", "valid_with_warnings", "passed"]);

export function assessAddressPromotionEligibility(args: {
    candidate: AddressPromotionCandidateSnapshot;
    confirmWarnings: boolean;
    hasCoreDuplicate: boolean;
    coreDuplicateMessage: string | null;
    composedDisplayAddress: string | null;
}): AddressPromotionEligibility {
    const reasons: string[] = [];
    const blockers: AddressValidationIssue[] = [];
    const { candidate } = args;

    const reviewStatus = (candidate.review_status ?? "").trim().toLowerCase();
    if (reviewStatus !== "approved") {
        reasons.push("review_status_not_approved");
    }

    const validationStatus = (candidate.validation_status ?? "").trim().toLowerCase();
    if (validationStatus === "blocked" || validationStatus === "failed") {
        reasons.push("validation_blocked");
    } else if (!VALID_FOR_PROMOTION.has(validationStatus)) {
        reasons.push("validation_not_ready");
    }

    if (validationStatus === "valid_with_warnings" && !args.confirmWarnings) {
        reasons.push("confirm_warnings_required");
    }

    const promotionStatus = (candidate.promotion_status ?? "").trim().toLowerCase();
    if (promotionStatus === "promoted" || candidate.promoted_core_address_id !== null) {
        reasons.push("already_promoted");
    }

    if (jsonbArrayLength(candidate.promotion_blockers) > 0) {
        reasons.push("promotion_blockers_present");
        blockers.push(...parseIssues(candidate.promotion_blockers, "error"));
    }

    if (!candidate.point_geom_present) {
        reasons.push("point_geom_missing");
    }

    if (!args.composedDisplayAddress?.trim()) {
        reasons.push("generated_full_address_empty");
    }

    if (args.hasCoreDuplicate) {
        reasons.push("duplicate_core_address");
        blockers.push({
            code: "duplicate_core_address",
            message:
                args.coreDuplicateMessage ??
                "Possible duplicate core.core_addresses row detected.",
            severity: "error",
        });
    }

    return {
        eligible: reasons.length === 0,
        reasons,
        blockers,
    };
}
