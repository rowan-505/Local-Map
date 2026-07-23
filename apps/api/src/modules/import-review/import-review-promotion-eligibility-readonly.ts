import { Prisma } from "@prisma/client";

import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import {
    applyBatchReviewStatusSql,
    jsonbArrayLengthExpr,
} from "./import-review-promotion-eligibility.js";
import { IMPORT_REVIEW_APPLY_BATCH_DECISION_SQL_IN } from "./import-review-status-model.js";

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

function hasStoredValidationWarningsSql(alias: string): Prisma.Sql {
    const warnings = col(alias, "validation_warnings");
    return Prisma.sql`(
        ${warnings} IS NOT NULL
        AND jsonb_typeof(${warnings}) = 'array'
        AND jsonb_array_length(${warnings}) > 0
    )`;
}

function hasStoredValidationErrorsSql(alias: string): Prisma.Sql {
    const errors = col(alias, "validation_errors");
    return Prisma.sql`(
        ${errors} IS NOT NULL
        AND jsonb_typeof(${errors}) = 'array'
        AND jsonb_array_length(${errors}) > 0
    )`;
}

function isPromotedStoredSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        ${col(alias, "promotion_status")} = 'promoted'
        OR ${col(alias, "review_status")} = 'promoted'
        OR ${col(alias, "promoted_core_id")} IS NOT NULL
    )`;
}

function isApprovedSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        ${applyBatchReviewStatusSql(alias)}
        AND ${col(alias, "review_decision")} IN ${Prisma.raw(IMPORT_REVIEW_APPLY_BATCH_DECISION_SQL_IN)}
    )`;
}

export type FamilyEligibilityReadonlyCountDb = {
    entity_family: string;
    table_name: string;
    approved_count: bigint;
    ready_existing_count: bigint;
    blocked_existing_count: bigint;
    warning_existing_count: bigint;
    already_batched_count: bigint;
    already_promoted_count: bigint;
};

/**
 * Read-only approximate counts from candidate table columns only.
 * Does not run promotion validation, candidate updates, or publish-item EXISTS guards.
 */
export function buildFamilyEligibilityReadonlyCountSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint
): Prisma.Sql {
    const a = config.tableAlias;
    const baseScope = Prisma.sql`
        ${col(a, "review_batch_id")} = ${reviewBatchId}
        AND ${col(a, "entity_family")} = ${config.entityFamily}
    `;
    const approved = isApprovedSql(a);

    return Prisma.sql`
        SELECT
            ${config.entityFamily}::text AS entity_family,
            ${config.candidateTable}::text AS table_name,
            count(*) FILTER (WHERE ${approved})::bigint AS approved_count,
            count(*) FILTER (
                WHERE ${approved}
                  AND ${col(a, "promotion_status")} = 'ready'
                  AND NOT ${isPromotedStoredSql(a)}
            )::bigint AS ready_existing_count,
            count(*) FILTER (
                WHERE ${approved}
                  AND ${hasStoredValidationErrorsSql(a)}
                  AND NOT ${isPromotedStoredSql(a)}
            )::bigint AS blocked_existing_count,
            count(*) FILTER (
                WHERE ${approved}
                  AND ${hasStoredValidationWarningsSql(a)}
                  AND NOT ${isPromotedStoredSql(a)}
            )::bigint AS warning_existing_count,
            count(*) FILTER (
                WHERE ${baseScope}
                  AND ${col(a, "promotion_status")} IN ('batched', 'promoting')
            )::bigint AS already_batched_count,
            count(*) FILTER (WHERE ${baseScope} AND ${isPromotedStoredSql(a)})::bigint AS already_promoted_count
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        WHERE ${baseScope}
    `;
}
