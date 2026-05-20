import { ImportReviewPublishInvalidStageStatusError } from "./import-review-promotion.errors.js";

export const PUBLISH_STAGE_STATUSES = [
    "pending",
    "running",
    "success",
    "warning",
    "failed",
    "skipped",
] as const;

export type PublishStageStatus = (typeof PUBLISH_STAGE_STATUSES)[number];

const STAGE_STATUS_ALIASES: Record<string, PublishStageStatus> = {
    completed: "success",
    error: "failed",
    skipped: "skipped",
};

export function normalizeStageStatus(status: string): PublishStageStatus | null {
    const normalized = STAGE_STATUS_ALIASES[status] ?? status;
    if ((PUBLISH_STAGE_STATUSES as readonly string[]).includes(normalized)) {
        return normalized as PublishStageStatus;
    }
    return null;
}

export function requireValidPublishStageStatus(status: string): PublishStageStatus {
    const normalized = normalizeStageStatus(status);
    if (!normalized) {
        throw new ImportReviewPublishInvalidStageStatusError(status);
    }
    return normalized;
}
