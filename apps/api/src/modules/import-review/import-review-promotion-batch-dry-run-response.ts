import type { PublishBatchDryRunResult } from "./import-review-publish-batch-dry-run.js";
import type {
    ImportReviewPublishBatchDryRunApiResponse,
    PublishBatchDryRunDuplicateSample,
    PublishBatchDryRunSampleError,
    PublishBatchDryRunSummary,
} from "./import-review-promotion-batch-dry-run.types.js";

export function resolvePublishBatchDryRunEntityFamily(entityFamilies: readonly string[]): string {
    if (entityFamilies.length === 1) {
        return entityFamilies[0] ?? "unknown";
    }
    if (entityFamilies.includes("roads")) {
        return "roads";
    }
    return entityFamilies[0] ?? "mixed";
}

export function buildPublishBatchDryRunSummary(args: {
    dryRunStatus: "passed" | "failed";
    checkedAt: string;
    total: number;
    entityFamilies: string[];
    readyCount: number;
    blockedCount: number;
    failedCount: number;
    wouldInsertCount: number;
    wouldUpdateCount: number;
    duplicateFixedCount?: number;
    duplicateBlockedCount?: number;
    duplicateSamples?: PublishBatchDryRunDuplicateSample[];
    sampleErrors: PublishBatchDryRunSampleError[];
    batchStatus: string;
    message: string;
}): PublishBatchDryRunSummary {
    return {
        dry_run_result: {
            status: args.dryRunStatus,
            checked_at: args.checkedAt,
            total: args.total,
            entity_families: args.entityFamilies,
            ready_count: args.readyCount,
            blocked_count: args.blockedCount,
            failed_count: args.failedCount,
            would_insert_count: args.wouldInsertCount,
            would_update_count: args.wouldUpdateCount,
            duplicate_fixed_count: args.duplicateFixedCount ?? 0,
            duplicate_blocked_count: args.duplicateBlockedCount ?? 0,
            duplicate_samples: args.duplicateSamples ?? [],
            sample_errors: args.sampleErrors,
            ran_at: args.checkedAt,
        },
        batch_status: args.batchStatus,
        message: args.message,
    };
}

export function dryRunPayloadFromSummary(summary: PublishBatchDryRunSummary): PublishBatchDryRunResult {
    return summary.dry_run_result;
}

export function buildPublishBatchDryRunApiResponse(args: {
    batchId: bigint;
    status: "passed" | "failed";
    entityFamilies: string[];
    total: number;
    readyCount: number;
    blockedCount: number;
    failedCount: number;
    wouldInsertCount: number;
    wouldUpdateCount: number;
    duplicateFixedCount?: number;
    duplicateBlockedCount?: number;
    duplicateSamples?: PublishBatchDryRunDuplicateSample[];
    sampleErrors: PublishBatchDryRunSampleError[];
    batchStatus: string;
    message: string;
    checkedAt?: string;
}): ImportReviewPublishBatchDryRunApiResponse {
    const checkedAt = args.checkedAt ?? new Date().toISOString();
    const summary = buildPublishBatchDryRunSummary({
        dryRunStatus: args.status,
        checkedAt,
        total: args.total,
        entityFamilies: args.entityFamilies,
        readyCount: args.readyCount,
        blockedCount: args.blockedCount,
        failedCount: args.failedCount,
        wouldInsertCount: args.wouldInsertCount,
        wouldUpdateCount: args.wouldUpdateCount,
        duplicateFixedCount: args.duplicateFixedCount,
        duplicateBlockedCount: args.duplicateBlockedCount,
        duplicateSamples: args.duplicateSamples,
        sampleErrors: args.sampleErrors,
        batchStatus: args.batchStatus,
        message: args.message,
    });

    return {
        status: args.status,
        batch_id: Number(args.batchId),
        entity_family: resolvePublishBatchDryRunEntityFamily(args.entityFamilies),
        total: args.total,
        ready_count: args.readyCount,
        blocked_count: args.blockedCount,
        failed_count: args.failedCount,
        would_insert_count: args.wouldInsertCount,
        would_update_count: args.wouldUpdateCount,
        duplicate_fixed_count: args.duplicateFixedCount ?? 0,
        duplicate_blocked_count: args.duplicateBlockedCount ?? 0,
        duplicate_samples: args.duplicateSamples ?? [],
        sample_errors: args.sampleErrors,
        summary,
    };
}

export function systemErrorSample(message: string): PublishBatchDryRunSampleError {
    return {
        candidate_id: null,
        external_id: null,
        code: "dry_run_system_error",
        message,
    };
}
