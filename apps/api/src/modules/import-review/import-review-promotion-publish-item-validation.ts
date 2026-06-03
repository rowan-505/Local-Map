/**
 * Publish-item validation_result is the authority for the current promotion run.
 * Candidate validation_errors may be stale after batch validation.
 */

import type { SimplePromotionValidationIssue } from "./import-review-promotion-simple-validation.js";

/** Status values stored on system_publish_items.validation_result.status */
export type PublishItemValidationStatus = "ready" | "warning" | "blocked" | "valid" | "skipped";

const READY_STATUSES = new Set<PublishItemValidationStatus>(["ready", "valid"]);
const WARNING_STATUSES = new Set<PublishItemValidationStatus>(["warning"]);
const BLOCKED_STATUSES = new Set<PublishItemValidationStatus>(["blocked"]);

export type ParsedPublishItemValidationResult = {
    status: PublishItemValidationStatus | null;
    errors: SimplePromotionValidationIssue[];
    warnings: SimplePromotionValidationIssue[];
    issues: Array<SimplePromotionValidationIssue & { severity: "error" | "warning" | "info" }>;
};

export type PublishItemPromotionGateInput = {
    confirm_warnings?: boolean;
    /** Non-empty operator note when promoting items with warnings. */
    promotion_note?: string;
    warning_confirmation_note?: string;
    review_note?: string;
};

function normalizeStoredStatus(raw: unknown): PublishItemValidationStatus | null {
    if (typeof raw !== "string") {
        return null;
    }
    const s = raw.trim().toLowerCase();
    if (
        s === "ready" ||
        s === "warning" ||
        s === "blocked" ||
        s === "valid" ||
        s === "skipped"
    ) {
        return s;
    }
    return null;
}

function issueFromStored(
    row: Record<string, unknown>,
    severity: "error" | "warning" | "info"
): SimplePromotionValidationIssue & { severity: typeof severity } {
    const code =
        typeof row.code === "string" && row.code.trim() !== "" ? row.code.trim() : "unknown";
    const message =
        typeof row.message === "string" && row.message.trim() !== "" ? row.message.trim() : code;
    const field = typeof row.field === "string" && row.field.trim() !== "" ? row.field : undefined;
    return { code, message, severity, ...(field !== undefined ? { field } : {}) };
}

function issuesFromArray(value: unknown, severity: "error" | "warning"): SimplePromotionValidationIssue[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const out: SimplePromotionValidationIssue[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
        }
        const row = item as Record<string, unknown>;
        const storedSeverity =
            typeof row.severity === "string" ? row.severity.trim().toLowerCase() : severity;
        if (storedSeverity === "info") {
            continue;
        }
        if (storedSeverity === "error" || storedSeverity === "warning") {
            const parsed = issueFromStored(row, storedSeverity);
            out.push({
                code: parsed.code,
                message: parsed.message,
                ...(parsed.field !== undefined ? { field: parsed.field } : {}),
            });
            continue;
        }
        out.push(issueFromStored(row, severity));
    }
    return out;
}

/** Parse validation_result JSON from system_publish_items. */
export function parsePublishItemValidationResult(
    value: unknown
): ParsedPublishItemValidationResult {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { status: null, errors: [], warnings: [], issues: [] };
    }
    const o = value as Record<string, unknown>;
    const status = normalizeStoredStatus(o.status);
    const errors = issuesFromArray(o.errors, "error");
    const warnings = issuesFromArray(o.warnings, "warning");
    const legacyIssues = issuesFromArray(o.issues, "error");
    const mergedErrors = errors.length > 0 ? errors : legacyIssues.filter(() => status === "blocked");
    const mergedWarnings =
        warnings.length > 0 ?
            warnings
        :   legacyIssues.filter((i) => {
              const row = i as SimplePromotionValidationIssue & { severity?: string };
              return row.severity === "warning";
          });

    const issues: ParsedPublishItemValidationResult["issues"] = [
        ...mergedErrors.map((i) => ({ ...i, severity: "error" as const })),
        ...mergedWarnings.map((i) => ({ ...i, severity: "warning" as const })),
    ];

    return {
        status,
        errors: mergedErrors,
        warnings: mergedWarnings,
        issues,
    };
}

export function resolvePromotionNote(input: PublishItemPromotionGateInput): string | undefined {
    const note =
        input.promotion_note?.trim() ||
        input.warning_confirmation_note?.trim() ||
        input.review_note?.trim();
    return note || undefined;
}

export function isPublishItemValidationBlocked(status: PublishItemValidationStatus | null): boolean {
    return status !== null && BLOCKED_STATUSES.has(status);
}

export function isPublishItemValidationReady(status: PublishItemValidationStatus | null): boolean {
    return status !== null && READY_STATUSES.has(status);
}

export function isPublishItemValidationWarning(status: PublishItemValidationStatus | null): boolean {
    return status !== null && WARNING_STATUSES.has(status);
}

/**
 * Whether a publish item may be promoted for this run.
 * Ignores candidate validation_errors — only validation_result counts.
 */
export function canPromotePublishItem(
    validationResult: unknown,
    input: PublishItemPromotionGateInput = {}
): boolean {
    return publishItemPromotionBlockReason(validationResult, input) === null;
}

export function publishItemPromotionBlockReason(
    validationResult: unknown,
    input: PublishItemPromotionGateInput = {}
): string | null {
    const parsed = parsePublishItemValidationResult(validationResult);
    if (parsed.status === null) {
        return "Publish item has no validation_result; run batch validation first.";
    }
    if (parsed.status === "skipped") {
        return "Publish item validation was skipped for this family.";
    }
    if (isPublishItemValidationBlocked(parsed.status)) {
        return "Publish item validation_result is blocked.";
    }
    if (isPublishItemValidationWarning(parsed.status)) {
        if (input.confirm_warnings !== true) {
            return "Publish item has warnings; confirm_warnings=true is required.";
        }
        if (!resolvePromotionNote(input)) {
            return "Publish item has warnings; a non-empty promotion note is required.";
        }
    }
    if (!isPublishItemValidationReady(parsed.status) && !isPublishItemValidationWarning(parsed.status)) {
        return `Publish item validation_result status "${parsed.status}" is not promotable.`;
    }
    return null;
}

/** Map simple engine output to publish-item JSON (authority for promotion run). */
export function buildPublishItemValidationResultJson(args: {
    status: "ready" | "warning" | "blocked";
    errors: SimplePromotionValidationIssue[];
    warnings: SimplePromotionValidationIssue[];
}): {
    status: PublishItemValidationStatus;
    errors: Array<SimplePromotionValidationIssue & { severity: "error" }>;
    warnings: Array<SimplePromotionValidationIssue & { severity: "warning" }>;
    issues: Array<SimplePromotionValidationIssue & { severity: "error" | "warning" }>;
} {
    const errors = args.errors.map((e) => ({ ...e, severity: "error" as const }));
    const warnings = args.warnings.map((w) => ({ ...w, severity: "warning" as const }));
    return {
        status: args.status,
        errors,
        warnings,
        issues: [...errors, ...warnings],
    };
}

/** Legacy batch summary buckets accept both ready and valid. */
export function publishItemStatusCountsAsLegacy(validOrReady: number, warning: number, blocked: number): {
    valid_count: number;
    ready_count: number;
    warning_count: number;
    blocked_count: number;
} {
    return {
        valid_count: validOrReady,
        ready_count: validOrReady,
        warning_count: warning,
        blocked_count: blocked,
    };
}
