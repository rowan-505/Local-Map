import {
    batchStatusAllowsDryRun,
    normalizePublishBatchStoredStatus,
} from "./import-review-publish-batch-lifecycle.js";

/** Persisted at system.system_publish_batches.summary.dry_run_result (batch dry-run endpoint). */
export type PublishBatchDryRunResult = {
    status: string;
    checked_at: string;
    total: number;
    entity_families: string[];
    ready_count?: number;
    blocked_count?: number;
    would_insert_count?: number;
    would_update_count?: number;
    duplicate_fixed_count?: number;
    duplicate_blocked_count?: number;
    duplicate_samples?: unknown[];
    failed_count?: number;
    sample_errors?: unknown[];
    ran_at?: string;
};

export function parsePublishBatchDryRunResultFromSummary(
    summary: unknown
): PublishBatchDryRunResult | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const raw = (summary as Record<string, unknown>).dry_run_result;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const o = raw as Record<string, unknown>;
    const status = typeof o.status === "string" ? o.status.trim() : "";
    const checked_at =
        typeof o.checked_at === "string" && o.checked_at.trim()
            ? o.checked_at.trim()
            : typeof o.ran_at === "string" && o.ran_at.trim()
              ? o.ran_at.trim()
              : "";
    const total = Number(o.total ?? 0);
    const entityFamilies = Array.isArray(o.entity_families)
        ? o.entity_families.filter((f): f is string => typeof f === "string")
        : [];
    if (!status && !checked_at && total <= 0 && (o.ready_count == null)) {
        return null;
    }
    return {
        status: status || (total > 0 ? "passed" : "failed"),
        checked_at,
        total: Number.isFinite(total) ? Math.max(0, total) : 0,
        entity_families: entityFamilies,
        ready_count: o.ready_count != null ? Number(o.ready_count) : undefined,
        blocked_count: o.blocked_count != null ? Number(o.blocked_count) : undefined,
        would_insert_count:
            o.would_insert_count != null ? Number(o.would_insert_count) : undefined,
        would_update_count:
            o.would_update_count != null ? Number(o.would_update_count) : undefined,
        duplicate_fixed_count:
            o.duplicate_fixed_count != null ? Number(o.duplicate_fixed_count) : undefined,
        duplicate_blocked_count:
            o.duplicate_blocked_count != null
                ? Number(o.duplicate_blocked_count)
                : undefined,
        duplicate_samples: Array.isArray(o.duplicate_samples) ? o.duplicate_samples : undefined,
        failed_count: o.failed_count != null ? Number(o.failed_count) : undefined,
        sample_errors: Array.isArray(o.sample_errors) ? o.sample_errors : undefined,
        ran_at: typeof o.ran_at === "string" ? o.ran_at : undefined,
    };
}

/** Dry-run gate for promote: summary.dry_run_result.status only (batch.status stays ready/partial). */
export function publishBatchDryRunPassed(
    dryRunResult: PublishBatchDryRunResult | null | undefined
): boolean {
    return dryRunResult?.status?.trim().toLowerCase() === "passed";
}

export function mergePublishBatchDryRunResult(
    existing: PublishBatchDryRunResult | null,
    next: PublishBatchDryRunResult
): PublishBatchDryRunResult {
    if (
        existing?.status === "passed" &&
        next.status === "failed" &&
        next.total <= 0 &&
        (next.ready_count ?? 0) <= 0
    ) {
        return existing;
    }
    return next;
}

export function batchStatusForDryRunEligibility(batchStatus: string): boolean {
    return batchStatusAllowsDryRun(normalizePublishBatchStoredStatus(batchStatus));
}
