/**
 * Import Review three-axis status model (compatibility-first).
 *
 * Axes (API meanings):
 * - comparison_status  ← match_status column
 * - review_decision    ← review_decision column (NULL/empty = pending)
 * - apply_status       ← promotion_status column (mapped)
 *
 * auto_action and review_status remain stored for legacy gates/history but are
 * not primary UI states. Publish batch/item status is a separate lifecycle.
 */

/** Human-decision comparison classes uploaded to import_review. */
export const IMPORT_REVIEW_COMPARISON_STATUS_VALUES = [
    "duplicate",
    "conflict",
    "manual_protected",
    "verified_conflict",
    "possible_delete",
] as const;

export type ImportReviewComparisonStatus =
    (typeof IMPORT_REVIEW_COMPARISON_STATUS_VALUES)[number];

/** Target review decisions (pending is represented as NULL in DB storage). */
export const IMPORT_REVIEW_TARGET_DECISION_VALUES = [
    "pending",
    "keep_existing",
    "replace_existing",
    "merge_fields",
    "insert_separate",
    "ignore_import",
    "mark_duplicate",
    "confirm_soft_delete",
    "needs_more_review",
] as const;

export type ImportReviewTargetDecision =
    (typeof IMPORT_REVIEW_TARGET_DECISION_VALUES)[number];

/** Legacy decisions still accepted for history / transition. */
export const IMPORT_REVIEW_LEGACY_DECISION_VALUES = [
    "approved",
    "rejected",
    "ignored",
    "merged",
    "needs_more_review",
] as const;

export type ImportReviewLegacyDecision =
    (typeof IMPORT_REVIEW_LEGACY_DECISION_VALUES)[number];

/** All decisions the API accepts on write (pending excluded — use clear/null). */
export const IMPORT_REVIEW_WRITABLE_DECISION_VALUES = [
    "keep_existing",
    "replace_existing",
    "merge_fields",
    "insert_separate",
    "ignore_import",
    "mark_duplicate",
    "confirm_soft_delete",
    "needs_more_review",
    // legacy aliases (normalized on write when possible)
    "approved",
    "rejected",
    "ignored",
    "merged",
] as const;

export type ImportReviewWritableDecision =
    (typeof IMPORT_REVIEW_WRITABLE_DECISION_VALUES)[number];

export const IMPORT_REVIEW_APPLY_STATUS_VALUES = [
    "not_applied",
    "ready",
    "applying",
    "applied",
    "failed",
] as const;

export type ImportReviewApplyStatus =
    (typeof IMPORT_REVIEW_APPLY_STATUS_VALUES)[number];

/** Legacy promotion_status values still stored under current CHECKs. */
export const IMPORT_REVIEW_LEGACY_PROMOTION_STATUS_VALUES = [
    "not_ready",
    "ready",
    "batched",
    "promoting",
    "promoted",
    "failed",
    "skipped",
] as const;

export type ImportReviewLegacyPromotionStatus =
    (typeof IMPORT_REVIEW_LEGACY_PROMOTION_STATUS_VALUES)[number];

/** Decisions that mean “ready to write core” (core insert/update/merge/soft-delete). */
export const IMPORT_REVIEW_APPLY_READY_DECISIONS = [
    "replace_existing",
    "merge_fields",
    "insert_separate",
    "confirm_soft_delete",
    "approved", // legacy
] as const;

/** Decisions that close the conflict without a core write (publish_action=skip). */
export const IMPORT_REVIEW_SKIP_APPLY_DECISIONS = [
    "keep_existing",
    "ignore_import",
    "mark_duplicate",
    "merged", // legacy alias of mark_duplicate
] as const;

/**
 * Decisions eligible for an Apply publish batch (core-write + skip).
 * needs_more_review stays out of Apply.
 */
export const IMPORT_REVIEW_APPLY_BATCH_DECISIONS = [
    ...IMPORT_REVIEW_APPLY_READY_DECISIONS,
    ...IMPORT_REVIEW_SKIP_APPLY_DECISIONS,
] as const;

const APPLY_READY_SET = new Set<string>(IMPORT_REVIEW_APPLY_READY_DECISIONS);
const SKIP_APPLY_SET = new Set<string>(IMPORT_REVIEW_SKIP_APPLY_DECISIONS);
const APPLY_BATCH_SET = new Set<string>(IMPORT_REVIEW_APPLY_BATCH_DECISIONS);

/** SQL IN-list for core-write review_decision (includes legacy approved). */
export const IMPORT_REVIEW_APPLY_READY_DECISION_SQL_IN =
    "('approved', 'replace_existing', 'merge_fields', 'insert_separate', 'confirm_soft_delete')";

/** SQL IN-list for skip Apply decisions. */
export const IMPORT_REVIEW_SKIP_APPLY_DECISION_SQL_IN =
    "('keep_existing', 'ignore_import', 'mark_duplicate', 'merged')";

/** SQL IN-list for any Apply-batch decision (write + skip). */
export const IMPORT_REVIEW_APPLY_BATCH_DECISION_SQL_IN =
    "('approved', 'replace_existing', 'merge_fields', 'insert_separate', 'confirm_soft_delete', 'keep_existing', 'ignore_import', 'mark_duplicate', 'merged')";

const COMPARISON_FROM_STORED: Record<string, ImportReviewComparisonStatus> = {
    duplicate: "duplicate",
    duplicate_candidate: "duplicate",
    possible_duplicate: "duplicate",
    conflict: "conflict",
    needs_review: "conflict",
    verified_conflict: "verified_conflict",
    manual_protected: "manual_protected",
    possible_delete: "possible_delete",
    delete_candidate: "possible_delete",
};

/** Normalize stored match_status → comparison_status (null if not an IR conflict class). */
export function toComparisonStatus(
    matchStatus: string | null | undefined
): ImportReviewComparisonStatus | null {
    const key = (matchStatus ?? "").trim().toLowerCase();
    if (!key) return null;
    return COMPARISON_FROM_STORED[key] ?? null;
}

/** Preferred match_status value to store for a comparison class. */
export function comparisonStatusToMatchStatus(
    comparison: ImportReviewComparisonStatus
): string {
    return comparison;
}

/** Stored match_status values that belong to one comparison filter. */
export function matchStatusStorageValuesForFilter(
    comparisonOrLegacy: string
): string[] {
    const key = comparisonOrLegacy.trim().toLowerCase();
    switch (key) {
        case "duplicate":
            return ["duplicate", "duplicate_candidate", "possible_duplicate"];
        case "conflict":
            return ["conflict", "needs_review"];
        case "verified_conflict":
            return ["verified_conflict"];
        case "manual_protected":
            return ["manual_protected"];
        case "possible_delete":
            return ["possible_delete", "delete_candidate"];
        default:
            return [comparisonOrLegacy];
    }
}

/**
 * Normalize API/DB review_decision to target meaning.
 * pending = NULL/empty/'pending'
 */
export function toReviewDecisionMeaning(
    stored: string | null | undefined
): ImportReviewTargetDecision | ImportReviewLegacyDecision {
    const raw = (stored ?? "").trim().toLowerCase();
    if (!raw || raw === "pending") return "pending";

    switch (raw) {
        case "keep_existing":
        case "replace_existing":
        case "merge_fields":
        case "insert_separate":
        case "ignore_import":
        case "mark_duplicate":
        case "confirm_soft_delete":
        case "needs_more_review":
            return raw;
        case "approved":
            return "approved";
        case "rejected":
            return "rejected";
        case "ignored":
            return "ignored";
        case "merged":
            return "merged";
        case "ignore":
            return "ignore_import";
        case "confirm_delete":
            return "confirm_soft_delete";
        default:
            return "needs_more_review";
    }
}

/**
 * Map writable API decision → DB review_decision column value.
 * pending is not written here (use NULL).
 */
export function decisionToStorageValue(
    decision: ImportReviewWritableDecision
): string {
    switch (decision) {
        case "approved":
            // Prefer target insert/replace semantics for new writes.
            return "replace_existing";
        case "rejected":
        case "ignored":
            return "ignore_import";
        case "merged":
            return "mark_duplicate";
        default:
            return decision;
    }
}

/** Derived legacy review_status still required by CHECKs and older gates. */
export function reviewStatusForDecisionStorage(decision: string): string {
    const d = decision.trim().toLowerCase();
    switch (d) {
        case "pending":
            return "pending";
        case "keep_existing":
        case "ignore_import":
        case "ignored":
        case "rejected":
            return "ignored";
        case "mark_duplicate":
        case "merged":
            return "merged";
        case "needs_more_review":
            return "needs_review";
        case "replace_existing":
        case "merge_fields":
        case "insert_separate":
        case "confirm_soft_delete":
        case "approved":
            return "approved";
        default:
            return "needs_review";
    }
}

export function isApplyReadyDecision(
    decision: string | null | undefined
): boolean {
    const d = (decision ?? "").trim().toLowerCase();
    if (!d) return false;
    if (APPLY_READY_SET.has(d)) return true;
    // After legacy alias rewrite on write
    return (
        d === "replace_existing" ||
        d === "merge_fields" ||
        d === "insert_separate" ||
        d === "confirm_soft_delete"
    );
}

export function isSkipApplyDecision(
    decision: string | null | undefined
): boolean {
    const d = (decision ?? "").trim().toLowerCase();
    return SKIP_APPLY_SET.has(d);
}

/** True when decision may enter an Apply publish batch (write or skip). */
export function isApplyBatchDecision(
    decision: string | null | undefined
): boolean {
    const d = (decision ?? "").trim().toLowerCase();
    if (!d) return false;
    return APPLY_BATCH_SET.has(d) || isApplyReadyDecision(d) || isSkipApplyDecision(d);
}

export function toApplyStatus(
    promotionStatus: string | null | undefined
): ImportReviewApplyStatus {
    const p = (promotionStatus ?? "").trim().toLowerCase();
    switch (p) {
        case "not_applied":
        case "not_ready":
        case "":
            return "not_applied";
        case "ready":
            return "ready";
        case "applying":
        case "batched":
        case "promoting":
            return "applying";
        case "applied":
        case "promoted":
        case "skipped":
            return "applied";
        case "failed":
            return "failed";
        default:
            return "not_applied";
    }
}

/**
 * Map apply_status → preferred promotion_status for NEW writes under expanded CHECKs.
 * Until migration expands CHECKs, use {@link applyStatusToLegacyPromotionStatus}.
 */
export function applyStatusToPromotionStatus(
    apply: ImportReviewApplyStatus
): string {
    switch (apply) {
        case "not_applied":
            return "not_applied";
        case "ready":
            return "ready";
        case "applying":
            return "applying";
        case "applied":
            return "applied";
        case "failed":
            return "failed";
        default:
            return "not_applied";
    }
}

/** promotion_status values safe under current (pre-migration) CHECKs. */
export function applyStatusToLegacyPromotionStatus(
    apply: ImportReviewApplyStatus
): ImportReviewLegacyPromotionStatus {
    switch (apply) {
        case "not_applied":
            return "not_ready";
        case "ready":
            return "ready";
        case "applying":
            return "batched";
        case "applied":
            return "promoted";
        case "failed":
            return "failed";
        default:
            return "not_ready";
    }
}

/** Stored promotion_status values that match an apply_status filter. */
export function promotionStatusStorageValuesForFilter(
    applyOrLegacy: string
): string[] {
    const key = applyOrLegacy.trim().toLowerCase();
    switch (key) {
        case "not_applied":
            return ["not_applied", "not_ready"];
        case "ready":
            return ["ready"];
        case "applying":
            return ["applying", "batched", "promoting"];
        case "applied":
            return ["applied", "promoted", "skipped"];
        case "failed":
            return ["failed"];
        default:
            return [applyOrLegacy];
    }
}

/** Publish item publish_status → apply-like meaning (history reads). */
export function publishItemStatusToApplyMeaning(
    publishStatus: string | null | undefined
): ImportReviewApplyStatus | "pending" {
    const p = (publishStatus ?? "").trim().toLowerCase();
    switch (p) {
        case "success":
            return "applied";
        case "failed":
            return "failed";
        case "skipped":
        case "rolled_back":
            return "applied";
        case "pending":
            return "pending";
        default:
            return "pending";
    }
}

export type ImportReviewStatusProjection = {
    comparison_status: ImportReviewComparisonStatus | null;
    review_decision: string | null;
    review_decision_meaning: string;
    apply_status: ImportReviewApplyStatus;
    /** Kept for compatibility; do not use as primary UI state. */
    match_status: string | null;
    auto_action: string | null;
    review_status: string | null;
    promotion_status: string | null;
};

export function projectCandidateStatuses(row: {
    match_status?: string | null;
    auto_action?: string | null;
    review_status?: string | null;
    review_decision?: string | null;
    promotion_status?: string | null;
}): ImportReviewStatusProjection {
    const meaning = toReviewDecisionMeaning(row.review_decision);
    return {
        comparison_status: toComparisonStatus(row.match_status),
        review_decision: row.review_decision ?? null,
        review_decision_meaning: meaning === "pending" ? "pending" : meaning,
        apply_status: toApplyStatus(row.promotion_status),
        match_status: row.match_status ?? null,
        auto_action: row.auto_action ?? null,
        review_status: row.review_status ?? null,
        promotion_status: row.promotion_status ?? null,
    };
}
