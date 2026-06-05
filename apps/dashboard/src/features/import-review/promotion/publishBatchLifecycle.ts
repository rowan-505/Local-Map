/** Mirrors API import-review-publish-batch-lifecycle (DB-safe statuses). */

import {
    parsePublishBatchDryRunResultFromSummary,
    publishBatchDryRunPassed,
    type PublishBatchDryRunResult,
} from "./publishBatchDryRun";

export function parsePublishBatchDryRunFromSummary(summary: unknown): ReturnType<
    typeof parsePublishBatchDryRunResultFromSummary
> {
    return parsePublishBatchDryRunResultFromSummary(summary);
}

export { publishBatchDryRunPassed };

export function normalizePublishBatchLifecycleStatus(status: string): string {
    const s = status.trim().toLowerCase();
    if (
        s === "draft" ||
        s === "validating" ||
        s === "ready" ||
        s === "partial" ||
        s === "promoting" ||
        s === "promoted" ||
        s === "failed" ||
        s === "cancelled" ||
        s === "blocked" ||
        s === "archived"
    ) {
        return s;
    }
    if (s === "validated" || s === "dry_run_passed" || s === "dry_run_running") {
        return "ready";
    }
    if (s === "partially_promoted") {
        return "partial";
    }
    return status;
}

const CLOSED_FOR_REUSE = new Set(["failed", "promoted", "cancelled", "archived"]);

export function isPublishBatchClosedForReuse(status: string): boolean {
    return CLOSED_FOR_REUSE.has(normalizePublishBatchLifecycleStatus(status));
}

export function publishBatchClosedForReuseMessage(status: string): string {
    const s = normalizePublishBatchLifecycleStatus(status);
    if (s === "failed") {
        return "This batch failed and is closed. Create a new retry batch.";
    }
    if (s === "promoted") {
        return "This batch is already promoted and closed.";
    }
    return "This batch is closed and cannot be reused for promotion.";
}

export function canValidatePublishBatch(status: string): boolean {
    const s = normalizePublishBatchLifecycleStatus(status);
    return s === "draft" || s === "ready" || s === "partial";
}

/** @param actualPromotableCount pending items with validation ready (from progress API). */
export function canDryRunPublishBatch(status: string, actualPromotableCount: number): boolean {
    if (isPublishBatchClosedForReuse(status)) {
        return false;
    }
    const s = normalizePublishBatchLifecycleStatus(status);
    return (s === "ready" || s === "partial") && actualPromotableCount > 0;
}

export function canPromotePublishBatch(
    status: string,
    actualPromotableCount: number,
    dryRunResult?: PublishBatchDryRunResult | null
): boolean {
    if (isPublishBatchClosedForReuse(status)) {
        return false;
    }
    const s = normalizePublishBatchLifecycleStatus(status);
    return (
        (s === "ready" || s === "partial") &&
        publishBatchDryRunPassed(dryRunResult) &&
        actualPromotableCount > 0
    );
}

export function shouldPollPublishBatchLifecycle(status: string): boolean {
    const s = normalizePublishBatchLifecycleStatus(status);
    return s === "validating" || s === "promoting";
}

/** Reads summary.dry_run_result.status or a bare dry_run_result object from progress/API. */
export function dryRunDisplayStatus(dryRunSource: unknown): "passed" | "failed" | "not_run" {
    if (!dryRunSource || typeof dryRunSource !== "object") {
        return "not_run";
    }
    const wrapped =
        "dry_run_result" in (dryRunSource as Record<string, unknown>)
            ? dryRunSource
            : { dry_run_result: dryRunSource };
    const dr = parsePublishBatchDryRunResultFromSummary(wrapped);
    if (!dr?.status) {
        return "not_run";
    }
    return dr.status === "passed" ? "passed" : "failed";
}

export function dryRunResultFromApiResponse(
    response: { status?: string; summary?: { dry_run_result?: unknown } } | null | undefined
): ReturnType<typeof parsePublishBatchDryRunResultFromSummary> {
    if (!response) {
        return null;
    }
    const fromSummary = parsePublishBatchDryRunResultFromSummary(response.summary);
    if (fromSummary?.status) {
        return fromSummary;
    }
    const status = typeof response.status === "string" ? response.status.trim().toLowerCase() : "";
    if (status === "passed" || status === "failed") {
        return {
            status,
            checked_at: new Date().toISOString(),
        };
    }
    return null;
}
