import { Prisma } from "@prisma/client";

import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import {
    isBlockedInActiveBatchSql,
    isPromotedSql,
    type PublishEligibilityOptions,
} from "./import-review-promotion-eligibility.js";
import { IMPORT_REVIEW_APPLY_READY_DECISION_SQL_IN } from "./import-review-status-model.js";

export const CREATE_BATCH_NO_ELIGIBLE_CANDIDATES_CODE = "NO_ELIGIBLE_CANDIDATES";

export const CREATE_BATCH_NO_ELIGIBLE_MESSAGE =
    "No eligible candidates available. Release stale batched items or approve candidates first.";

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

function hasValidationWarningsSql(alias: string): Prisma.Sql {
    const warnings = col(alias, "validation_warnings");
    return Prisma.sql`(
        ${warnings} IS NOT NULL
        AND jsonb_typeof(${warnings}) = 'array'
        AND jsonb_array_length(${warnings}) > 0
    )`;
}

function createBatchRoadRequiredFieldsSql(config: ImportReviewPublishFamilyConfig, alias: string): Prisma.Sql {
    if (config.entityFamily !== "roads") {
        return Prisma.empty;
    }
    return Prisma.sql`
        AND ${col(alias, "road_class_id")} IS NOT NULL
        AND ${col(alias, "admin_area_id")} IS NOT NULL
        AND ${col(alias, "geom")} IS NOT NULL
    `;
}

/**
 * Final publish-batch creation predicate — must match selection, insert, and mark-batched SQL.
 */
export function buildCreateBatchEligibleWhereSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    options: PublishEligibilityOptions
): Prisma.Sql {
    const a = config.tableAlias;
    const warningClause = options.includeWarnings
        ? Prisma.sql`TRUE`
        : Prisma.sql`NOT ${hasValidationWarningsSql(a)}`;

    return Prisma.sql`
        ${col(a, "review_batch_id")} = ${reviewBatchId}
        AND ${col(a, "review_status")} = 'approved'
        AND ${col(a, "review_decision")} IN ${Prisma.raw(IMPORT_REVIEW_APPLY_READY_DECISION_SQL_IN)}
        AND ${col(a, "promotion_status")} = 'not_ready'
        AND NOT ${isPromotedSql(a)}
        AND NOT ${isBlockedInActiveBatchSql(config, a)}
        ${createBatchRoadRequiredFieldsSql(config, a)}
        AND ${warningClause}
    `;
}

export function buildSelectCreateBatchEligibleCandidateIdsSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    options: PublishEligibilityOptions,
    selectOptions?: { limit?: number; candidateIds?: readonly bigint[] }
): Prisma.Sql {
    const a = config.tableAlias;
    const eligible = buildCreateBatchEligibleWhereSql(config, reviewBatchId, options);
    const idFilter =
        selectOptions?.candidateIds && selectOptions.candidateIds.length > 0
            ? Prisma.sql`AND ${col(a, "id")} IN (${Prisma.join(selectOptions.candidateIds)})`
            : Prisma.empty;
    const limitClause =
        selectOptions?.limit !== undefined && selectOptions.limit > 0
            ? Prisma.sql`LIMIT ${selectOptions.limit}`
            : Prisma.empty;

    return Prisma.sql`
        SELECT ${col(a, "id")} AS id
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        WHERE ${eligible}
        ${idFilter}
        ORDER BY ${col(a, "id")} ASC
        ${limitClause}
    `;
}

export function buildCountCreateBatchEligibleCandidatesSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    options: PublishEligibilityOptions,
    candidateIds?: readonly bigint[]
): Prisma.Sql {
    const a = config.tableAlias;
    const eligible = buildCreateBatchEligibleWhereSql(config, reviewBatchId, options);
    const idFilter =
        candidateIds && candidateIds.length > 0
            ? Prisma.sql`AND ${col(a, "id")} IN (${Prisma.join(candidateIds)})`
            : Prisma.empty;

    return Prisma.sql`
        SELECT count(*)::bigint AS count
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        WHERE ${eligible}
        ${idFilter}
    `;
}
