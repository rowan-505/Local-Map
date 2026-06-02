import type { ImportReviewEnvelopeQuery } from "@/src/lib/api";

import type { ImportReviewListFilters } from "../utils/entityPageUtils";

export function importReviewSummaryScopeKey(scope: ImportReviewEnvelopeQuery | null): string {
    if (!scope) {
        return "none";
    }
    if ("review_batch_id" in scope && scope.review_batch_id) {
        return `batch:${scope.review_batch_id}`;
    }
    const snap = scope.source_snapshot_version ?? "";
    const latest = "latest" in scope && scope.latest ? "1" : "0";
    return `snapshot:${snap}:latest=${latest}`;
}

export type ImportReviewCandidatesListQueryKeyInput = {
    apiFamily: string;
    apiScopeQuery: ImportReviewEnvelopeQuery;
    limit: number;
    offset: number;
    sort: string;
    filters: ImportReviewListFilters;
    qApplied: string;
    showPromoted: boolean;
};

export type ImportReviewCandidatesCountQueryKeyInput = {
    apiFamily: string;
    apiScopeQuery: ImportReviewEnvelopeQuery;
    filters: ImportReviewListFilters;
    qApplied: string;
    showPromoted: boolean;
};

export const importReviewQueryKeys = {
    formOptions: () => ["import-review", "options"] as const,
    filterOptions: (apiFamily: string, scope: ImportReviewEnvelopeQuery | null) =>
        ["import-review", "filter-options", apiFamily, importReviewSummaryScopeKey(scope)] as const,
    summary: (scope: ImportReviewEnvelopeQuery | null) =>
        ["import-review", "summary", importReviewSummaryScopeKey(scope)] as const,
    candidatesList: (input: ImportReviewCandidatesListQueryKeyInput | null) =>
        input
            ? ([
                  "import-review",
                  "candidates",
                  input.apiFamily,
                  importReviewSummaryScopeKey(input.apiScopeQuery),
                  input.filters.match_status,
                  input.filters.auto_action,
                  input.filters.review_status,
                  input.filters.review_decision,
                  input.filters.promotion_status,
                  input.filters.class_code,
                  input.qApplied.trim(),
                  input.sort,
                  input.limit,
                  input.offset,
                  input.showPromoted,
              ] as const)
            : (["import-review", "candidates", "none"] as const),
    candidatesCount: (input: ImportReviewCandidatesCountQueryKeyInput | null) =>
        input
            ? ([
                  "import-review",
                  "candidates-count",
                  input.apiFamily,
                  importReviewSummaryScopeKey(input.apiScopeQuery),
                  input.filters.match_status,
                  input.filters.auto_action,
                  input.filters.review_status,
                  input.filters.review_decision,
                  input.filters.promotion_status,
                  input.filters.class_code,
                  input.qApplied.trim(),
                  input.showPromoted,
              ] as const)
            : (["import-review", "candidates-count", "none"] as const),
    roadDryRunSummary: (reviewBatchId: string | null) =>
        ["import-review", "roads", "dry-run-summary", reviewBatchId ?? "none"] as const,
    promotionBatch: (publishBatchId: string) =>
        ["import-review", "promotion", "batch", publishBatchId] as const,
    promotionBatches: (reviewBatchId: string) =>
        ["import-review", "promotion", "batches", reviewBatchId] as const,
    promotionEligibility: (reviewBatchId: string, familiesKey: string) =>
        ["import-review", "promotion", "eligibility", reviewBatchId, familiesKey] as const,
};
