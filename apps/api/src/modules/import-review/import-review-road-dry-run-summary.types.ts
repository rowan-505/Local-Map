import type { RoadDryRunItemResult } from "./import-review-promotion-road-dry-run.types.js";

export type ImportReviewRoadDryRunStatus = "passed" | "failed";

export type ImportReviewRoadDryRunSampleError = {
    publish_item_id: string;
    review_candidate_id: string | null;
    external_id: string | null;
    code: string;
    message: string;
};

/** Persisted at system.system_publish_batches.summary.road_dry_run */
export type ImportReviewRoadDryRunSummary = {
    status: ImportReviewRoadDryRunStatus;
    checked_count: number;
    passed_count: number;
    failed_count: number;
    sample_errors: ImportReviewRoadDryRunSampleError[];
    ran_at: string;
};

/** GET /roads/dry-run-summary — latest detailed dry-run per review batch. */
export type ImportReviewRoadDryRunSummaryResponse = {
    review_batch_id: string;
    publish_batch_id: string | null;
    finished_at: string | null;
    total_count: number;
    safe_to_promote_count: number;
    promote_with_warning_count: number;
    needs_manual_review_count: number;
    blocked_count: number;
    items_by_candidate_id: Record<string, RoadDryRunItemResult>;
};
