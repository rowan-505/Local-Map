import type { ImportReviewPromotionAllowedFamily } from "./import-review-promotion-config.js";
import {
    isRoadPromotionBlockingErrorCode,
    isRoadPromotionBlockingStoredIssue,
} from "./import-review-road-promotion-policy.js";
import type { ImportReviewPromotionValidationIssue } from "./import-review-promotion-validation-issues.js";

/** True when a stored validation_errors item blocks promotion for the family. */
export function isPromotionBlockingStoredIssue(
    issue: unknown,
    family: ImportReviewPromotionAllowedFamily
): boolean {
    if (family === "roads") {
        return isRoadPromotionBlockingStoredIssue(issue);
    }
    if (issue === null || issue === undefined) {
        return false;
    }
    if (typeof issue === "string") {
        const trimmed = issue.trim();
        return trimmed.length > 0;
    }
    if (typeof issue !== "object" || Array.isArray(issue)) {
        return false;
    }
    const row = issue as { severity?: unknown };
    const severity = typeof row.severity === "string" ? row.severity.trim().toLowerCase() : "error";
    return severity === "error" || severity === "unknown";
}

export function filterPromotionBlockingValidationIssues(
    issues: readonly ImportReviewPromotionValidationIssue[],
    family: ImportReviewPromotionAllowedFamily
): ImportReviewPromotionValidationIssue[] {
    if (family === "roads") {
        return issues.filter((issue) => isRoadPromotionBlockingStoredIssue(issue));
    }
    return issues.filter((issue) => issue.severity === "error" || issue.severity === "unknown");
}

export function shouldIncludeBlockingIssueCode(
    code: string,
    family: ImportReviewPromotionAllowedFamily
): boolean {
    if (family === "roads") {
        return isRoadPromotionBlockingErrorCode(code);
    }
    return code.trim().length > 0;
}
