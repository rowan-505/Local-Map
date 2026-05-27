/** Dev-only timing for GET /api/import-review/summary sub-steps. */

export type ImportReviewSummaryTimingSink = (label: string, durationMs: number) => void;

export function isImportReviewSummaryTimingEnabled(): boolean {
    return process.env.NODE_ENV !== "production";
}

export function createImportReviewSummaryTimingSink(
    reviewBatchId: bigint
): ImportReviewSummaryTimingSink | undefined {
    if (!isImportReviewSummaryTimingEnabled()) {
        return undefined;
    }

    const batchId = reviewBatchId.toString();
    return (label, durationMs) => {
        console.info(
            `[import-review summary] review_batch_id=${batchId} ${label} ${durationMs.toFixed(1)}ms`
        );
    };
}

export async function timeImportReviewSummaryStep<T>(
    label: string,
    sink: ImportReviewSummaryTimingSink | undefined,
    fn: () => Promise<T>
): Promise<T> {
    if (!sink) {
        return fn();
    }
    const started = performance.now();
    try {
        return await fn();
    } finally {
        sink(label, performance.now() - started);
    }
}
