import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import type { PromotionDb } from "./import-review-promotion-db.js";
import {
    getImportReviewPromotionCandidateTable,
    isImportReviewPromotionAllowedFamily,
    isPromotablePublishFamily,
} from "./import-review-promotion-config.js";

/** Release a failed candidate from batched so it can re-enter promotion eligibility. */
export async function releaseCandidateAfterPromotionFailure(
    prisma: PromotionDb,
    entityFamily: string,
    reviewCandidateId: bigint
): Promise<void> {
    if (!isPromotablePublishFamily(entityFamily)) {
        return;
    }
    const candidateTable = getImportReviewPromotionCandidateTable(
        entityFamily as ImportReviewEntityFamilySlug
    );
    await prisma.$executeRaw`
        UPDATE ${Prisma.raw(candidateTable)}
        SET promotion_status = 'not_ready',
            updated_at = now()
        WHERE id = ${reviewCandidateId}
          AND review_status = 'approved'
          AND review_decision = 'approved'
          AND promotion_status IS DISTINCT FROM 'promoted'
    `;
}

/** Unblock failed retry candidates still marked batched from the source publish batch. */
export async function releaseBatchedCandidatesForRetry(
    prisma: PrismaClient,
    candidateIdsByFamily: Record<string, readonly bigint[]>
): Promise<number> {
    let released = 0;
    for (const [family, ids] of Object.entries(candidateIdsByFamily)) {
        if (ids.length === 0 || !isImportReviewPromotionAllowedFamily(family)) {
            continue;
        }
        const candidateTable = getImportReviewPromotionCandidateTable(
            family as ImportReviewEntityFamilySlug
        );
        const rows = await prisma.$queryRaw<{ id: bigint }[]>`
            UPDATE ${Prisma.raw(candidateTable)}
            SET promotion_status = 'not_ready', updated_at = now()
            WHERE id IN (${Prisma.join(ids)})
              AND review_status = 'approved'
              AND review_decision = 'approved'
              AND promotion_status = 'batched'
              AND promotion_status IS DISTINCT FROM 'promoted'
            RETURNING id
        `;
        released += rows.length;
    }
    return released;
}
