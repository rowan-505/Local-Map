/**
 * Promotion item failure normalization for system_publish_items and batch summaries.
 */

import {
    extractPromotionFailureCause,
    type PromotionFailureCause,
} from "./import-review-promotion-failure-cause.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";

export type PromotionItemFailureInput = {
    errorMessage: string;
    entityFamily?: string | null;
    reviewCandidateId?: bigint | null;
    publishItemId?: bigint | null;
    externalId?: string | null;
    targetSchema?: string | null;
    targetTable?: string | null;
    publishAction?: string | null;
    technicalDetail?: unknown;
    failureCause?: PromotionFailureCause | null;
};

export type PromotionItemFailureRecord = {
    error_code: string;
    error_message: string;
    error_detail: Record<string, unknown>;
    entity_family: string | null;
    review_candidate_id: string | null;
    publish_item_id: string | null;
    external_id: string | null;
    target_schema: string | null;
    target_table: string | null;
};

export type PromotionFailureSample = {
    publish_item_id: string;
    entity_family: string;
    review_candidate_id: string | null;
    external_id: string | null;
    target_schema: string | null;
    target_table: string | null;
    error_code: string;
    error_message: string;
    reason: string;
};

const KNOWN_ERROR_PREFIXES = [
    "CATEGORY_REQUIRED",
    "INVALID_CATEGORY_ID",
    "INVALID_ADMIN_AREA_ID",
    "DEPENDENCY_ROUTE_MISSING",
    "DEPENDENCY_VARIANT_MISSING",
    "DEPENDENCY_STOP_MISSING",
    "GEOMETRY_MISSING",
    "GEOMETRY_INVALID",
    "INVALID_SRID",
    "TRANSPORT_PROMOTION_DEPRECATED",
] as const;

const PRISMA_NOISE_RE =
    /Invalid `prisma\.|invocation in|→ \d+ |at \/Users\/|at \/home\/|node_modules\//i;

/** Map a raw promotion error string to a stable error_code. */
export function derivePromotionErrorCode(message: string): string {
    const trimmed = message.trim();
    if (!trimmed) {
        return "PROMOTION_FAILED";
    }

    for (const code of KNOWN_ERROR_PREFIXES) {
        if (trimmed.startsWith(`${code}:`) || trimmed.startsWith(code)) {
            return code;
        }
    }

    const colonMatch = /^([A-Z][A-Z0-9_]+):/.exec(trimmed);
    if (colonMatch?.[1]) {
        return colonMatch[1];
    }

    if (/^Place promotion failed:/i.test(trimmed)) {
        const inner = trimmed.replace(/^Place promotion failed:\s*/i, "").trim();
        const innerCode = derivePromotionErrorCode(inner);
        return innerCode === "PROMOTION_FAILED" ? "PLACE_PROMOTION_FAILED" : innerCode;
    }

    if (/25P02|current transaction is aborted/i.test(trimmed)) {
        return "PROMOTION_TRANSACTION_ABORTED";
    }

    if (PRISMA_NOISE_RE.test(trimmed) || /is not a function/i.test(trimmed)) {
        return "PROMOTION_SYSTEM_ERROR";
    }

    if (/missing FROM-clause entry/i.test(trimmed)) {
        return "ROAD_PROMOTION_SQL_ERROR";
    }

    if (/duplicate/i.test(trimmed)) {
        return "DUPLICATE_CORE_ROW";
    }
    if (/geometry/i.test(trimmed)) {
        return "INVALID_GEOMETRY";
    }
    if (/category/i.test(trimmed)) {
        return "CATEGORY_REQUIRED";
    }
    if (/blocked/i.test(trimmed)) {
        return "PROMOTION_BLOCKED";
    }

    return "PROMOTION_FAILED";
}

/** Operator-facing message (no Prisma stack traces). */
export function sanitizePromotionErrorMessage(message: string, maxLength = 500): string {
    let text = message.trim();
    if (!text) {
        return "Promotion failed.";
    }

    if (/^Place promotion failed:\s*/i.test(text)) {
        text = text.replace(/^Place promotion failed:\s*/i, "").trim();
    }

    if (/25P02|current transaction is aborted/i.test(text)) {
        return "Promotion failed during database write. See publish item error for the original SQL failure.";
    }

    if (PRISMA_NOISE_RE.test(text) || /this\.prisma\.\$transaction is not a function/i.test(text)) {
        return "Promotion system error while writing to the database. Check API logs for details.";
    }

    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !PRISMA_NOISE_RE.test(line));
    if (lines.length > 0) {
        text = lines[0]!;
    }

    if (text.length > maxLength) {
        return `${text.slice(0, maxLength - 1)}…`;
    }
    return text;
}

/** JSON.stringify helper that converts bigint values to strings. */
export function stringifyPromotionPayload(value: unknown): string {
    return JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? val.toString() : val));
}

export function buildPromotionItemFailureRecord(
    input: PromotionItemFailureInput
): PromotionItemFailureRecord {
    const cause =
        input.failureCause ?? extractPromotionFailureCause(new Error(input.errorMessage));
    const error_code = derivePromotionErrorCode(cause.message || input.errorMessage);
    const error_message = sanitizePromotionErrorMessage(cause.message || input.errorMessage);
    const error_detail: Record<string, unknown> = {
        error_code,
        publish_action: input.publishAction ?? null,
        prisma_code: cause.prisma_code ?? null,
        sqlstate: cause.sqlstate ?? null,
        constraint: cause.constraint ?? null,
    };
    if (input.technicalDetail != null && typeof input.technicalDetail === "object") {
        Object.assign(error_detail, input.technicalDetail as Record<string, unknown>);
    }
    const raw = (cause.raw_message ?? input.errorMessage).trim();
    if (raw && raw !== error_message) {
        error_detail.raw_message = raw;
    }

    return {
        error_code,
        error_message,
        error_detail,
        entity_family: input.entityFamily ?? null,
        review_candidate_id:
            input.reviewCandidateId != null ? input.reviewCandidateId.toString() : null,
        publish_item_id: input.publishItemId != null ? input.publishItemId.toString() : null,
        external_id: input.externalId ?? null,
        target_schema: input.targetSchema ?? null,
        target_table: input.targetTable ?? null,
    };
}

/** JSON stored in system_publish_items.after_data for failed promotions. */
export function buildPublishItemFailureAfterData(
    record: PromotionItemFailureRecord,
    cause: PromotionFailureCause
): Record<string, unknown> {
    return {
        status: "failed",
        error_code: record.error_code,
        error_message: record.error_message,
        prisma_code: cause.prisma_code ?? null,
        sqlstate: cause.sqlstate ?? null,
        constraint: cause.constraint ?? null,
        message: record.error_message,
        family: record.entity_family,
        candidate_id: record.review_candidate_id,
        publish_item_id: record.publish_item_id,
        external_id: record.external_id,
        target_schema: record.target_schema,
        target_table: record.target_table,
        publish_action: record.error_detail.publish_action ?? null,
        error_detail: record.error_detail,
    };
}

export function buildPromoteItemFailureResult(args: {
    publishItemId: bigint;
    message: string;
    err?: unknown;
    beforeData?: unknown | null;
}): PromoteItemResult {
    const cause = extractPromotionFailureCause(args.err ?? new Error(args.message));
    return {
        publish_item_id: args.publishItemId,
        outcome: "failed",
        target_id: null,
        error_message: args.message,
        before_data: args.beforeData ?? null,
        after_data: null,
        failure_cause: cause,
    };
}

export type FamilyPromotionFailureStageDetails = {
    failed_count: number;
    sample_candidate_ids: string[];
    sample_error_messages: string[];
};

export function readableErrorFromFailedPublishItemRow(row: {
    error_message: string | null;
    after_data: unknown;
}): string {
    const after =
        row.after_data && typeof row.after_data === "object" && !Array.isArray(row.after_data)
            ? (row.after_data as Record<string, unknown>)
            : null;
    if (typeof after?.error_message === "string" && after.error_message.trim()) {
        return after.error_message.trim();
    }
    if (typeof after?.message === "string" && after.message.trim()) {
        return after.message.trim();
    }
    if (typeof row.error_message === "string" && row.error_message.trim()) {
        return sanitizePromotionErrorMessage(row.error_message);
    }
    return "Promotion failed.";
}

export function summarizeFamilyPromotionFailures(
    rows: readonly {
        review_candidate_id: bigint | null;
        error_message: string | null;
        after_data: unknown;
    }[]
): FamilyPromotionFailureStageDetails {
    const sample_candidate_ids: string[] = [];
    const sample_error_messages: string[] = [];
    const seenCandidates = new Set<string>();
    const seenMessages = new Set<string>();

    for (const row of rows) {
        if (row.review_candidate_id != null && sample_candidate_ids.length < 5) {
            const id = row.review_candidate_id.toString();
            if (!seenCandidates.has(id)) {
                seenCandidates.add(id);
                sample_candidate_ids.push(id);
            }
        }
        const msg = readableErrorFromFailedPublishItemRow(row);
        if (!seenMessages.has(msg) && sample_error_messages.length < 5) {
            seenMessages.add(msg);
            sample_error_messages.push(msg);
        }
    }

    return {
        failed_count: rows.length,
        sample_candidate_ids,
        sample_error_messages,
    };
}

export function promotionFailureSampleFromRow(row: {
    id: bigint;
    entity_family: string;
    review_candidate_id: bigint | null;
    external_id: string | null;
    target_schema: string | null;
    target_table: string | null;
    error_message: string | null;
    after_data: unknown;
}): PromotionFailureSample {
    const after =
        row.after_data && typeof row.after_data === "object" && !Array.isArray(row.after_data)
            ? (row.after_data as Record<string, unknown>)
            : null;
    const error_message = readableErrorFromFailedPublishItemRow(row);
    const error_code =
        typeof after?.error_code === "string" && after.error_code.trim()
            ? after.error_code.trim()
            : derivePromotionErrorCode(
                  typeof row.error_message === "string" && row.error_message.trim()
                      ? row.error_message
                      : error_message
              );

    return {
        publish_item_id: row.id.toString(),
        entity_family: row.entity_family,
        review_candidate_id:
            row.review_candidate_id != null ? row.review_candidate_id.toString() : null,
        external_id: row.external_id,
        target_schema: row.target_schema,
        target_table: row.target_table,
        error_code,
        error_message,
        reason: error_message,
    };
}

/** Keep up to `maxDistinct` samples with unique error_code (order preserved). */
export function dedupePromotionFailureSamples(
    samples: readonly PromotionFailureSample[],
    maxDistinct = 5
): PromotionFailureSample[] {
    const seen = new Set<string>();
    const out: PromotionFailureSample[] = [];
    for (const sample of samples) {
        const key = sample.error_code.trim() || sample.error_message;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(sample);
        if (out.length >= maxDistinct) {
            break;
        }
    }
    return out;
}

export function appendSampleFailureHint(baseSummary: string, samples: readonly PromotionFailureSample[]): string {
    if (samples.length === 0) {
        return baseSummary;
    }
    const first = samples[0]!;
    const hint = `${first.error_code}: ${first.error_message}`;
    if (baseSummary.includes(first.error_message)) {
        return baseSummary;
    }
    return `${baseSummary} Example: ${hint}`;
}
