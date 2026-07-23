import { Prisma } from "@prisma/client";

import { buildCreateBatchEligibleWhereSql } from "./import-review-promotion-create-batch-eligibility.js";
import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import {
    hasRoadPromotionBlockingErrorsSql,
    roadClassMissingWithoutFallbackSql,
    roadDuplicateCoreExternalIdSql,
} from "./import-review-road-promotion-policy.js";
import {
    IMPORT_REVIEW_PUBLISH_ACTIVE_BATCH_STATUSES,
    IMPORT_REVIEW_PUBLISH_ITEM_RETRY_ALLOWED_STATUSES,
    IMPORT_REVIEW_SELECTED_PROMOTION_BLOCKING_BATCH_STATUSES,
} from "./import-review-promotion.types.js";
import {
    IMPORT_REVIEW_APPLY_BATCH_DECISION_SQL_IN,
    IMPORT_REVIEW_APPLY_READY_DECISION_SQL_IN,
    IMPORT_REVIEW_SKIP_APPLY_DECISION_SQL_IN,
} from "./import-review-status-model.js";
import { buildDecisionPublishActionExpr } from "./import-review-decision-publish-action.js";

export type PublishEligibilityOptions = {
    includeWarnings: boolean;
    includeMerged: boolean;
};

/** Dashboard eligibility detail buckets — must match {@link buildFamilyEligibilityCountSql}. */
export type PromotionEligibilityBucket = "ready" | "warnings" | "blocked" | "batched" | "promoted";

export const PROMOTION_ELIGIBILITY_BUCKETS = [
    "ready",
    "warnings",
    "blocked",
    "batched",
    "promoted",
] as const satisfies readonly PromotionEligibilityBucket[];

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

export function jsonbArrayLengthExpr(column: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
        CASE
            WHEN ${column} IS NULL THEN 0
            WHEN jsonb_typeof(${column}) = 'array' THEN jsonb_array_length(${column})
            ELSE 0
        END
    `;
}

function hasValidationErrorsSql(alias: string): Prisma.Sql {
    const errors = col(alias, "validation_errors");
    return Prisma.sql`(
        ${errors} IS NOT NULL
        AND jsonb_typeof(${errors}) = 'array'
        AND jsonb_array_length(${errors}) > 0
    )`;
}

function hasPromotionBlockingValidationErrorsSql(
    config: ImportReviewPublishFamilyConfig,
    alias: string
): Prisma.Sql {
    if (config.entityFamily === "roads") {
        return hasRoadPromotionBlockingErrorsSql(alias);
    }
    return hasValidationErrorsSql(alias);
}

function roadPromotionEligibilityGuardsSql(
    config: ImportReviewPublishFamilyConfig,
    alias: string
): Prisma.Sql {
    if (config.entityFamily !== "roads") {
        return Prisma.empty;
    }
    return Prisma.sql`
        AND NOT ${roadDuplicateCoreExternalIdSql(alias)}
        AND NOT ${roadClassMissingWithoutFallbackSql(alias)}
    `;
}

function hasValidationWarningsSql(alias: string): Prisma.Sql {
    const warnings = col(alias, "validation_warnings");
    return Prisma.sql`(
        ${warnings} IS NOT NULL
        AND jsonb_typeof(${warnings}) = 'array'
        AND jsonb_array_length(${warnings}) > 0
    )`;
}

export function isPromotedSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        ${col(alias, "promotion_status")} = 'promoted'
        OR ${col(alias, "review_status")} = 'promoted'
    )`;
}

/** Selected-mode: only truly promoted rows (not review_status-only flags). */
export function isSelectedCandidatePromotedSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        ${col(alias, "promotion_status")} = 'promoted'
        OR ${col(alias, "promoted_core_id")} IS NOT NULL
    )`;
}

export function selectedCandidateReviewStatusEligibleSql(alias: string): Prisma.Sql {
    return Prisma.sql`${col(alias, "review_status")} IN ('approved', 'promotion_failed')`;
}

export function selectedCandidatePromotionStatusEligibleSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        ${col(alias, "promotion_status")} IS NULL
        OR trim(coalesce(${col(alias, "promotion_status")}::text, '')) = ''
        OR ${col(alias, "promotion_status")} IN ('not_ready', 'ready', 'batched', 'failed')
    )`;
}

/**
 * Selected-mode retry: block only in-flight batches (draft/validating/promoting) with non-terminal items.
 * Failed/cancelled batches and failed/skipped publish items do not block a new batch.
 */
export function isBlockedInSelectedPromotionRetrySql(
    config: ImportReviewPublishFamilyConfig,
    alias: string
): Prisma.Sql {
    const blockingStatuses = IMPORT_REVIEW_SELECTED_PROMOTION_BLOCKING_BATCH_STATUSES.map(
        (s) => Prisma.sql`${s}`
    );
    const retryAllowedItemStatuses = IMPORT_REVIEW_PUBLISH_ITEM_RETRY_ALLOWED_STATUSES.map(
        (s) => Prisma.sql`${s}`
    );
    return Prisma.sql`EXISTS (
        SELECT 1
        FROM system.system_publish_items AS spi
        INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
        WHERE spi.review_candidate_table = ${config.candidateTable}
          AND spi.review_candidate_id = ${col(alias, "id")}
          AND spb.status IN (${Prisma.join(blockingStatuses)})
          AND COALESCE(spi.publish_status, 'pending') NOT IN (${Prisma.join(retryAllowedItemStatuses)})
    )`;
}

export function isBlockedInActiveBatchSql(config: ImportReviewPublishFamilyConfig, alias: string): Prisma.Sql {
    const activeStatuses = IMPORT_REVIEW_PUBLISH_ACTIVE_BATCH_STATUSES.map((s) => Prisma.sql`${s}`);
    return Prisma.sql`EXISTS (
        SELECT 1
        FROM system.system_publish_items AS spi
        INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
        WHERE spi.review_candidate_table = ${config.candidateTable}
          AND spi.review_candidate_id = ${col(alias, "id")}
          AND spb.status IN (${Prisma.join(activeStatuses)})
    )`;
}

function duplicateGuardSql(alias: string, includeMerged: boolean): Prisma.Sql {
    const duplicateResolved = Prisma.sql`
        ${col(alias, "review_decision")} IN ('merged', 'mark_duplicate')
        OR (
            ${col(alias, "match_status")} IN ('duplicate_candidate', 'possible_duplicate')
            AND trim(coalesce(${col(alias, "review_note")}, '')) <> ''
        )
    `;
    if (includeMerged) {
        return Prisma.sql`(
            ${col(alias, "match_status")} IS DISTINCT FROM 'duplicate_candidate'
            AND ${col(alias, "match_status")} IS DISTINCT FROM 'possible_duplicate'
            OR ${duplicateResolved}
        )`;
    }
    return Prisma.sql`(
        ${col(alias, "match_status")} IS DISTINCT FROM 'duplicate_candidate'
        AND ${col(alias, "match_status")} IS DISTINCT FROM 'possible_duplicate'
        OR ${duplicateResolved}
    )`;
}

/** review_status must match write vs skip decision storage. */
export function applyBatchReviewStatusSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        (
            ${col(alias, "review_decision")} IN ${Prisma.raw(IMPORT_REVIEW_APPLY_READY_DECISION_SQL_IN)}
            AND ${col(alias, "review_status")} = 'approved'
        )
        OR (
            ${col(alias, "review_decision")} IN ${Prisma.raw(IMPORT_REVIEW_SKIP_APPLY_DECISION_SQL_IN)}
            AND ${col(alias, "review_status")} IN ('ignored', 'merged', 'approved')
        )
    )`;
}

/**
 * manual_protected blocks only when no Apply decision was recorded.
 * Once a reviewer saved keep_existing / replace_existing / etc., eligibility may proceed.
 */
export function manualProtectedBlockSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        (
            ${col(alias, "match_status")} = 'manual_protected'
            OR ${col(alias, "auto_action")} = 'protect_manual'
        )
        AND ${col(alias, "review_decision")} IS NULL
    )`;
}

/** Core approved-only eligibility (excludes warnings per includeWarnings flag). */
export function buildEligibleWhereSql(
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
        AND ${col(a, "entity_family")} = ${config.entityFamily}
        AND ${applyBatchReviewStatusSql(a)}
        AND ${col(a, "review_decision")} IN ${Prisma.raw(IMPORT_REVIEW_APPLY_BATCH_DECISION_SQL_IN)}
        AND NOT ${isPromotedSql(a)}
        AND NOT ${hasPromotionBlockingValidationErrorsSql(config, a)}
        ${roadPromotionEligibilityGuardsSql(config, a)}
        AND ${col(a, "review_decision")} IS DISTINCT FROM 'needs_more_review'
        AND ${col(a, "review_status")} IS DISTINCT FROM 'needs_more_review'
        AND NOT ${manualProtectedBlockSql(a)}
        AND ${duplicateGuardSql(a, options.includeMerged)}
        AND NOT ${isBlockedInActiveBatchSql(config, a)}
        AND (
            ${col(a, "promotion_status")} IS NULL
            OR trim(coalesce(${col(a, "promotion_status")}::text, '')) = ''
            OR ${col(a, "promotion_status")} IN ('not_ready', 'ready', 'batched')
        )
        AND ${warningClause}
    `;
}

/** Eligible if warnings were ignored (for with_warnings bucket). */
export function buildEligibleExceptWarningsSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    options: PublishEligibilityOptions
): Prisma.Sql {
    return buildEligibleWhereSql(config, reviewBatchId, { ...options, includeWarnings: true });
}

function buildBaseScopeSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    alias: string
): Prisma.Sql {
    return Prisma.sql`
        ${col(alias, "review_batch_id")} = ${reviewBatchId}
        AND ${col(alias, "entity_family")} = ${config.entityFamily}
    `;
}

function buildBaseApprovedSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    alias: string
): Prisma.Sql {
    return Prisma.sql`
        ${buildBaseScopeSql(config, reviewBatchId, alias)}
        AND ${applyBatchReviewStatusSql(alias)}
        AND ${col(alias, "review_decision")} IN ${Prisma.raw(IMPORT_REVIEW_APPLY_BATCH_DECISION_SQL_IN)}
    `;
}

/**
 * WHERE clause for a single eligibility bucket (same rules as count endpoint).
 */
export function buildPromotionEligibilityBucketWhereSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    bucket: PromotionEligibilityBucket,
    options: PublishEligibilityOptions
): Prisma.Sql {
    const a = config.tableAlias;
    const eligible = buildEligibleWhereSql(config, reviewBatchId, options);
    const eligibleWithWarnings = buildEligibleExceptWarningsSql(config, reviewBatchId, options);
    const baseScope = buildBaseScopeSql(config, reviewBatchId, a);
    const baseApproved = buildBaseApprovedSql(config, reviewBatchId, a);

    switch (bucket) {
        case "ready":
            return eligible;
        case "warnings":
            return Prisma.sql`
                ${eligibleWithWarnings}
                  AND ${hasValidationWarningsSql(a)}
                  AND NOT ${isPromotedSql(a)}
                  AND NOT ${isBlockedInActiveBatchSql(config, a)}
            `;
        case "blocked":
            return Prisma.sql`
                ${baseApproved}
                  AND NOT (${eligibleWithWarnings})
                  AND NOT ${isPromotedSql(a)}
                  AND NOT ${isBlockedInActiveBatchSql(config, a)}
            `;
        case "batched":
            return Prisma.sql`
                ${baseScope}
                  AND ${isBlockedInActiveBatchSql(config, a)}
            `;
        case "promoted":
            return Prisma.sql`
                ${baseScope}
                  AND ${isPromotedSql(a)}
            `;
        default: {
            const _exhaustive: never = bucket;
            return _exhaustive;
        }
    }
}

export function buildPublishActionExpr(alias: string): Prisma.Sql {
    return buildDecisionPublishActionExpr(alias);
}

export type FamilyEligibilityCountDb = {
    entity_family: string;
    table_name: string;
    approved_ready: bigint;
    with_warnings: bigint;
    blocked: bigint;
    already_promoted: bigint;
    excluded: bigint;
    has_validation_errors: bigint;
    manual_protected: bigint;
    duplicate_unconfirmed: bigint;
    rejected_decision: bigint;
};

export function buildFamilyEligibilityCountSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    options: PublishEligibilityOptions
): Prisma.Sql {
    const a = config.tableAlias;
    const eligible = buildEligibleWhereSql(config, reviewBatchId, options);
    const eligibleWithWarnings = buildEligibleExceptWarningsSql(config, reviewBatchId, options);
    const baseScope = Prisma.sql`
        ${col(a, "review_batch_id")} = ${reviewBatchId}
        AND ${col(a, "entity_family")} = ${config.entityFamily}
    `;
    const baseApproved = Prisma.sql`
        ${baseScope}
        AND ${applyBatchReviewStatusSql(a)}
        AND ${col(a, "review_decision")} IN ${Prisma.raw(IMPORT_REVIEW_APPLY_BATCH_DECISION_SQL_IN)}
    `;

    return Prisma.sql`
        SELECT
            ${config.entityFamily}::text AS entity_family,
            ${config.candidateTable}::text AS table_name,
            count(*) FILTER (WHERE ${eligible})::bigint AS approved_ready,
            count(*) FILTER (
                WHERE ${eligibleWithWarnings}
                  AND ${hasValidationWarningsSql(a)}
                  AND NOT ${isPromotedSql(a)}
                  AND NOT ${isBlockedInActiveBatchSql(config, a)}
            )::bigint AS with_warnings,
            count(*) FILTER (WHERE ${isBlockedInActiveBatchSql(config, a)})::bigint AS blocked,
            count(*) FILTER (WHERE ${isPromotedSql(a)})::bigint AS already_promoted,
            count(*) FILTER (
                WHERE ${baseApproved}
                  AND NOT (${eligibleWithWarnings})
                  AND NOT ${isPromotedSql(a)}
                  AND NOT ${isBlockedInActiveBatchSql(config, a)}
            )::bigint AS excluded,
            count(*) FILTER (
                WHERE ${baseApproved} AND ${hasPromotionBlockingValidationErrorsSql(config, a)}
            )::bigint AS has_validation_errors,
            count(*) FILTER (
                WHERE ${baseApproved}
                  AND ${manualProtectedBlockSql(a)}
            )::bigint AS manual_protected,
            count(*) FILTER (
                WHERE ${baseApproved}
                  AND ${col(a, "match_status")} IN ('duplicate_candidate', 'possible_duplicate')
                  AND ${col(a, "review_decision")} IS DISTINCT FROM 'merged'
                  AND ${col(a, "review_decision")} IS DISTINCT FROM 'mark_duplicate'
                  AND trim(coalesce(${col(a, "review_note")}, '')) = ''
            )::bigint AS duplicate_unconfirmed,
            count(*) FILTER (
                WHERE ${col(a, "review_decision")} IN ('rejected', 'ignored', 'needs_more_review')
                   OR ${col(a, "review_status")} = 'needs_more_review'
            )::bigint AS rejected_decision
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        WHERE ${baseScope}
    `;
}

export function buildInsertPublishItemsSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    batchId: bigint,
    options: PublishEligibilityOptions
): Prisma.Sql {
    const a = config.tableAlias;
    const eligible = buildEligibleWhereSql(config, reviewBatchId, options);
    const warningsCount = jsonbArrayLengthExpr(col(a, "validation_warnings"));
    const errorsCount = jsonbArrayLengthExpr(col(a, "validation_errors"));

    return Prisma.sql`
        INSERT INTO system.system_publish_items (
            publish_batch_id,
            entity_family,
            entity_id,
            review_candidate_table,
            review_candidate_id,
            external_id,
            target_schema,
            target_table,
            publish_action,
            publish_status,
            before_data,
            validation_result,
            review_decision,
            source_snapshot_version,
            created_at
        )
        SELECT
            ${batchId},
            ${config.entityFamily},
            ${col(a, "id")},
            ${config.candidateTable},
            ${col(a, "id")},
            ${col(a, "external_id")},
            'core',
            ${config.coreTargetTable},
            ${buildPublishActionExpr(a)},
            'pending',
            jsonb_build_object(
                'id', ${col(a, "id")}::text,
                'external_id', ${col(a, "external_id")},
                'match_status', ${col(a, "match_status")},
                'review_decision', ${col(a, "review_decision")},
                'review_status', ${col(a, "review_status")},
                'promotion_status', ${col(a, "promotion_status")},
                'matched_core_id', ${col(a, "matched_core_id")},
                'source_snapshot_version', ${col(a, "source_snapshot_version")},
                'validation_errors_count', ${errorsCount},
                'validation_warnings_count', ${warningsCount}
            ),
            jsonb_build_object(
                'eligible', true,
                'review_decision', ${col(a, "review_decision")},
                'match_status', ${col(a, "match_status")},
                'source_snapshot_version', ${col(a, "source_snapshot_version")},
                'validation_errors_count', ${errorsCount},
                'validation_warnings_count', ${warningsCount}
            ),
            ${col(a, "review_decision")},
            ${col(a, "source_snapshot_version")},
            now()
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        WHERE ${eligible}
    `;
}

export function buildMarkBatchedSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    options: PublishEligibilityOptions
): Prisma.Sql {
    const a = config.tableAlias;
    const eligible = buildEligibleWhereSql(config, reviewBatchId, options);
    return Prisma.sql`
        UPDATE ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        SET promotion_status = 'batched', updated_at = now()
        WHERE ${eligible}
    `;
}

/** Lightweight roads test batches: approved + promotion_status not_ready only. */
export function buildRoadsSmallBatchEligibleWhereSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint
): Prisma.Sql {
    const a = config.tableAlias;
    return Prisma.sql`
        ${col(a, "review_batch_id")} = ${reviewBatchId}
        AND ${col(a, "entity_family")} = ${config.entityFamily}
        AND ${col(a, "review_status")} = 'approved'
        AND ${col(a, "review_decision")} IN ${Prisma.raw(IMPORT_REVIEW_APPLY_READY_DECISION_SQL_IN)}
        AND ${col(a, "promotion_status")} = 'not_ready'
        AND ${col(a, "promotion_status")} IS DISTINCT FROM 'promoted'
        AND ${col(a, "promotion_status")} IS DISTINCT FROM 'batched'
        AND ${col(a, "promotion_status")} IS DISTINCT FROM 'failed'
        AND ${col(a, "promotion_status")} IS DISTINCT FROM 'rejected'
        AND ${col(a, "promotion_status")} IS DISTINCT FROM 'pending'
        AND ${col(a, "promotion_status")} IS DISTINCT FROM 'needs_review'
        AND NOT ${isPromotedSql(a)}
        AND NOT ${isBlockedInActiveBatchSql(config, a)}
        AND ${col(a, "review_status")} IS DISTINCT FROM 'promoted'
        AND ${col(a, "review_status")} IS DISTINCT FROM 'pending'
        AND ${col(a, "review_status")} IS DISTINCT FROM 'needs_more_review'
        AND ${col(a, "review_decision")} IS DISTINCT FROM 'rejected'
        AND ${col(a, "review_decision")} IS DISTINCT FROM 'ignored'
        AND ${col(a, "review_decision")} IS DISTINCT FROM 'needs_more_review'
    `;
}

export type SelectEligibleCandidateIdsOptions = {
    limit?: number;
    /** Use roads small-batch predicate (approved + not_ready) instead of full eligibility guards. */
    smallBatchRoads?: boolean;
};

export function buildSelectEligibleCandidateIdsSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    options: PublishEligibilityOptions,
    selectOptions?: SelectEligibleCandidateIdsOptions
): Prisma.Sql {
    const a = config.tableAlias;
    const eligible =
        selectOptions?.smallBatchRoads && config.entityFamily === "roads"
            ? buildRoadsSmallBatchEligibleWhereSql(config, reviewBatchId)
            : buildEligibleWhereSql(config, reviewBatchId, options);
    const limitClause =
        selectOptions?.limit !== undefined && selectOptions.limit > 0
            ? Prisma.sql`LIMIT ${selectOptions.limit}`
            : Prisma.empty;
    return Prisma.sql`
        SELECT ${col(a, "id")} AS id
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        WHERE ${eligible}
        ORDER BY ${col(a, "id")} ASC
        ${limitClause}
    `;
}

function publishItemSelectColumns(
    config: ImportReviewPublishFamilyConfig,
    batchId: bigint,
    alias: string
): Prisma.Sql {
    const a = alias;
    const warningsCount = jsonbArrayLengthExpr(col(a, "validation_warnings"));
    const errorsCount = jsonbArrayLengthExpr(col(a, "validation_errors"));
    return Prisma.sql`
        ${batchId},
        ${config.entityFamily},
        ${col(a, "id")},
        ${config.candidateTable},
        ${col(a, "id")},
        ${col(a, "external_id")},
        'core',
        ${config.coreTargetTable},
        ${buildPublishActionExpr(a)},
        'pending',
        jsonb_build_object(
            'id', ${col(a, "id")}::text,
            'external_id', ${col(a, "external_id")},
            'match_status', ${col(a, "match_status")},
            'review_decision', ${col(a, "review_decision")},
            'review_status', ${col(a, "review_status")},
            'promotion_status', ${col(a, "promotion_status")},
            'matched_core_id', ${col(a, "matched_core_id")},
            'source_snapshot_version', ${col(a, "source_snapshot_version")},
            'validation_errors_count', ${errorsCount},
            'validation_warnings_count', ${warningsCount}
        ),
        jsonb_build_object(
            'eligible', true,
            'review_decision', ${col(a, "review_decision")},
            'match_status', ${col(a, "match_status")},
            'source_snapshot_version', ${col(a, "source_snapshot_version")},
            'validation_errors_count', ${errorsCount},
            'validation_warnings_count', ${warningsCount}
        ),
        ${col(a, "review_decision")},
        ${col(a, "source_snapshot_version")},
        now()
    `;
}

/** Insert publish items for pre-selected candidate IDs (uses create-batch eligibility guards). */
export function buildInsertPublishItemsByIdsSql(
    config: ImportReviewPublishFamilyConfig,
    batchId: bigint,
    candidateIds: bigint[],
    reviewBatchId: bigint,
    options: PublishEligibilityOptions
): Prisma.Sql {
    const a = config.tableAlias;
    const eligible = buildCreateBatchEligibleWhereSql(config, reviewBatchId, options);
    return Prisma.sql`
        INSERT INTO system.system_publish_items (
            publish_batch_id,
            entity_family,
            entity_id,
            review_candidate_table,
            review_candidate_id,
            external_id,
            target_schema,
            target_table,
            publish_action,
            publish_status,
            before_data,
            validation_result,
            review_decision,
            source_snapshot_version,
            created_at
        )
        SELECT ${publishItemSelectColumns(config, batchId, a)}
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        WHERE ${col(a, "id")} IN (${Prisma.join(candidateIds)})
          AND ${eligible}
    `;
}

/**
 * Mark candidates batched for publish items inserted in the same transaction.
 * Does not require promotion_status=not_ready (insert already enforced that).
 */
export function buildMarkBatchedByIdsSql(
    config: ImportReviewPublishFamilyConfig,
    candidateIds: bigint[],
    reviewBatchId: bigint,
    _options: PublishEligibilityOptions
): Prisma.Sql {
    const a = config.tableAlias;
    return Prisma.sql`
        UPDATE ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        SET promotion_status = 'batched', updated_at = now()
        WHERE ${col(a, "id")} IN (${Prisma.join(candidateIds)})
          AND ${col(a, "review_batch_id")} = ${reviewBatchId}
          AND ${col(a, "review_status")} = 'approved'
          AND ${col(a, "review_decision")} IN ${Prisma.raw(IMPORT_REVIEW_APPLY_READY_DECISION_SQL_IN)}
          AND ${col(a, "promotion_status")} IS DISTINCT FROM 'promoted'
    `;
}
