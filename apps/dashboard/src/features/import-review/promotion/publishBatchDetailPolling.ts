import type { ImportReviewPublishBatchProgressResponse } from "@/src/lib/api";

import { shouldPollPublishBatchLifecycle } from "./publishBatchLifecycle";

const RESUME_ACTIONS = new Set([
    "resume_validation",
    "resume_dry_run",
    "resume_promotion",
    "resume_verify",
]);

/** Poll while validation, dry-run, promotion, or verify pipeline work may still be in flight. */
export function shouldPollPublishBatchDetail(
    progress: ImportReviewPublishBatchProgressResponse | null,
    lifecycleStatus: string
): boolean {
    if (shouldPollPublishBatchLifecycle(lifecycleStatus)) {
        return true;
    }
    const raw = lifecycleStatus.trim().toLowerCase();
    if (raw === "dry_run_running") {
        return true;
    }
    if (!progress) {
        return false;
    }
    if (progress.promotion_worker_in_process) {
        return true;
    }
    if (progress.current_stage_status === "running") {
        return true;
    }
    const actions = progress.resumable_actions ?? [];
    if (actions.some((a) => RESUME_ACTIONS.has(a))) {
        return true;
    }
    return false;
}
