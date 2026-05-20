import { Prisma } from "@prisma/client";

import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import { IMPORT_REVIEW_PUBLISH_ACTIVE_BATCH_STATUSES } from "./import-review-promotion.types.js";

export type PublishEligibilityOptions = {
    includeWarnings: boolean;
    includeMerged: boolean;
};

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

function hasValidationWarningsSql(alias: string): Prisma.Sql {
    const warnings = col(alias, "validation_warnings");
    return Prisma.sql`(
        ${warnings} IS NOT NULL
        AND jsonb_typeof(${warnings}) = 'array'
        AND jsonb_array_length(${warnings}) > 0
    )`;
}

function isPromotedSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        ${col(alias, "promotion_status")} = 'promoted'
        OR ${col(alias, "review_status")} = 'promoted'
    )`;
}

function isBlockedInActiveBatchSql(config: ImportReviewPublishFamilyConfig, alias: string): Prisma.Sql {
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
    if (includeMerged) {
        return Prisma.sql`(
            ${col(alias, "match_status")} IS DISTINCT FROM 'duplicate_candidate'
            AND ${col(alias, "match_status")} IS DISTINCT FROM 'possible_duplicate'
            OR ${col(alias, "review_decision")} = 'merged'
            OR (
                ${col(alias, "match_status")} IN ('duplicate_candidate', 'possible_duplicate')
                AND trim(coalesce(${col(alias, "review_note")}, '')) <> ''
            )
        )`;
    }
    return Prisma.sql`(
        ${col(alias, "match_status")} IS DISTINCT FROM 'duplicate_candidate'
        AND ${col(alias, "match_status")} IS DISTINCT FROM 'possible_duplicate'
        OR (
            ${col(alias, "match_status")} IN ('duplicate_candidate', 'possible_duplicate')
            AND trim(coalesce(${col(alias, "review_note")}, '')) <> ''
        )
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
        AND ${col(a, "review_status")} = 'approved'
        AND ${col(a, "review_decision")} = 'approved'
        AND NOT ${isPromotedSql(a)}
        AND NOT ${hasValidationErrorsSql(a)}
        AND ${col(a, "review_decision")} IS DISTINCT FROM 'rejected'
        AND ${col(a, "review_decision")} IS DISTINCT FROM 'ignored'
        AND ${col(a, "review_decision")} IS DISTINCT FROM 'needs_more_review'
        AND ${col(a, "review_status")} IS DISTINCT FROM 'needs_more_review'
        AND ${col(a, "match_status")} IS DISTINCT FROM 'manual_protected'
        AND ${col(a, "auto_action")} IS DISTINCT FROM 'protect_manual'
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

export function buildPublishActionExpr(alias: string): Prisma.Sql {
    return Prisma.sql`
        CASE
            WHEN ${col(alias, "match_status")} = 'duplicate_candidate' AND ${col(alias, "review_decision")} = 'merged' THEN 'merge'
            WHEN ${col(alias, "auto_action")} = 'update_candidate' OR ${col(alias, "matched_core_id")} IS NOT NULL THEN 'update'
            ELSE 'insert'
        END
    `;
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
        AND ${col(a, "review_status")} = 'approved'
        AND ${col(a, "review_decision")} = 'approved'
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
                  AND NOT (${eligible})
                  AND NOT ${isPromotedSql(a)}
                  AND NOT ${isBlockedInActiveBatchSql(config, a)}
            )::bigint AS excluded,
            count(*) FILTER (WHERE ${baseApproved} AND ${hasValidationErrorsSql(a)})::bigint AS has_validation_errors,
            count(*) FILTER (
                WHERE ${baseApproved}
                  AND (
                      ${col(a, "match_status")} = 'manual_protected'
                      OR ${col(a, "auto_action")} = 'protect_manual'
                  )
            )::bigint AS manual_protected,
            count(*) FILTER (
                WHERE ${baseApproved}
                  AND ${col(a, "match_status")} IN ('duplicate_candidate', 'possible_duplicate')
                  AND ${col(a, "review_decision")} IS DISTINCT FROM 'merged'
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
                'source_snapshot_version', ${col(a, "source_snapshot_version")},
                'validation_errors_count', ${errorsCount},
                'validation_warnings_count', ${warningsCount}
            ),
            jsonb_build_object(
                'eligible', true,
                'validation_errors_count', ${errorsCount},
                'validation_warnings_count', ${warningsCount}
            ),
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

export function buildSelectEligibleCandidateIdsSql(
    config: ImportReviewPublishFamilyConfig,
    reviewBatchId: bigint,
    options: PublishEligibilityOptions
): Prisma.Sql {
    const a = config.tableAlias;
    const eligible = buildEligibleWhereSql(config, reviewBatchId, options);
    return Prisma.sql`
        SELECT ${col(a, "id")} AS id
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        WHERE ${eligible}
        ORDER BY ${col(a, "id")} ASC
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
            'source_snapshot_version', ${col(a, "source_snapshot_version")},
            'validation_errors_count', ${errorsCount},
            'validation_warnings_count', ${warningsCount}
        ),
        jsonb_build_object(
            'eligible', true,
            'validation_errors_count', ${errorsCount},
            'validation_warnings_count', ${warningsCount}
        ),
        now()
    `;
}

/** Insert publish items for pre-selected candidate IDs (lightweight active-batch recheck only). */
export function buildInsertPublishItemsByIdsSql(
    config: ImportReviewPublishFamilyConfig,
    batchId: bigint,
    candidateIds: bigint[]
): Prisma.Sql {
    const a = config.tableAlias;
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
            created_at
        )
        SELECT ${publishItemSelectColumns(config, batchId, a)}
        FROM ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        WHERE ${col(a, "id")} IN (${Prisma.join(candidateIds)})
          AND NOT ${isBlockedInActiveBatchSql(config, a)}
    `;
}

/** Mark pre-selected candidates batched (IDs must match inserted publish items). */
export function buildMarkBatchedByIdsSql(
    config: ImportReviewPublishFamilyConfig,
    candidateIds: bigint[]
): Prisma.Sql {
    const a = config.tableAlias;
    return Prisma.sql`
        UPDATE ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(a)}
        SET promotion_status = 'batched', updated_at = now()
        WHERE ${col(a, "id")} IN (${Prisma.join(candidateIds)})
          AND (
              ${col(a, "promotion_status")} IS NULL
              OR trim(coalesce(${col(a, "promotion_status")}::text, '')) = ''
              OR ${col(a, "promotion_status")} IN ('not_ready', 'ready', 'batched')
          )
    `;
}
