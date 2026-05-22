import type { PrismaClient } from "@prisma/client";

import type {
    ImportReviewRoadDryRunSummaryResponse,
    RoadDryRunItemResult,
} from "./import-review-road-dry-run-summary.types.js";
import type { ImportReviewPromotionRoadDryRunResult } from "./import-review-promotion-road-dry-run.types.js";

export class ImportReviewRoadDryRunSummaryRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async fetchLatestDryRunForReviewBatch(
        reviewBatchId: bigint
    ): Promise<{ publishBatchId: bigint; result: ImportReviewPromotionRoadDryRunResult } | null> {
        const rows = await this.prisma.$queryRaw<
            { publish_batch_id: bigint; result: unknown }[]
        >`
            SELECT
                pb.id AS publish_batch_id,
                pb.summary->'road_dry_run_result' AS result
            FROM system.system_publish_batches AS pb
            WHERE pb.source_review_batch_id = ${reviewBatchId}
              AND pb.summary ? 'road_dry_run_result'
            ORDER BY pb.id DESC
            LIMIT 1
        `;
        const row = rows[0];
        if (!row?.result || typeof row.result !== "object" || Array.isArray(row.result)) {
            return null;
        }
        return {
            publishBatchId: row.publish_batch_id,
            result: row.result as ImportReviewPromotionRoadDryRunResult,
        };
    }
}

export function buildRoadDryRunSummaryResponse(
    reviewBatchId: bigint,
    publishBatchId: bigint | null,
    result: ImportReviewPromotionRoadDryRunResult | null
): ImportReviewRoadDryRunSummaryResponse {
    const itemsByCandidateId: Record<string, RoadDryRunItemResult> = {};
    if (result) {
        for (const item of result.items) {
            if (item.review_candidate_id) {
                itemsByCandidateId[item.review_candidate_id] = item;
            }
        }
    }

    return {
        review_batch_id: reviewBatchId.toString(),
        publish_batch_id: publishBatchId?.toString() ?? null,
        finished_at: result?.finished_at ?? null,
        total_count: result?.total_count ?? 0,
        safe_to_promote_count: result?.safe_to_promote_count ?? 0,
        promote_with_warning_count: result?.promote_with_warning_count ?? 0,
        needs_manual_review_count: result?.needs_manual_review_count ?? 0,
        blocked_count: result?.blocked_count ?? 0,
        items_by_candidate_id: itemsByCandidateId,
    };
}
