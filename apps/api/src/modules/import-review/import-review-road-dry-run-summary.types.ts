import type { RoadDryRunItemResult } from "./import-review-promotion-road-dry-run.types.js";

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

export type { RoadDryRunItemResult };
