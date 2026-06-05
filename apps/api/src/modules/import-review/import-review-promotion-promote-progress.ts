/** Promotion worker heartbeat thresholds (milliseconds). */
export const IMPORT_REVIEW_PROMOTION_STALE_MS = 5 * 60 * 1000;
export const IMPORT_REVIEW_PROMOTION_HEARTBEAT_STALL_WARNING_MS = 2 * 60 * 1000;
export const IMPORT_REVIEW_PROMOTION_HEARTBEAT_INTERVAL_MS = 12 * 1000;

export type ImportReviewPromotionAbortReason = "cancelled" | "stale_worker";

export type PromotionProgressSummaryFields = {
    promotion_attempt_id?: string;
    promotion_heartbeat_at?: string;
    promotion_cancel_requested_at?: string | null;
    promotion_progress_total?: number;
    promotion_progress_done?: number;
};

export function parsePromotionHeartbeatFromSummary(summary: unknown): Date | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const raw = (summary as Record<string, unknown>).promotion_heartbeat_at;
    if (typeof raw !== "string" || raw.trim() === "") {
        return null;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parsePromotionCancelRequestedFromSummary(summary: unknown): Date | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const raw = (summary as Record<string, unknown>).promotion_cancel_requested_at;
    if (typeof raw !== "string" || raw.trim() === "") {
        return null;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isPromotionHeartbeatStale(
    anchor: Date | null,
    nowMs: number = Date.now()
): boolean {
    if (!anchor) {
        return true;
    }
    return nowMs - anchor.getTime() > IMPORT_REVIEW_PROMOTION_STALE_MS;
}

export function isPromotionHeartbeatStalled(
    anchor: Date | null,
    nowMs: number = Date.now()
): boolean {
    if (!anchor) {
        return true;
    }
    return nowMs - anchor.getTime() > IMPORT_REVIEW_PROMOTION_HEARTBEAT_STALL_WARNING_MS;
}

export function buildPromotionStageHeartbeatDetails(args: {
    attemptId: string;
    checkedCount: number;
    promotableCount: number;
    skippedPromotedCount: number;
    skippedFailedCount: number;
    skippedBlockedCount: number;
    skippedSkippedCount: number;
    skippedWarningCount: number;
    phase?: string;
}): Record<string, unknown> {
    return {
        promotion_attempt_id: args.attemptId,
        last_heartbeat_at: new Date().toISOString(),
        phase: args.phase ?? "preflight",
        checked_count: args.checkedCount,
        promotable_count: args.promotableCount,
        skipped_promoted_count: args.skippedPromotedCount,
        skipped_failed_count: args.skippedFailedCount,
        skipped_blocked_count: args.skippedBlockedCount,
        skipped_skipped_count: args.skippedSkippedCount,
        skipped_warning_count: args.skippedWarningCount,
    };
}

export function newPromotionAttemptId(): string {
    return `promote-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
