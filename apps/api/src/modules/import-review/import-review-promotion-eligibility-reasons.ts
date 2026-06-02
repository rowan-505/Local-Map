import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import {
    filterPromotionBlockingValidationIssues,
    shouldIncludeBlockingIssueCode,
} from "./import-review-promotion-blocking-policy.js";
import type { PromotionEligibilityBucket } from "./import-review-promotion-eligibility.js";
import {
    extractValidationIssuesFromJson,
    validationIssueCodes,
    validationIssueMessages,
} from "./import-review-promotion-validation-issues.js";

export type PromotionEligibilityReasonRow = {
    match_status: string | null;
    auto_action: string | null;
    review_status: string | null;
    review_decision: string | null;
    review_note: string | null;
    promotion_status: string | null;
    external_id: string | null;
    matched_core_id: bigint | null;
    road_class_id: bigint | null;
    class_code: string | null;
    normalized_data: unknown;
    validation_errors: unknown;
    validation_warnings: unknown;
    warning_reason?: string | null;
    duplicate_core_external_id?: boolean;
    road_class_missing_no_fallback?: boolean;
    geometry_missing?: boolean;
    required_type_missing?: boolean;
    publish_batch_id?: bigint | null;
    publish_batch_status?: string | null;
    promoted_core_id?: bigint | null;
    promoted_target_id?: bigint | null;
};

const REASON_MESSAGES: Record<string, string> = {
    READY: "Eligible for promotion.",
    VALIDATION_WARNINGS: "Candidate has validation warnings.",
    WARNING_REASON: "Review warning reason recorded on candidate.",
    REVIEW_NOTE: "Review note recorded on candidate.",
    ACTIVE_PUBLISH_BATCH: "Candidate is linked to an active publish batch.",
    ALREADY_PROMOTED: "Candidate has already been promoted.",
    rejected_decision: "Candidate review decision or status is rejected or needs more review.",
    duplicate_unconfirmed:
        "Duplicate candidate match_status without review_note or merged decision.",
    manual_protected: "Candidate is manual_protected or protect_manual.",
    promotion_blocking_validation_errors: "Candidate has promotion-blocking validation_errors.",
    duplicate_external_id_in_core:
        "Active core row already exists with the same external_id for an insert candidate.",
    MISSING_REQUIRED_GEOMETRY: "Required geometry is missing for promotion.",
    MISSING_REQUIRED_TYPE_CATEGORY_CLASS:
        "Required type, category, or class is missing for promotion.",
    road_class_missing_no_fallback:
        "Road class is missing with no class_code or highway fallback.",
    other_excluded: "Candidate is excluded from promotion eligibility.",
};

function pushReason(
    codes: string[],
    messages: string[],
    code: string,
    message?: string
): void {
    const normalized = code.trim().toUpperCase();
    if (codes.includes(normalized)) {
        return;
    }
    codes.push(normalized);
    messages.push(message ?? REASON_MESSAGES[normalized] ?? REASON_MESSAGES[code] ?? code);
}

export function isRejectedDecision(row: PromotionEligibilityReasonRow): boolean {
    const decision = (row.review_decision ?? "").trim().toLowerCase();
    const status = (row.review_status ?? "").trim().toLowerCase();
    return (
        decision === "rejected" ||
        decision === "ignored" ||
        decision === "needs_more_review" ||
        status === "needs_more_review"
    );
}

export function isDuplicateUnconfirmed(row: PromotionEligibilityReasonRow): boolean {
    const ms = row.match_status ?? "";
    return (
        (ms === "duplicate_candidate" || ms === "possible_duplicate") &&
        row.review_decision !== "merged" &&
        (row.review_note ?? "").trim() === ""
    );
}

export function isManualProtected(row: PromotionEligibilityReasonRow): boolean {
    return (
        row.match_status === "manual_protected" ||
        row.auto_action === "protect_manual" ||
        row.auto_action === "manual_protected"
    );
}

export function isAlreadyPromoted(row: PromotionEligibilityReasonRow): boolean {
    const promotion = (row.promotion_status ?? "").trim().toLowerCase();
    const status = (row.review_status ?? "").trim().toLowerCase();
    return promotion === "promoted" || status === "promoted" || row.promoted_core_id != null;
}

function blockingValidationIssues(
    validationErrors: unknown,
    config: ImportReviewPublishFamilyConfig
) {
    const issues = extractValidationIssuesFromJson(validationErrors);
    return filterPromotionBlockingValidationIssues(issues, config.entityFamily);
}

export function resolvePromotionEligibilityWarningReasons(
    row: PromotionEligibilityReasonRow
): { reason_codes: string[]; reason_messages: string[] } {
    const issues = extractValidationIssuesFromJson(row.validation_warnings);
    if (issues.length > 0) {
        return {
            reason_codes: validationIssueCodes(issues).map((c) => c.toUpperCase()),
            reason_messages: validationIssueMessages(issues),
        };
    }

    const warningReason = row.warning_reason?.trim();
    if (warningReason) {
        return {
            reason_codes: ["WARNING_REASON"],
            reason_messages: [warningReason],
        };
    }

    const reviewNote = row.review_note?.trim();
    if (reviewNote) {
        return {
            reason_codes: ["REVIEW_NOTE"],
            reason_messages: [reviewNote],
        };
    }

    return {
        reason_codes: ["VALIDATION_WARNINGS"],
        reason_messages: [REASON_MESSAGES.VALIDATION_WARNINGS],
    };
}

export function resolvePromotionEligibilityBlockedReasons(
    row: PromotionEligibilityReasonRow,
    config: ImportReviewPublishFamilyConfig
): { reason_codes: string[]; reason_messages: string[] } {
    const codes: string[] = [];
    const messages: string[] = [];

    if (isRejectedDecision(row)) {
        pushReason(codes, messages, "rejected_decision");
    }
    if (isManualProtected(row)) {
        pushReason(codes, messages, "manual_protected");
    }
    if (isDuplicateUnconfirmed(row)) {
        pushReason(codes, messages, "duplicate_unconfirmed");
    }
    if (row.publish_batch_id != null) {
        pushReason(codes, messages, "ACTIVE_PUBLISH_BATCH");
        pushReason(codes, messages, `PUBLISH_BATCH_ID:${row.publish_batch_id.toString()}`);
        if (row.publish_batch_status) {
            pushReason(
                codes,
                messages,
                `PUBLISH_BATCH_STATUS:${row.publish_batch_status}`,
                `Publish batch status: ${row.publish_batch_status}.`
            );
        }
    }
    if (isAlreadyPromoted(row)) {
        pushReason(codes, messages, "ALREADY_PROMOTED");
        if (row.promoted_core_id != null) {
            pushReason(
                codes,
                messages,
                `PROMOTED_CORE_ID:${row.promoted_core_id.toString()}`,
                `Promoted core id: ${row.promoted_core_id.toString()}.`
            );
        }
        if (row.promoted_target_id != null) {
            pushReason(
                codes,
                messages,
                `PROMOTED_TARGET_ID:${row.promoted_target_id.toString()}`,
                `Promoted target id: ${row.promoted_target_id.toString()}.`
            );
        }
    }

    const blockers = blockingValidationIssues(row.validation_errors, config);
    if (blockers.length > 0) {
        pushReason(codes, messages, "promotion_blocking_validation_errors");
        for (const issue of blockers) {
            const code = issue.code.toUpperCase();
            if (shouldIncludeBlockingIssueCode(code, config.entityFamily)) {
                pushReason(codes, messages, code, issue.message);
            }
        }
    }

    if (row.duplicate_core_external_id === true) {
        pushReason(codes, messages, "duplicate_external_id_in_core");
    }

    if (row.geometry_missing === true) {
        pushReason(codes, messages, "MISSING_REQUIRED_GEOMETRY");
    }

    if (row.required_type_missing === true) {
        if (config.entityFamily === "roads") {
            pushReason(codes, messages, "road_class_missing_no_fallback");
        } else {
            pushReason(codes, messages, "MISSING_REQUIRED_TYPE_CATEGORY_CLASS");
        }
    } else if (
        config.entityFamily === "roads" &&
        row.road_class_missing_no_fallback === true
    ) {
        pushReason(codes, messages, "road_class_missing_no_fallback");
    }

    if (codes.length === 0) {
        pushReason(codes, messages, "other_excluded");
    }

    return { reason_codes: codes, reason_messages: messages };
}

export function resolvePromotionEligibilityBatchedReasons(
    row: PromotionEligibilityReasonRow
): { reason_codes: string[]; reason_messages: string[] } {
    const codes: string[] = [];
    const messages: string[] = [];
    pushReason(codes, messages, "ACTIVE_PUBLISH_BATCH");
    if (row.publish_batch_id != null) {
        pushReason(
            codes,
            messages,
            `PUBLISH_BATCH_ID:${row.publish_batch_id.toString()}`,
            `Publish batch id: ${row.publish_batch_id.toString()}.`
        );
    }
    if (row.publish_batch_status) {
        pushReason(
            codes,
            messages,
            `PUBLISH_BATCH_STATUS:${row.publish_batch_status}`,
            `Publish batch status: ${row.publish_batch_status}.`
        );
    }
    return { reason_codes: codes, reason_messages: messages };
}

export function resolvePromotionEligibilityPromotedReasons(
    row: PromotionEligibilityReasonRow
): { reason_codes: string[]; reason_messages: string[] } {
    const codes: string[] = [];
    const messages: string[] = [];
    pushReason(codes, messages, "ALREADY_PROMOTED");
    if (row.promoted_core_id != null) {
        pushReason(
            codes,
            messages,
            `PROMOTED_CORE_ID:${row.promoted_core_id.toString()}`,
            `Promoted core id: ${row.promoted_core_id.toString()}.`
        );
    }
    if (row.promoted_target_id != null) {
        pushReason(
            codes,
            messages,
            `PROMOTED_TARGET_ID:${row.promoted_target_id.toString()}`,
            `Promoted target id: ${row.promoted_target_id.toString()}.`
        );
    }
    return { reason_codes: codes, reason_messages: messages };
}

export function resolvePromotionEligibilityReasons(
    row: PromotionEligibilityReasonRow,
    config: ImportReviewPublishFamilyConfig,
    bucket: PromotionEligibilityBucket
): { reason_codes: string[]; reason_messages: string[] } {
    switch (bucket) {
        case "ready":
            return {
                reason_codes: ["READY"],
                reason_messages: [REASON_MESSAGES.READY],
            };
        case "warnings":
            return resolvePromotionEligibilityWarningReasons(row);
        case "blocked":
            return resolvePromotionEligibilityBlockedReasons(row, config);
        case "batched":
            return resolvePromotionEligibilityBatchedReasons(row);
        case "promoted":
            return resolvePromotionEligibilityPromotedReasons(row);
        default: {
            const _exhaustive: never = bucket;
            return _exhaustive;
        }
    }
}
