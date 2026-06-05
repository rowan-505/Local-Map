import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { ImportReviewBatchNotFoundError } from "./import-review-errors.js";
import { ImportReviewInvalidScopeError } from "./import-review-errors.js";
import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import {
    getImportReviewPromotionCandidateTable,
    isPromotablePublishFamily,
    PROMOTABLE_PUBLISH_FAMILIES,
    type PromotablePublishEntityFamily,
} from "./import-review-promotion-config.js";

/**
 * Batches in these statuses still own their batched candidates — never stale-release.
 * Includes draft/ready (pre-validation), validating, dry_run_passed, and promoting.
 */
export const STALE_BATCHED_RELEASE_BLOCKED_BATCH_STATUSES = [
    "draft",
    "validating",
    "ready",
    "dry_run_passed",
    "promoting",
] as const;

/** Only terminal closed batches may qualify for stale release. */
export const STALE_BATCHED_RELEASE_ALLOWED_BATCH_STATUSES = ["failed", "partial"] as const;

/** Only failed publish items on those batches (never pending). */
export const STALE_BATCHED_RELEASE_ALLOWED_PUBLISH_ITEM_STATUSES = ["failed"] as const;

export const STALE_BATCHED_RELEASE_SAMPLE_LIMIT = 20;

export type ReleaseStaleBatchedRequest = {
    review_batch_id: bigint;
    families?: readonly string[];
    dry_run?: boolean;
};

export type ReleaseStaleBatchedSample = {
    entity_family: string;
    candidate_id: string;
    publish_batch_id: string | null;
    publish_item_id: string | null;
    publish_status: string | null;
    batch_status: string | null;
};

export type ReleaseStaleBatchedFamilyResult = {
    entity_family: string;
    eligible_count: number;
    released_count: number;
};

export type ReleaseStaleBatchedResponse = {
    status: "success";
    dry_run: boolean;
    review_batch_id: string;
    released_total: number;
    by_family: ReleaseStaleBatchedFamilyResult[];
    samples: ReleaseStaleBatchedSample[];
};

type StaleBatchedCandidateRow = {
    candidate_id: bigint;
    publish_batch_id: bigint | null;
    publish_item_id: bigint | null;
    publish_status: string | null;
    batch_status: string | null;
};

export function resolveReleaseStaleBatchedFamilies(
    families?: readonly string[]
): PromotablePublishEntityFamily[] {
    if (!families || families.length === 0) {
        return [...PROMOTABLE_PUBLISH_FAMILIES];
    }
    const unique = [...new Set(families.map((f) => f.trim()).filter(Boolean))];
    const invalid = unique.filter((f) => !isPromotablePublishFamily(f));
    if (invalid.length > 0) {
        throw new ImportReviewInvalidScopeError(
            `Unsupported entity families for stale batched release: ${invalid.join(", ")}`
        );
    }
    return unique as PromotablePublishEntityFamily[];
}

async function assertReviewBatchExists(prisma: PrismaClient, reviewBatchId: bigint): Promise<void> {
    const rows = await prisma.$queryRaw<{ id: bigint }[]>`
        SELECT id
        FROM import_review.review_batches
        WHERE id = ${reviewBatchId}
        LIMIT 1
    `;
    if (!rows[0]) {
        throw new ImportReviewBatchNotFoundError(reviewBatchId.toString());
    }
}

export async function listStaleBatchedCandidatesForFamily(
    prisma: PrismaClient,
    args: {
        reviewBatchId: bigint;
        entityFamily: PromotablePublishEntityFamily;
        sampleLimit?: number;
    }
): Promise<StaleBatchedCandidateRow[]> {
    const candidateTable = getImportReviewPromotionCandidateTable(
        args.entityFamily as ImportReviewEntityFamilySlug
    );
    const limit = args.sampleLimit;
    const limitSql =
        limit != null && limit > 0 ? Prisma.sql`LIMIT ${limit}` : Prisma.empty;

    return prisma.$queryRaw<StaleBatchedCandidateRow[]>`
        SELECT
            rc.id AS candidate_id,
            latest.publish_batch_id,
            latest.publish_item_id,
            latest.publish_status,
            latest.batch_status
        FROM ${Prisma.raw(candidateTable)} AS rc
        INNER JOIN LATERAL (
            SELECT
                spi.id AS publish_item_id,
                spi.publish_batch_id,
                spi.publish_status::text AS publish_status,
                spb.status::text AS batch_status
            FROM system.system_publish_items AS spi
            INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
            WHERE spi.entity_family = ${args.entityFamily}
              AND spi.review_candidate_id = rc.id
            ORDER BY spi.id DESC
            LIMIT 1
        ) AS latest ON true
        WHERE rc.review_batch_id = ${args.reviewBatchId}
          AND rc.promotion_status = 'batched'
          AND rc.promotion_status IS DISTINCT FROM 'promoted'
          AND latest.publish_status IN (${Prisma.join(STALE_BATCHED_RELEASE_ALLOWED_PUBLISH_ITEM_STATUSES)})
          AND latest.batch_status IN (${Prisma.join(STALE_BATCHED_RELEASE_ALLOWED_BATCH_STATUSES)})
          AND NOT EXISTS (
              SELECT 1
              FROM system.system_publish_items AS spi_active
              INNER JOIN system.system_publish_batches AS spb_active
                  ON spb_active.id = spi_active.publish_batch_id
              WHERE spi_active.entity_family = ${args.entityFamily}
                AND spi_active.review_candidate_id = rc.id
                AND spb_active.status IN (${Prisma.join(STALE_BATCHED_RELEASE_BLOCKED_BATCH_STATUSES)})
          )
          AND NOT EXISTS (
              SELECT 1
              FROM system.system_publish_items AS ok
              WHERE ok.entity_family = ${args.entityFamily}
                AND ok.review_candidate_id = rc.id
                AND ok.publish_status = 'success'
                AND ok.target_id IS NOT NULL
          )
        ORDER BY rc.id ASC
        ${limitSql}
    `;
}

async function releaseStaleBatchedCandidateIds(
    prisma: PrismaClient,
    entityFamily: PromotablePublishEntityFamily,
    candidateIds: readonly bigint[]
): Promise<number> {
    if (candidateIds.length === 0) {
        return 0;
    }
    const candidateTable = getImportReviewPromotionCandidateTable(
        entityFamily as ImportReviewEntityFamilySlug
    );
    const rows = await prisma.$queryRaw<{ id: bigint }[]>`
        UPDATE ${Prisma.raw(candidateTable)}
        SET promotion_status = 'not_ready', updated_at = now()
        WHERE id IN (${Prisma.join(candidateIds)})
          AND promotion_status = 'batched'
          AND promotion_status IS DISTINCT FROM 'promoted'
        RETURNING id
    `;
    return rows.length;
}

function toSample(
    entityFamily: string,
    row: StaleBatchedCandidateRow
): ReleaseStaleBatchedSample {
    return {
        entity_family: entityFamily,
        candidate_id: row.candidate_id.toString(),
        publish_batch_id: row.publish_batch_id?.toString() ?? null,
        publish_item_id: row.publish_item_id?.toString() ?? null,
        publish_status: row.publish_status,
        batch_status: row.batch_status,
    };
}

export async function releaseStaleBatchedImportReviewCandidates(
    prisma: PrismaClient,
    request: ReleaseStaleBatchedRequest
): Promise<ReleaseStaleBatchedResponse> {
    const dryRun = request.dry_run ?? false;
    const families = resolveReleaseStaleBatchedFamilies(request.families);
    await assertReviewBatchExists(prisma, request.review_batch_id);

    const by_family: ReleaseStaleBatchedFamilyResult[] = [];
    const samples: ReleaseStaleBatchedSample[] = [];
    let released_total = 0;

    for (const entityFamily of families) {
        const eligibleRows = await listStaleBatchedCandidatesForFamily(prisma, {
            reviewBatchId: request.review_batch_id,
            entityFamily,
        });
        const eligible_count = eligibleRows.length;
        let released_count = 0;

        if (!dryRun && eligible_count > 0) {
            released_count = await releaseStaleBatchedCandidateIds(
                prisma,
                entityFamily,
                eligibleRows.map((row) => row.candidate_id)
            );
        }

        released_total += dryRun ? eligible_count : released_count;
        by_family.push({
            entity_family: entityFamily,
            eligible_count,
            released_count: dryRun ? 0 : released_count,
        });

        for (const row of eligibleRows) {
            if (samples.length >= STALE_BATCHED_RELEASE_SAMPLE_LIMIT) {
                break;
            }
            samples.push(toSample(entityFamily, row));
        }
        if (samples.length >= STALE_BATCHED_RELEASE_SAMPLE_LIMIT) {
            break;
        }
    }

    return {
        status: "success",
        dry_run: dryRun,
        review_batch_id: request.review_batch_id.toString(),
        released_total,
        by_family,
        samples,
    };
}
