import { dryRunDisplayStatus } from "@/src/features/import-review/promotion/publishBatchSimpleFlow";
import type { ImportReviewPublishBatchProgressResponse } from "@/src/lib/api";

export type PublishBatchStageProgressSource = Pick<
    ImportReviewPublishBatchProgressResponse,
    | "validated_at"
    | "validation_total"
    | "validation_done"
    | "validation_percent"
    | "validation_result"
    | "dry_run_result"
    | "promotion_result"
    | "status"
    | "workflow"
    | "current_stage"
    | "percent"
    | "processed_count"
    | "total"
    | "item_processed_count"
    | "total_item_count"
    | "promotion_status"
    | "publish_item_status_counts"
    | "current_promotable_count"
>;

export type PublishBatchStageProgressSummary = Partial<
    Pick<
        PublishBatchStageProgressSource,
        "validation_result" | "dry_run_result" | "promotion_result"
    >
> & {
    promotion_progress_done?: number;
    promotion_progress_total?: number;
};

export type StageProgressDisplay = {
    active: boolean;
    done: number;
    total: number;
    percent: number;
};

function mergeProgressSource(
    batch: PublishBatchStageProgressSource,
    summary?: PublishBatchStageProgressSummary | null
): PublishBatchStageProgressSource & PublishBatchStageProgressSummary {
    return {
        ...batch,
        validation_result: summary?.validation_result ?? batch.validation_result,
        dry_run_result: summary?.dry_run_result ?? batch.dry_run_result,
        promotion_result: summary?.promotion_result ?? batch.promotion_result,
        promotion_progress_done: summary?.promotion_progress_done,
        promotion_progress_total: summary?.promotion_progress_total,
    };
}

function isValidationStageActive(source: PublishBatchStageProgressSource): boolean {
    return (
        source.current_stage === "validate_items" ||
        source.workflow === "validation" ||
        source.status === "validating"
    );
}

function isPromotionStageActive(source: PublishBatchStageProgressSource): boolean {
    return (
        source.current_stage === "promote_items" ||
        source.status === "promoting" ||
        source.promotion_status === "promoting"
    );
}

function isDryRunStageActive(source: PublishBatchStageProgressSource): boolean {
    return source.current_stage === "dry_run_items";
}

export function isValidationCompleteForDisplay(source: PublishBatchStageProgressSource): boolean {
    if (source.validated_at) {
        return true;
    }
    if (source.validation_percent != null && source.validation_percent >= 100) {
        return !isValidationStageActive(source);
    }
    const vr = source.validation_result;
    const validationTotal = vr?.total_count ?? vr?.total_items ?? 0;
    return validationTotal > 0 && !isValidationStageActive(source);
}

function resolveValidationTotal(source: PublishBatchStageProgressSource): number {
    const vr = source.validation_result;
    const fromResult = vr?.total_count ?? vr?.total_items ?? 0;
    if (fromResult > 0) {
        return fromResult;
    }
    return Math.max(0, source.validation_total ?? source.total_item_count ?? 0);
}

export function getValidationProgress(
    batch: PublishBatchStageProgressSource,
    summary?: PublishBatchStageProgressSummary | null
): StageProgressDisplay {
    const source = mergeProgressSource(batch, summary);
    const validationTotal = resolveValidationTotal(source);
    const active = isValidationStageActive(source);
    const complete = isValidationCompleteForDisplay(source);

    if (active) {
        const total = Math.max(source.total ?? source.validation_total ?? validationTotal, 0);
        const done = source.processed_count ?? source.validation_done ?? 0;
        const percent =
            source.percent ??
            source.validation_percent ??
            (total > 0 ? (done / total) * 100 : 0);
        return {
            active: true,
            done,
            total,
            percent: Math.min(100, Math.max(0, percent)),
        };
    }

    if (complete) {
        const total =
            validationTotal > 0
                ? validationTotal
                : Math.max(source.validation_total ?? 0, source.total_item_count ?? 0);
        return {
            active: false,
            done: total,
            total,
            percent: 100,
        };
    }

    const total = source.validation_total ?? source.total_item_count ?? 0;
    const done = Math.min(source.validation_done ?? 0, total > 0 ? total : Number.MAX_SAFE_INTEGER);
    const percent =
        source.validation_percent ?? (total > 0 ? (done / total) * 100 : 0);
    return {
        active: false,
        done,
        total,
        percent: Math.min(100, Math.max(0, percent)),
    };
}

export function getDryRunProgress(
    batch: PublishBatchStageProgressSource,
    summary?: PublishBatchStageProgressSummary | null
): StageProgressDisplay {
    const source = mergeProgressSource(batch, summary);
    const validationTotal = resolveValidationTotal(source);
    const active = isDryRunStageActive(source);
    const dryRun = source.dry_run_result;
    const dryRunLabel = dryRunDisplayStatus(dryRun);

    if (active) {
        const total = Math.max(source.total ?? validationTotal, 0);
        const done = source.processed_count ?? 0;
        const percent = source.percent ?? (total > 0 ? (done / total) * 100 : 0);
        return {
            active: true,
            done,
            total,
            percent: Math.min(100, Math.max(0, percent)),
        };
    }

    if (dryRunLabel === "passed") {
        const total = Math.max(dryRun?.total ?? validationTotal, 0);
        const done = dryRun?.total ?? dryRun?.ready_count ?? total;
        return {
            active: false,
            done,
            total,
            percent: 100,
        };
    }

    const total = dryRun?.total ?? 0;
    return {
        active: false,
        done: 0,
        total,
        percent: 0,
    };
}

function resolvePromotionProgressCounts(
    source: PublishBatchStageProgressSource & PublishBatchStageProgressSummary
): { done: number; total: number } | null {
    const summaryDone = source.promotion_progress_done;
    const summaryTotal = source.promotion_progress_total;
    if (typeof summaryDone === "number" && typeof summaryTotal === "number") {
        return { done: summaryDone, total: summaryTotal };
    }
    return null;
}

export function getPromotionProgress(
    batch: PublishBatchStageProgressSource,
    summary?: PublishBatchStageProgressSummary | null
): StageProgressDisplay {
    const source = mergeProgressSource(batch, summary);
    const validationTotal = resolveValidationTotal(source);
    const active = isPromotionStageActive(source);
    const summaryProgress = resolvePromotionProgressCounts(source);

    if (active) {
        const total = Math.max(
            summaryProgress?.total ??
                source.total ??
                source.current_promotable_count ??
                validationTotal,
            0
        );
        const done = Math.min(
            summaryProgress?.done ??
                source.processed_count ??
                source.item_processed_count ??
                0,
            total > 0 ? total : Number.MAX_SAFE_INTEGER
        );
        const percent =
            source.percent ?? (total > 0 ? (done / total) * 100 : 0);
        return {
            active: true,
            done,
            total,
            percent: Math.min(100, Math.max(0, percent)),
        };
    }

    const promotionResult = source.promotion_result;
    const counts = source.publish_item_status_counts;
    if (promotionResult || counts) {
        const done =
            (promotionResult?.success_count ?? counts?.success ?? 0) +
            (promotionResult?.failed_count ?? counts?.failed ?? 0);
        const total = promotionResult?.total ?? counts?.total ?? validationTotal;
        return {
            active: false,
            done,
            total,
            percent: total > 0 ? Math.min(100, (done / total) * 100) : 100,
        };
    }

    return {
        active: false,
        done: 0,
        total: validationTotal,
        percent: 0,
    };
}
