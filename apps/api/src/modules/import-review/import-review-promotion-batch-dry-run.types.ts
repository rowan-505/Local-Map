/** API contract for POST /promotion/batches/:id/dry-run */

export type PublishBatchDryRunSampleError = {
    candidate_id: number | null;
    external_id: string | null;
    code: string;
    message: string;
};

export type PublishBatchDryRunDuplicateSample = {
    candidate_id: number;
    external_id: string | null;
    action: "converted_to_update" | "blocked_duplicate" | "in_review_duplicate";
    message: string;
    core_street_id: number | null;
};

export type PublishBatchDryRunSummary = {
    dry_run_result: {
        status: "passed" | "failed";
        checked_at: string;
        total: number;
        entity_families: string[];
        ready_count: number;
        blocked_count: number;
        failed_count: number;
        would_insert_count: number;
        would_update_count: number;
        duplicate_fixed_count?: number;
        duplicate_blocked_count?: number;
        duplicate_samples?: PublishBatchDryRunDuplicateSample[];
        sample_errors: PublishBatchDryRunSampleError[];
        ran_at?: string;
    };
    batch_status?: string;
    message?: string;
};

export type ImportReviewPublishBatchDryRunApiResponse = {
    status: "passed" | "failed";
    batch_id: number;
    entity_family: string;
    total: number;
    ready_count: number;
    blocked_count: number;
    failed_count: number;
    would_insert_count: number;
    would_update_count: number;
    duplicate_fixed_count: number;
    duplicate_blocked_count: number;
    duplicate_samples: PublishBatchDryRunDuplicateSample[];
    sample_errors: PublishBatchDryRunSampleError[];
    summary: PublishBatchDryRunSummary;
};
