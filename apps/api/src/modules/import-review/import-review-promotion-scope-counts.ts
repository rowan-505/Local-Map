import { Prisma } from "@prisma/client";

import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import { buildCreateBatchEligibleWhereSql } from "./import-review-promotion-create-batch-eligibility.js";
import type { PublishEligibilityOptions } from "./import-review-promotion-eligibility.js";

export const PROMOTION_SCOPE_NO_READY_MESSAGE =
    "No eligible candidates. Release stale locked items or approve candidates first.";

const ACTIVE_LOCKED_BATCH_STATUSES = ["validating", "promoting", "ready"] as const;

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

function isPromotedScopeSql(alias: string): Prisma.Sql {
    return Prisma.sql`${col(alias, "promotion_status")} = 'promoted'`;
}

export type FamilyPromotionScopeCountDb = {
    entity_family: string;
    table_name: string;
    ready_now_count: bigint;
    retry_needed_count: bigint;
    active_locked_count: bigint;
    stale_locked_count: bigint;
    promoted_count: bigint;
};

/**
 * Truthful promotion-scope counts aligned with batch creation and stale release rules.
 */
export function buildFamilyPromotionScopeCountSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    options: PublishEligibilityOptions
): Prisma.Sql {
    const a = config.tableAlias;
    const readyNowWhere = buildCreateBatchEligibleWhereSql(config, reviewBatchId, options);
    const activeStatuses = ACTIVE_LOCKED_BATCH_STATUSES.map((s) => Prisma.sql`${s}`);

    return Prisma.sql`
        SELECT
            ${config.entityFamily}::text AS entity_family,
            ${config.candidateTable}::text AS table_name,
            count(*) FILTER (WHERE ${readyNowWhere})::bigint AS ready_now_count,
            count(*) FILTER (
                WHERE NOT ${isPromotedScopeSql(a)}
                  AND ${col(a, "promotion_status")} IS DISTINCT FROM 'batched'
                  AND latest.publish_status = 'failed'
            )::bigint AS retry_needed_count,
            count(*) FILTER (
                WHERE ${col(a, "promotion_status")} = 'batched'
                  AND latest.batch_status IN (${Prisma.join(activeStatuses)})
            )::bigint AS active_locked_count,
            count(*) FILTER (
                WHERE ${col(a, "promotion_status")} = 'batched'
                  AND (
                      latest.batch_status IS NULL
                      OR latest.batch_status NOT IN (${Prisma.join(activeStatuses)})
                  )
            )::bigint AS stale_locked_count,
            count(*) FILTER (WHERE ${isPromotedScopeSql(a)})::bigint AS promoted_count
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        LEFT JOIN LATERAL (
            SELECT
                spi.publish_status::text AS publish_status,
                spb.status::text AS batch_status
            FROM system.system_publish_items AS spi
            INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
            WHERE spi.entity_family = ${config.entityFamily}
              AND spi.review_candidate_id = ${col(a, "id")}
            ORDER BY spi.id DESC
            LIMIT 1
        ) AS latest ON true
        WHERE ${col(a, "review_batch_id")} = ${reviewBatchId}
    `;
}

export type PromotionScopeFamilyCounts = {
    ready_now: number;
    retry_needed: number;
    active_locked: number;
    stale_locked: number;
    promoted: number;
};

export function mapFamilyPromotionScopeCounts(
    row: FamilyPromotionScopeCountDb | null | undefined
): PromotionScopeFamilyCounts {
    if (!row) {
        return {
            ready_now: 0,
            retry_needed: 0,
            active_locked: 0,
            stale_locked: 0,
            promoted: 0,
        };
    }
    return {
        ready_now: Number(row.ready_now_count),
        retry_needed: Number(row.retry_needed_count),
        active_locked: Number(row.active_locked_count),
        stale_locked: Number(row.stale_locked_count),
        promoted: Number(row.promoted_count),
    };
}
