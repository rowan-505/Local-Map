import type { ImportReviewPublishValidationStageKey } from "./import-review-promotion-validation.types.js";

/** Emit batch + stage log heartbeats at most this often during per-item validation. */
export const VALIDATE_PUBLISH_BATCH_PROGRESS_INTERVAL = 25;

export type ValidatePublishBatchProgressEvent = {
    batchId: bigint;
    done: number;
    total: number;
    family: string;
    candidateId: bigint;
    stageKey: ImportReviewPublishValidationStageKey;
    message: string;
    elapsedMs: number;
};

export type ValidatePublishBatchProgressCallback = (
    event: ValidatePublishBatchProgressEvent
) => void | Promise<void>;

export function shouldReportValidatePublishBatchProgress(
    done: number,
    total: number,
    interval = VALIDATE_PUBLISH_BATCH_PROGRESS_INTERVAL
): boolean {
    if (done <= 0 || total <= 0) {
        return false;
    }
    if (done === total) {
        return true;
    }
    return done % interval === 0;
}

export function buildValidatePublishBatchProgressMessage(event: {
    done: number;
    total: number;
    family: string;
}): string {
    return `Validated ${event.done.toLocaleString()} / ${event.total.toLocaleString()} publish items (${event.family})…`;
}

export type ValidatePublishBatchChunkHeartbeat = {
    chunkIndex?: number;
    chunkSize?: number;
    familyItemCount?: number;
};

export function buildValidateCandidateStateStageHeartbeatDetails(
    event: ValidatePublishBatchProgressEvent,
    chunk?: ValidatePublishBatchChunkHeartbeat
): Record<string, unknown> {
    return {
        process_state: "running",
        engine: "import-review-promotion-simple-validation",
        processed_count: event.done,
        total_item_count: event.total,
        current_family: event.family,
        last_candidate_id: event.candidateId.toString(),
        elapsed_ms: event.elapsedMs,
        last_heartbeat_at: new Date().toISOString(),
        ...(chunk?.chunkIndex !== undefined ? { chunk_index: chunk.chunkIndex } : {}),
        ...(chunk?.chunkSize !== undefined ? { chunk_size: chunk.chunkSize } : {}),
        ...(chunk?.familyItemCount !== undefined ? { family_item_count: chunk.familyItemCount } : {}),
    };
}
