/** Dev-only timing for import-review candidate list queries. */

export type ImportReviewListTimingSink = (label: string, durationMs: number) => void;

export function isImportReviewListTimingEnabled(): boolean {
    return process.env.NODE_ENV !== "production";
}

export function createImportReviewListTimingSink(args: {
    family: string;
    reviewBatchId: bigint;
}): ImportReviewListTimingSink | undefined {
    if (!isImportReviewListTimingEnabled()) {
        return undefined;
    }

    const batchId = args.reviewBatchId.toString();
    const family = args.family;
    return (label, durationMs) => {
        console.info(
            `[import-review list] family=${family} review_batch_id=${batchId} ${label} ${durationMs.toFixed(1)}ms`
        );
    };
}

export async function timeImportReviewListStep<T>(
    label: string,
    sink: ImportReviewListTimingSink | undefined,
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
