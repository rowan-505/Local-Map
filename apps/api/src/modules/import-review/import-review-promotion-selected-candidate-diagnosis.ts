import { Prisma, type PrismaClient } from "@prisma/client";

import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import type { CreatePublishBatchFilters } from "./import-review-promotion-create-batch.js";
import type {
    ImportReviewPromotionSelectedCandidateErrorDetails,
    ImportReviewPromotionSelectedCandidateReason,
} from "./import-review-promotion.errors.js";
import {
    IMPORT_REVIEW_PUBLISH_ITEM_RETRY_ALLOWED_STATUSES,
    IMPORT_REVIEW_SELECTED_PROMOTION_BLOCKING_BATCH_STATUSES,
} from "./import-review-promotion.types.js";

export type SelectedCandidateEligibilityRow = {
    id: bigint;
    review_batch_id: bigint;
    review_status: string | null;
    review_decision: string | null;
    promotion_status: string | null;
    match_status: string | null;
    auto_action: string | null;
    review_note: string | null;
    validation_errors: unknown;
    validation_warnings: unknown;
    promoted_core_id: bigint | null;
    promoted_at: Date | string | null;
};

export type SelectedCandidateIneligibilityDiagnosis = {
    reason: ImportReviewPromotionSelectedCandidateReason;
    message: string;
    details: ImportReviewPromotionSelectedCandidateErrorDetails;
};

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

function duplicateGuardFails(row: SelectedCandidateEligibilityRow): boolean {
    const match = (row.match_status ?? "").trim();
    const note = (row.review_note ?? "").trim();
    if (match !== "duplicate_candidate" && match !== "possible_duplicate") {
        return false;
    }
    return note.length === 0;
}

function promotionStatusAllowed(row: SelectedCandidateEligibilityRow): boolean {
    const status = (row.promotion_status ?? "").trim();
    if (!status) {
        return true;
    }
    return ["not_ready", "ready", "batched", "failed"].includes(status);
}

function reviewStatusEligibleForSelectedRetry(row: SelectedCandidateEligibilityRow): boolean {
    const status = (row.review_status ?? "").trim();
    return (
        status === "approved" ||
        status === "promotion_failed" ||
        status === "ignored" ||
        status === "merged"
    );
}

function reviewDecisionEligibleForSelectedApply(decision: string): boolean {
    const d = decision.trim().toLowerCase();
    return [
        "approved",
        "replace_existing",
        "merge_fields",
        "insert_separate",
        "confirm_soft_delete",
        "keep_existing",
        "ignore_import",
        "mark_duplicate",
        "merged",
    ].includes(d);
}

function jsonArrayLength(value: unknown): number {
    if (!value || typeof value !== "object") {
        return 0;
    }
    if (Array.isArray(value)) {
        return value.length;
    }
    return 0;
}

function parseValidationIssues(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"));
}

function extractMissingFields(validationErrors: unknown): string[] {
    const fields = new Set<string>();
    for (const issue of parseValidationIssues(validationErrors)) {
        const code = typeof issue.code === "string" ? issue.code.trim() : "";
        const field = typeof issue.field === "string" ? issue.field.trim() : "";
        if (code === "required_field_missing" && field) {
            fields.add(field);
        }
    }
    return [...fields];
}

function hasBlockingValidationErrors(
    config: ImportReviewPublishFamilyConfig,
    validationErrors: unknown
): boolean {
    if (config.entityFamily === "roads") {
        return jsonArrayLength(validationErrors) > 0;
    }
    return jsonArrayLength(validationErrors) > 0;
}

function toIso(value: Date | string | null): string | null {
    if (value == null) {
        return null;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}

function baseDetails(
    row: SelectedCandidateEligibilityRow,
    config: ImportReviewPublishFamilyConfig
): ImportReviewPromotionSelectedCandidateErrorDetails {
    return {
        review_status: row.review_status,
        review_decision: row.review_decision,
        promoted_core_id: row.promoted_core_id?.toString() ?? null,
        promoted_at: toIso(row.promoted_at),
        target_table: config.coreTargetTable,
        validation_errors: row.validation_errors ?? null,
        missing_fields: extractMissingFields(row.validation_errors),
        active_publish_batch_id: null,
    };
}

function isPromotedRow(row: SelectedCandidateEligibilityRow): boolean {
    const promotionStatus = (row.promotion_status ?? "").trim();
    return promotionStatus === "promoted" || row.promoted_core_id != null;
}

export function diagnoseSelectedCandidateFromRow(args: {
    config: ImportReviewPublishFamilyConfig;
    reviewBatchId: bigint;
    row: SelectedCandidateEligibilityRow;
    filters: CreatePublishBatchFilters;
    activePublishBatchId: bigint | null;
}): SelectedCandidateIneligibilityDiagnosis | null {
    const { config, reviewBatchId, row, filters, activePublishBatchId } = args;
    const candidateId = row.id.toString();
    const family = config.entityFamily;
    const details = baseDetails(row, config);

    if (isPromotedRow(row)) {
        return {
            reason: "already_promoted",
            message: formatAlreadyPromotedMessage(candidateId, family, details),
            details,
        };
    }

    if (activePublishBatchId != null) {
        details.active_publish_batch_id = activePublishBatchId.toString();
        return {
            reason: "already_in_active_publish_batch",
            message: `Candidate ${candidateId} is already in active publish batch #${activePublishBatchId.toString()} and cannot be added again until that batch is finished or rolled back.`,
            details,
        };
    }

    if (row.review_batch_id !== reviewBatchId) {
        details.expected_review_batch_id = reviewBatchId.toString();
        details.actual_review_batch_id = row.review_batch_id.toString();
        return {
            reason: "wrong_review_batch",
            message: `Candidate ${candidateId} belongs to review batch ${row.review_batch_id.toString()}, not ${reviewBatchId.toString()}.`,
            details,
        };
    }

    if (!reviewStatusEligibleForSelectedRetry(row)) {
        const reviewStatus = (row.review_status ?? "").trim();
        return {
            reason: "review_status_not_ready",
            message: `Candidate ${candidateId} has review_status "${reviewStatus || "(empty)"}"; approved or promotion_failed (retry) is required.`,
            details,
        };
    }

    const reviewDecision = (row.review_decision ?? "").trim();
    if (!reviewDecisionEligibleForSelectedApply(reviewDecision)) {
        return {
            reason: "not_approved",
            message: `Candidate ${candidateId} has review_decision "${reviewDecision || "(empty)"}"; an Apply-batch decision is required for promotion.`,
            details,
        };
    }

    // Legacy filter.review_decision === 'approved' still means "apply-ready", not literal storage.
    if (
        filters.review_decision === "approved" &&
        !reviewDecisionEligibleForSelectedApply(reviewDecision)
    ) {
        return {
            reason: "not_approved",
            message: `Candidate ${candidateId} has review_decision "${reviewDecision || "(empty)"}"; an Apply-batch decision is required for promotion.`,
            details,
        };
    }

    const missingFields = extractMissingFields(row.validation_errors);
    if (missingFields.length > 0) {
        details.missing_fields = missingFields;
        return {
            reason: "missing_required_field",
            message: `Candidate ${candidateId} is missing required field(s) for promotion: ${missingFields.join(", ")}.`,
            details,
        };
    }

    if (hasBlockingValidationErrors(config, row.validation_errors)) {
        return {
            reason: "validation_blocked",
            message: `Candidate ${candidateId} has validation errors that block promotion in family "${family}".`,
            details,
        };
    }

    if ((row.match_status ?? "").trim() === "manual_protected") {
        return {
            reason: "manual_protected",
            message: `Candidate ${candidateId} is manual_protected and cannot be added to a publish batch.`,
            details,
        };
    }

    if ((row.auto_action ?? "").trim() === "protect_manual") {
        return {
            reason: "manual_protected",
            message: `Candidate ${candidateId} is marked protect_manual and cannot be added to a publish batch.`,
            details,
        };
    }

    if (duplicateGuardFails(row)) {
        return {
            reason: "duplicate_needs_review_note",
            message: `Candidate ${candidateId} is a duplicate_candidate/possible_duplicate without a review note and cannot be promoted.`,
            details,
        };
    }

    if (!promotionStatusAllowed(row)) {
        return {
            reason: "promotion_status_not_ready",
            message: `Candidate ${candidateId} has promotion_status "${(row.promotion_status ?? "").trim() || "(empty)"}" which is not eligible for a new publish batch.`,
            details,
        };
    }

    return null;
}

function formatAlreadyPromotedMessage(
    candidateId: string,
    family: string,
    details: ImportReviewPromotionSelectedCandidateErrorDetails
): string {
    const parts = [`Candidate ${candidateId} was already promoted`];
    if (details.target_table) {
        parts.push(`to ${details.target_table}`);
    }
    if (details.promoted_core_id) {
        parts.push(`(core id ${details.promoted_core_id})`);
    }
    if (details.promoted_at) {
        parts.push(`on ${details.promoted_at}`);
    }
    parts.push(`in family "${family}".`);
    return parts.join(" ");
}

export async function loadSelectedCandidateEligibilityRow(
    prisma: PrismaClient,
    config: ImportReviewPublishFamilyConfig,
    candidateId: bigint
): Promise<SelectedCandidateEligibilityRow | null> {
    const a = config.tableAlias;
    const rows = await prisma.$queryRaw<SelectedCandidateEligibilityRow[]>`
        SELECT
            ${col(a, "id")} AS id,
            ${col(a, "review_batch_id")} AS review_batch_id,
            ${col(a, "review_status")} AS review_status,
            ${col(a, "review_decision")} AS review_decision,
            ${col(a, "promotion_status")} AS promotion_status,
            ${col(a, "match_status")} AS match_status,
            ${col(a, "auto_action")} AS auto_action,
            ${col(a, "review_note")} AS review_note,
            ${col(a, "validation_errors")} AS validation_errors,
            ${col(a, "validation_warnings")} AS validation_warnings,
            ${col(a, "promoted_core_id")} AS promoted_core_id,
            ${col(a, "promoted_at")} AS promoted_at
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        WHERE ${col(a, "id")} = ${candidateId}
        LIMIT 1
    `;
    return rows[0] ?? null;
}

export async function findActivePublishBatchIdForCandidate(
    prisma: PrismaClient,
    config: ImportReviewPublishFamilyConfig,
    candidateId: bigint
): Promise<bigint | null> {
    const blockingStatuses = IMPORT_REVIEW_SELECTED_PROMOTION_BLOCKING_BATCH_STATUSES.map(
        (s) => Prisma.sql`${s}`
    );
    const retryAllowedItemStatuses = IMPORT_REVIEW_PUBLISH_ITEM_RETRY_ALLOWED_STATUSES.map(
        (s) => Prisma.sql`${s}`
    );
    const rows = await prisma.$queryRaw<{ publish_batch_id: bigint }[]>`
        SELECT spb.id AS publish_batch_id
        FROM system.system_publish_items AS spi
        INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
        WHERE spi.review_candidate_table = ${config.candidateTable}
          AND spi.review_candidate_id = ${candidateId}
          AND spb.status IN (${Prisma.join(blockingStatuses)})
          AND COALESCE(spi.publish_status, 'pending') NOT IN (${Prisma.join(retryAllowedItemStatuses)})
        LIMIT 1
    `;
    return rows[0]?.publish_batch_id ?? null;
}

/** Uses same gates as selected publish-batch SQL; returns null when the row would be included. */
export async function diagnoseUnresolvedSelectedCandidate(
    prisma: PrismaClient,
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    candidateId: bigint,
    filters: CreatePublishBatchFilters
): Promise<SelectedCandidateIneligibilityDiagnosis> {
    const row = await loadSelectedCandidateEligibilityRow(prisma, config, candidateId);
    if (!row) {
        const details: ImportReviewPromotionSelectedCandidateErrorDetails = {
            review_status: null,
            review_decision: null,
            promoted_core_id: null,
            promoted_at: null,
            target_table: config.coreTargetTable,
            validation_errors: null,
            missing_fields: [],
            active_publish_batch_id: null,
            expected_family: config.entityFamily,
        };
        return {
            reason: "not_found",
            message: `Candidate ${candidateId.toString()} was not found for family "${config.entityFamily}".`,
            details,
        };
    }

    const activePublishBatchId = await findActivePublishBatchIdForCandidate(prisma, config, candidateId);
    const diagnosis = diagnoseSelectedCandidateFromRow({
        config,
        reviewBatchId,
        row,
        filters,
        activePublishBatchId,
    });

    if (diagnosis) {
        return diagnosis;
    }

    const details = baseDetails(row, config);
    return {
        reason: "not_eligible",
        message: `Candidate ${candidateId.toString()} is not eligible for promotion in family "${config.entityFamily}".`,
        details,
    };
}
