/**
 * Normalizes validation_errors / validation_warnings JSON arrays for promotion UI.
 * Supports object items ({ code, message, severity }) and string items ("ROAD_TOO_SHORT").
 */

export type ImportReviewPromotionValidationIssue = {
    code: string;
    message: string;
    severity: "error" | "warning" | "info" | "unknown";
};

function normalizeSeverity(value: unknown): ImportReviewPromotionValidationIssue["severity"] {
    if (typeof value !== "string") {
        return "unknown";
    }
    const s = value.trim().toLowerCase();
    if (s === "error" || s === "warning" || s === "info") {
        return s;
    }
    return "unknown";
}

function issueFromString(raw: string): ImportReviewPromotionValidationIssue {
    const code = raw.trim();
    return {
        code,
        message: code,
        severity: "unknown",
    };
}

function issueFromObject(row: Record<string, unknown>): ImportReviewPromotionValidationIssue {
    const code =
        typeof row.code === "string" && row.code.trim() !== ""
            ? row.code.trim()
            : typeof row.message === "string" && row.message.trim() !== ""
              ? row.message.trim()
              : "(no code)";
    const message =
        typeof row.message === "string" && row.message.trim() !== ""
            ? row.message.trim()
            : code;
    return {
        code,
        message,
        severity: normalizeSeverity(row.severity),
    };
}

/** Extract issues from a stored JSON array (objects and/or strings). */
export function extractValidationIssuesFromJson(value: unknown): ImportReviewPromotionValidationIssue[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const out: ImportReviewPromotionValidationIssue[] = [];
    for (const item of value) {
        if (typeof item === "string") {
            const trimmed = item.trim();
            if (trimmed.length > 0) {
                out.push(issueFromString(trimmed));
            }
            continue;
        }
        if (item && typeof item === "object" && !Array.isArray(item)) {
            out.push(issueFromObject(item as Record<string, unknown>));
        }
    }
    return out;
}

export function validationIssueCodes(issues: readonly ImportReviewPromotionValidationIssue[]): string[] {
    return issues.map((i) => i.code);
}

export function validationIssueMessages(issues: readonly ImportReviewPromotionValidationIssue[]): string[] {
    return issues.map((i) => i.message);
}
