import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { PROMOTABLE_PUBLISH_FAMILIES } from "./import-review-promotion-config.js";
import {
    ImportReviewPromotionCreateBatchResolver,
    type CreateBatchCandidateResolution,
} from "./import-review-promotion-create-batch.js";
import type { CreatePublishBatchFilters } from "./import-review-promotion-create-batch.js";

export type FailedReadyPublishItemRow = {
    entity_family: string;
    review_candidate_id: bigint;
};

const DEFAULT_RETRY_FILTERS: CreatePublishBatchFilters = {
    review_decision: "approved",
    include_warnings: false,
};

export function groupCandidateIdsByFamily(
    rows: readonly FailedReadyPublishItemRow[]
): Record<string, bigint[]> {
    const out: Record<string, bigint[]> = {};
    for (const row of rows) {
        const family = row.entity_family.trim();
        if (!family) {
            continue;
        }
        if (!out[family]) {
            out[family] = [];
        }
        out[family].push(row.review_candidate_id);
    }
    for (const family of Object.keys(out)) {
        out[family] = [...new Set(out[family])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    }
    return out;
}

export async function listFailedReadyPublishItemCandidates(
    prisma: PrismaClient,
    sourceBatchId: bigint
): Promise<FailedReadyPublishItemRow[]> {
    return prisma.$queryRaw<FailedReadyPublishItemRow[]>`
        SELECT
            spi.entity_family::text AS entity_family,
            spi.review_candidate_id
        FROM system.system_publish_items AS spi
        WHERE spi.publish_batch_id = ${sourceBatchId}
          AND spi.publish_status = 'failed'
          AND spi.review_candidate_id IS NOT NULL
          AND coalesce(spi.validation_result->>'status', '') = 'ready'
          AND spi.entity_family IN (${Prisma.join(PROMOTABLE_PUBLISH_FAMILIES)})
        ORDER BY spi.entity_family, spi.review_candidate_id
    `;
}

export async function resolveFailedReadyRetryCandidates(args: {
    prisma: PrismaClient;
    sourceBatchId: bigint;
    reviewBatchId: bigint;
    filters?: CreatePublishBatchFilters;
}): Promise<{
    source_failed_ready_count: number;
    resolution: CreateBatchCandidateResolution;
}> {
    const rows = await listFailedReadyPublishItemCandidates(args.prisma, args.sourceBatchId);
    const candidateIdsByFamily = groupCandidateIdsByFamily(rows);
    const families = Object.keys(candidateIdsByFamily).sort();
    if (families.length === 0) {
        return {
            source_failed_ready_count: 0,
            resolution: {
                familyConfigs: [],
                candidateIdsByFamily: {},
                countByFamily: {},
                totalItems: 0,
            },
        };
    }

    const resolver = new ImportReviewPromotionCreateBatchResolver(args.prisma);
    const resolution = await resolver.resolveCandidateIds({
        reviewBatchId: args.reviewBatchId,
        mode: "selected",
        families,
        candidateIdsByFamily,
        filters: args.filters ?? DEFAULT_RETRY_FILTERS,
    });

    return {
        source_failed_ready_count: rows.length,
        resolution,
    };
}
