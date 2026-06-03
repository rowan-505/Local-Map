import type { ImportReviewCreatePublishBatchResult } from "@/src/lib/api";
import { isImportReviewDevMode } from "@/src/features/import-review/utils/importReviewDetailErrors";

const NUMERIC_BATCH_ID_RE = /^\d+$/;

/** Navigation id from POST /promotion/batches — uses top-level numeric `id` only. */
export function resolveCreatedPublishBatchId(
    result: ImportReviewCreatePublishBatchResult | Record<string, unknown>
): string | null {
    const body = result as Record<string, unknown>;
    const text = String(body.id ?? "").trim();
    if (NUMERIC_BATCH_ID_RE.test(text)) {
        return text;
    }
    return null;
}

export function logCreatePublishBatchResponseDev(
    context: string,
    payload: unknown,
    response: unknown,
    resolvedBatchId: string | null
): void {
    if (!isImportReviewDevMode) {
        return;
    }
    console.info(`[import-review] ${context}`, {
        request: payload,
        response,
        resolved_batch_id: resolvedBatchId,
    });
}
