export function canCancelImportReviewPublishBatchPromotion(status: string): boolean {
    return status === "promoting";
}

export function canResetImportReviewPublishBatchPromotion(
    status: string,
    options?: { heartbeatStaleWarning?: boolean; workerInProcess?: boolean }
): boolean {
    if (status !== "promoting") {
        return false;
    }
    if (options?.workerInProcess) {
        return false;
    }
    return Boolean(options?.heartbeatStaleWarning ?? true);
}

export function formatPromotionHeartbeatAt(iso: string | null | undefined): string | null {
    if (!iso) {
        return null;
    }
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed.toLocaleString();
}
