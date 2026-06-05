import { Prisma, type PrismaClient } from "@prisma/client";

import type { PublishItemPromotionGateInput } from "./import-review-promotion-publish-item-validation.js";

type PromotionPreflightDb = Pick<PrismaClient, "$queryRaw">;

export type PromotionPreflightSkipCounts = {
    skipped_promoted_count: number;
    skipped_failed_count: number;
    skipped_blocked_count: number;
    skipped_skipped_count: number;
    skipped_warning_count: number;
    pending_total: number;
};

/** SQL expression: validation_result status allowed for promotion write. */
export function promotableValidationStatusSql(confirmWarnings: boolean): Prisma.Sql {
    if (confirmWarnings) {
        return Prisma.sql`(
            coalesce(validation_result->>'status', '') IN ('ready', 'valid', 'warning')
        )`;
    }
    return Prisma.sql`(
        coalesce(validation_result->>'status', '') IN ('ready', 'valid')
    )`;
}

export async function countPromotionPreflightSkips(
    prisma: PromotionPreflightDb,
    batchId: bigint
): Promise<PromotionPreflightSkipCounts> {
    const rows = await prisma.$queryRaw<
        {
            skipped_promoted_count: bigint;
            skipped_failed_count: bigint;
            skipped_blocked_count: bigint;
            skipped_skipped_count: bigint;
            skipped_warning_count: bigint;
            pending_total: bigint;
        }[]
    >`
        SELECT
            count(*) FILTER (WHERE publish_status = 'success')::bigint AS skipped_promoted_count,
            count(*) FILTER (WHERE publish_status = 'failed')::bigint AS skipped_failed_count,
            count(*) FILTER (WHERE publish_status = 'skipped')::bigint AS skipped_skipped_count,
            count(*) FILTER (
                WHERE publish_status = 'pending'
                  AND coalesce(validation_result->>'status', '') = 'blocked'
            )::bigint AS skipped_blocked_count,
            count(*) FILTER (
                WHERE publish_status = 'pending'
                  AND coalesce(validation_result->>'status', '') = 'warning'
            )::bigint AS skipped_warning_count,
            count(*) FILTER (WHERE publish_status = 'pending')::bigint AS pending_total
        FROM system.system_publish_items
        WHERE publish_batch_id = ${batchId}
    `;
    const row = rows[0];
    return {
        skipped_promoted_count: Number(row?.skipped_promoted_count ?? 0n),
        skipped_failed_count: Number(row?.skipped_failed_count ?? 0n),
        skipped_blocked_count: Number(row?.skipped_blocked_count ?? 0n),
        skipped_skipped_count: Number(row?.skipped_skipped_count ?? 0n),
        skipped_warning_count: Number(row?.skipped_warning_count ?? 0n),
        pending_total: Number(row?.pending_total ?? 0n),
    };
}

/**
 * Returns count of publish items that are not safe to promote in this run (0 = pass).
 * Replaces per-item fetch loops.
 */
export async function countPromotableWriteBlockers(
    prisma: PromotionPreflightDb,
    itemIds: readonly bigint[],
    gate: PublishItemPromotionGateInput = {}
): Promise<number> {
    if (itemIds.length === 0) {
        return 0;
    }
    const confirmWarnings = gate.confirm_warnings === true;
    const statusSql = promotableValidationStatusSql(confirmWarnings);
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count
        FROM system.system_publish_items AS spi
        WHERE spi.id IN (${Prisma.join(itemIds)})
          AND (
            spi.publish_status <> 'pending'
            OR NOT (${statusSql})
          )
    `;
    return Number(rows[0]?.count ?? 0n);
}
