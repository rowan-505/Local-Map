import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import {
    getImportReviewPromotionCandidateTable,
    PROMOTABLE_PUBLISH_FAMILIES,
} from "./import-review-promotion-config.js";

export const PUBLISH_BATCH_VALIDATION_SYSTEM_ERROR_CODE = "VALIDATION_SYSTEM_ERROR";
export const PUBLISH_BATCH_PROMOTION_SYSTEM_ERROR_CODE = "PROMOTION_SYSTEM_ERROR";
export const PUBLISH_BATCH_DRY_RUN_SYSTEM_ERROR_CODE = "DRY_RUN_SYSTEM_ERROR";

export type PublishBatchTerminalFailureOptions = {
    /** Stored on pending publish items (after_data.error_code). */
    terminalFailureErrorCode?: string;
    /** When false, only marks the batch failed (no item/candidate cleanup). */
    cleanupPublishItemsAndCandidates?: boolean;
};

/** Mark pending publish items failed with a structured terminal error. */
export async function failPendingPublishItemsForPublishBatch(
    prisma: PrismaClient,
    batchId: bigint,
    args: { errorCode: string; errorMessage: string }
): Promise<void> {
    const afterPatch = JSON.stringify({
        status: "failed",
        error_code: args.errorCode,
        message: args.errorMessage,
    });
    const validationResultPatch = JSON.stringify({
        status: "blocked",
        errors: [
            {
                code: args.errorCode,
                message: args.errorMessage,
            },
        ],
        warnings: [],
    });
    await prisma.$executeRaw`
        UPDATE system.system_publish_items
        SET
            publish_status = 'failed',
            error_message = coalesce(nullif(trim(error_message), ''), ${args.errorMessage}),
            validation_result = ${validationResultPatch}::jsonb,
            after_data = coalesce(after_data, '{}'::jsonb) || ${afterPatch}::jsonb
        WHERE publish_batch_id = ${batchId}
          AND publish_status = 'pending'
    `;
}

/**
 * Release batched candidates tied to a publish batch so failed terminal runs never
 * leave promotion_status='batched'. Skips candidates that already have a success item.
 */
export async function releaseBatchedCandidatesForPublishBatch(
    prisma: PrismaClient,
    batchId: bigint
): Promise<number> {
    let released = 0;
    for (const family of PROMOTABLE_PUBLISH_FAMILIES) {
        const candidateTable = getImportReviewPromotionCandidateTable(
            family as ImportReviewEntityFamilySlug
        );
        const rows = await prisma.$queryRaw<{ id: bigint }[]>`
            UPDATE ${Prisma.raw(candidateTable)}
            SET promotion_status = 'not_ready', updated_at = now()
            WHERE promotion_status = 'batched'
              AND review_status = 'approved'
              AND review_decision = 'approved'
              AND EXISTS (
                  SELECT 1
                  FROM system.system_publish_items AS spi
                  WHERE spi.publish_batch_id = ${batchId}
                    AND spi.entity_family = ${family}
                    AND spi.review_candidate_id = id
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM system.system_publish_items AS ok
                  WHERE ok.entity_family = ${family}
                    AND ok.review_candidate_id = id
                    AND ok.publish_status = 'success'
                    AND ok.target_id IS NOT NULL
              )
            RETURNING id
        `;
        released += rows.length;
    }
    return released;
}

/** Fail pending items and release batched candidates for a terminal batch failure. */
export async function cleanupPublishBatchTerminalFailure(
    prisma: PrismaClient,
    batchId: bigint,
    args: { errorCode: string; errorMessage: string }
): Promise<void> {
    await failPendingPublishItemsForPublishBatch(prisma, batchId, args);
    await releaseBatchedCandidatesForPublishBatch(prisma, batchId);
}
