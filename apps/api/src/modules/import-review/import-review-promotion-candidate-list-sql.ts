import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";
import { colRef } from "./import-review-candidate-sql.js";
import { isPromotablePublishFamily } from "./import-review-promotion-config.js";

export const ACTIVE_LOCKED_BATCH_STATUSES = ["validating", "promoting", "ready"] as const;

export type ImportReviewPromotionStateFilter =
    | "all_active"
    | "ready_not_ready"
    | "retry_needed"
    | "active_locked"
    | "promoted";

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

function isPromotedSql(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const a = config.tableAlias;
    return Prisma.sql`(
        ${col(a, "promotion_status")} = 'promoted'
        OR ${col(a, "review_status")} = 'promoted'
    )`;
}

function latestFailedPublishItemScalar(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint,
    column: "publish_batch_id" | "error_message" | "error_code"
): Prisma.Sql {
    const select =
        column === "publish_batch_id"
            ? Prisma.sql`spi.publish_batch_id::text`
            : column === "error_message"
              ? Prisma.sql`spi.error_message`
              : Prisma.sql`coalesce(spi.after_data->>'error_code', spi.after_data->>'failure_code')::text`;

    return Prisma.sql`(
        SELECT ${select}
        FROM system.system_publish_items AS spi
        INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
        WHERE spi.review_candidate_id = ${colRef(config, "id")}
          AND spi.entity_family = ${config.entityFamily}
          AND spi.publish_status = 'failed'
          AND spb.source_review_batch_id = ${reviewBatchId}
        ORDER BY spi.id DESC
        LIMIT 1
    )`;
}

export function latestPromotionFailureMessageExpr(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint
): Prisma.Sql {
    return latestFailedPublishItemScalar(config, reviewBatchId, "error_message");
}

/** Latest failed publish item for a candidate in this review batch. */
export function buildRetryNeededWhereClause(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint
): Prisma.Sql {
    const alias = config.tableAlias;
    return Prisma.sql`
        NOT (${isPromotedSql(config)})
        AND EXISTS (
            SELECT 1
            FROM system.system_publish_items AS spi
            INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
            WHERE spi.review_candidate_id = ${colRef(config, "id")}
              AND spi.entity_family = ${config.entityFamily}
              AND spi.publish_status = 'failed'
              AND spb.source_review_batch_id = ${reviewBatchId}
        )
    `;
}

export function buildActiveLockedBatchedWhereClause(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint
): Prisma.Sql {
    const alias = config.tableAlias;
    const activeStatuses = ACTIVE_LOCKED_BATCH_STATUSES.map((s) => Prisma.sql`${s}`);
    return Prisma.sql`
        ${col(alias, "promotion_status")} = 'batched'
        AND EXISTS (
            SELECT 1
            FROM system.system_publish_items AS spi
            INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
            WHERE spi.review_candidate_id = ${colRef(config, "id")}
              AND spi.entity_family = ${config.entityFamily}
              AND spb.source_review_batch_id = ${reviewBatchId}
              AND spb.status IN (${Prisma.join(activeStatuses)})
        )
    `;
}

/** Default entity list: hide promoted; hide stale batched; show not_ready and active-locked batched. */
export function buildDefaultActivePromotionWhereClause(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint
): Prisma.Sql {
    const alias = config.tableAlias;
    return Prisma.sql`
        NOT (${isPromotedSql(config)})
        AND (
            ${col(alias, "promotion_status")} IS DISTINCT FROM 'batched'
            OR (${buildActiveLockedBatchedWhereClause(config, reviewBatchId)})
        )
    `;
}

export function buildPromotionStateWhereClause(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint,
    state: ImportReviewPromotionStateFilter
): Prisma.Sql {
    const alias = config.tableAlias;
    switch (state) {
        case "all_active":
            return buildDefaultActivePromotionWhereClause(config, reviewBatchId);
        case "ready_not_ready":
            return Prisma.sql`
                ${col(alias, "promotion_status")} = 'not_ready'
                AND NOT (${isPromotedSql(config)})
            `;
        case "retry_needed":
            return buildRetryNeededWhereClause(config, reviewBatchId);
        case "active_locked":
            return buildActiveLockedBatchedWhereClause(config, reviewBatchId);
        case "promoted":
            return isPromotedSql(config);
        default:
            return buildDefaultActivePromotionWhereClause(config, reviewBatchId);
    }
}

export function promotionListExtrasSelect(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint
): Prisma.Sql {
    if (!isPromotablePublishFamily(config.entityFamily)) {
        return Prisma.empty;
    }
    const batchIdExpr = latestFailedPublishItemScalar(config, reviewBatchId, "publish_batch_id");
    return Prisma.sql`
        , ${batchIdExpr} AS latest_promotion_publish_batch_id
        , ${latestFailedPublishItemScalar(config, reviewBatchId, "error_code")} AS latest_promotion_error_code
        , ${latestFailedPublishItemScalar(config, reviewBatchId, "error_message")} AS latest_promotion_failure_message
        , (
            NOT (${isPromotedSql(config)})
            AND ${batchIdExpr} IS NOT NULL
        ) AS promotion_retry_needed
    `;
}
