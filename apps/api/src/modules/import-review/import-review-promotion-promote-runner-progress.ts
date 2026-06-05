import { computePipelinePercent } from "./import-review-promotion-progress.js";

export type PromotionChunkProgressCounts = {
    processed: number;
    total: number;
    promoted_count: number;
    failed_count: number;
    skipped_count: number;
};

export function buildPromotionChunkProgressMessage(args: {
    family: string;
    processed: number;
    total: number;
}): string {
    return `Promoted ${args.processed.toLocaleString()} / ${args.total.toLocaleString()} publish items (${args.family})…`;
}

export function buildPromotionChunkStageDetails(args: {
    family: string;
    processed: number;
    total: number;
    promoted_count: number;
    failed_count: number;
    skipped_count: number;
    percent: number;
    chunkIndex?: number;
    chunkSize?: number;
    familyItemCount?: number;
}): Record<string, unknown> {
    return {
        process_state: "running",
        engine: "import-review-promotion-promote",
        current_family: args.family,
        processed_count: args.processed,
        total_item_count: args.total,
        promoted_count: args.promoted_count,
        failed_count: args.failed_count,
        skipped_count: args.skipped_count,
        percent: args.percent,
        ...(args.chunkIndex !== undefined ? { chunk_index: args.chunkIndex } : {}),
        ...(args.chunkSize !== undefined ? { chunk_size: args.chunkSize } : {}),
        ...(args.familyItemCount !== undefined ? { family_item_count: args.familyItemCount } : {}),
        last_heartbeat_at: new Date().toISOString(),
    };
}

export function buildPromotionPipelineProgressUpdate(args: {
    processed: number;
    total: number;
    currentFamily: string;
    promotedCount: number;
    failedCount: number;
    skippedCount: number;
    percent?: number;
}): {
    message: string;
    percent: number;
    processed: number;
    total: number;
    currentFamily: string;
    promotedCount: number;
    failedCount: number;
    skippedCount: number;
} {
    const percent = computePipelinePercent(args.processed, args.total, args.percent);
    return {
        message: buildPromotionChunkProgressMessage({
            family: args.currentFamily,
            processed: args.processed,
            total: args.total,
        }),
        percent,
        processed: args.processed,
        total: args.total,
        currentFamily: args.currentFamily,
        promotedCount: args.promotedCount,
        failedCount: args.failedCount,
        skippedCount: args.skippedCount,
    };
}
