/** Poll interval while validation/promotion is in-flight (avoid starving connection_limit=1 API pools). */
export const PUBLISH_BATCH_POLL_MS = 4000;

/** Slower poll after repeated errors or stale heartbeat. */
export const PUBLISH_BATCH_POLL_MS_SLOW = 10000;

export const PUBLISH_BATCH_MAX_CONSECUTIVE_POLL_ERRORS = 3;

export const PUBLISH_BATCH_STALE_HEARTBEAT_EXTRA_POLLS = 4;

/** Batch statuses where progress/log polling should stop (terminal or idle). */
export const PUBLISH_BATCH_TERMINAL_POLL_STATUSES = new Set([
    "failed",
    "promoted",
    "partially_promoted",
    "cancelled",
    "blocked",
    "ready",
    "draft",
]);

export function shouldPollPublishBatchProgress(status: string): boolean {
    const s = status.trim().toLowerCase();
    return s === "validating" || s === "dry_run_running" || s === "promoting";
}

export function nextPublishBatchPollDelayMs(args: {
    consecutiveErrors: number;
    heartbeatStaleWarning?: boolean;
}): number {
    if (args.consecutiveErrors >= PUBLISH_BATCH_MAX_CONSECUTIVE_POLL_ERRORS) {
        return PUBLISH_BATCH_POLL_MS_SLOW;
    }
    if (args.heartbeatStaleWarning) {
        return PUBLISH_BATCH_POLL_MS_SLOW;
    }
    return PUBLISH_BATCH_POLL_MS;
}

export const PUBLISH_BATCH_POOLER_WARNING =
    "If API validation or promotion stalls with Prisma P2024, your DATABASE_URL may use a Supabase pooler with connection_limit=1. " +
    "For batch 24-scale road jobs use SQL bulk scripts (roads_bulk_validate.sql / roads_bulk_promote_new_auto.sql), or set PRISMA_CONNECTION_LIMIT=2 on the API for light dashboard polling only.";
