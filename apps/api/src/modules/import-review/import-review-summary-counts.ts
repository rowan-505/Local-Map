import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";

/**
 * Count definitions for GET /api/import-review/summary.
 *
 * All metrics are scoped to a single review_batch_id (never mixed across batches).
 *
 * - batch_total: every candidate row in the batch, including promoted.
 * - active: not promoted (promotion_status and review_status both distinct from 'promoted').
 * - pending_review, approved, rejected, needs_review, ignored, merged: subsets of active only.
 * - ready_for_publish: active, fully approved, no validation_errors, promotion_status not promoted/failed.
 * - promoted: promotion_status = 'promoted' OR review_status = 'promoted'.
 * - promotion_failed: promotion_status = 'failed' OR review_status = 'promotion_failed'.
 */

/** SQL alias-qualified column reference, e.g. `c.review_status`. */
function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

/** Candidate is promoted (excluded from active review counts). */
export function summaryIsPromotedSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        ${col(alias, "promotion_status")} = 'promoted'
        OR ${col(alias, "review_status")} = 'promoted'
    )`;
}

/** Candidate is active for review (not promoted). */
export function summaryIsActiveSql(alias: string): Prisma.Sql {
    return Prisma.sql`NOT ${summaryIsPromotedSql(alias)}`;
}

/** Candidate has a non-empty validation_errors JSON array. */
export function summaryHasValidationErrorsSql(alias: string): Prisma.Sql {
    const errors = col(alias, "validation_errors");
    return Prisma.sql`(
        ${errors} IS NOT NULL
        AND jsonb_typeof(${errors}) = 'array'
        AND jsonb_array_length(${errors}) > 0
    )`;
}

/** Candidate has a non-empty validation_warnings JSON array. */
export function summaryHasValidationWarningsSql(alias: string): Prisma.Sql {
    const warnings = col(alias, "validation_warnings");
    return Prisma.sql`(
        ${warnings} IS NOT NULL
        AND jsonb_typeof(${warnings}) = 'array'
        AND jsonb_array_length(${warnings}) > 0
    )`;
}

export function buildFamilySummaryMetricsSql(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchId: bigint
): Prisma.Sql {
    const a = config.tableAlias;
    const active = summaryIsActiveSql(a);
    const promoted = summaryIsPromotedSql(a);

    return Prisma.sql`
        SELECT
            ${config.entityFamily}::text AS entity_family,
            ${Prisma.raw(`'import_review.${config.importReviewTable}'`)}::text AS table_name,
            count(*)::bigint AS batch_total,
            count(*) FILTER (WHERE ${active})::bigint AS active,
            count(*) FILTER (
                WHERE ${active}
                  AND ${col(a, "review_status")} IN ('pending', 'needs_review')
            )::bigint AS pending_review,
            count(*) FILTER (
                WHERE ${active}
                  AND ${col(a, "review_decision")} = 'approved'
            )::bigint AS approved,
            count(*) FILTER (
                WHERE ${active}
                  AND ${col(a, "review_decision")} = 'rejected'
            )::bigint AS rejected,
            count(*) FILTER (
                WHERE ${active}
                  AND (
                      ${col(a, "review_status")} = 'needs_review'
                      OR ${col(a, "review_decision")} = 'needs_more_review'
                  )
            )::bigint AS needs_review,
            count(*) FILTER (
                WHERE ${active}
                  AND ${col(a, "review_decision")} = 'ignored'
            )::bigint AS ignored,
            count(*) FILTER (
                WHERE ${active}
                  AND ${col(a, "review_decision")} = 'merged'
            )::bigint AS merged,
            count(*) FILTER (
                WHERE ${active}
                  AND ${col(a, "review_status")} = 'approved'
                  AND ${col(a, "review_decision")} = 'approved'
                  AND NOT ${summaryHasValidationErrorsSql(a)}
                  AND (
                      ${col(a, "promotion_status")} IS NULL
                      OR trim(coalesce(${col(a, "promotion_status")}::text, '')) = ''
                      OR ${col(a, "promotion_status")} NOT IN ('promoted', 'failed')
                  )
            )::bigint AS ready_for_publish,
            count(*) FILTER (WHERE ${promoted})::bigint AS promoted,
            count(*) FILTER (
                WHERE ${col(a, "promotion_status")} = 'failed'
                   OR ${col(a, "review_status")} = 'promotion_failed'
            )::bigint AS promotion_failed,
            count(*) FILTER (WHERE ${summaryHasValidationErrorsSql(a)})::bigint AS validation_error_count,
            count(*) FILTER (WHERE ${summaryHasValidationWarningsSql(a)})::bigint AS validation_warning_count
        FROM ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(a)}
        WHERE ${col(a, "review_batch_id")} = ${reviewBatchId}
          AND ${col(a, "entity_family")} = ${config.entityFamily}
    `;
}

/** Per-batch family metrics for history list pages (`review_batch_id IN (...)`). */
export function buildFamilySummaryMetricsForBatchIdsSql(
    config: ImportReviewEntityFamilyConfig,
    reviewBatchIds: bigint[]
): Prisma.Sql | null {
    if (reviewBatchIds.length === 0) {
        return null;
    }
    const a = config.tableAlias;
    const active = summaryIsActiveSql(a);
    const promoted = summaryIsPromotedSql(a);

    return Prisma.sql`
        SELECT
            ${col(a, "review_batch_id")} AS review_batch_id,
            ${config.entityFamily}::text AS entity_family,
            ${Prisma.raw(`'import_review.${config.importReviewTable}'`)}::text AS table_name,
            count(*)::bigint AS batch_total,
            count(*) FILTER (WHERE ${active})::bigint AS active,
            count(*) FILTER (
                WHERE ${active}
                  AND ${col(a, "review_status")} IN ('pending', 'needs_review')
            )::bigint AS pending_review,
            count(*) FILTER (
                WHERE ${active}
                  AND ${col(a, "review_decision")} = 'approved'
            )::bigint AS approved,
            count(*) FILTER (
                WHERE ${active}
                  AND ${col(a, "review_decision")} = 'rejected'
            )::bigint AS rejected,
            count(*) FILTER (
                WHERE ${active}
                  AND (
                      ${col(a, "review_status")} = 'needs_review'
                      OR ${col(a, "review_decision")} = 'needs_more_review'
                  )
            )::bigint AS needs_review,
            count(*) FILTER (
                WHERE ${active}
                  AND ${col(a, "review_decision")} = 'ignored'
            )::bigint AS ignored,
            count(*) FILTER (
                WHERE ${active}
                  AND ${col(a, "review_decision")} = 'merged'
            )::bigint AS merged,
            count(*) FILTER (
                WHERE ${active}
                  AND ${col(a, "review_status")} = 'approved'
                  AND ${col(a, "review_decision")} = 'approved'
                  AND NOT ${summaryHasValidationErrorsSql(a)}
                  AND (
                      ${col(a, "promotion_status")} IS NULL
                      OR trim(coalesce(${col(a, "promotion_status")}::text, '')) = ''
                      OR ${col(a, "promotion_status")} NOT IN ('promoted', 'failed')
                  )
            )::bigint AS ready_for_publish,
            count(*) FILTER (WHERE ${promoted})::bigint AS promoted,
            count(*) FILTER (
                WHERE ${col(a, "promotion_status")} = 'failed'
                   OR ${col(a, "review_status")} = 'promotion_failed'
            )::bigint AS promotion_failed,
            count(*) FILTER (WHERE ${summaryHasValidationErrorsSql(a)})::bigint AS validation_error_count,
            count(*) FILTER (WHERE ${summaryHasValidationWarningsSql(a)})::bigint AS validation_warning_count
        FROM ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(a)}
        WHERE ${col(a, "review_batch_id")} IN (${Prisma.join(reviewBatchIds)})
          AND ${col(a, "entity_family")} = ${config.entityFamily}
        GROUP BY ${col(a, "review_batch_id")}
    `;
}

export type ImportReviewFamilySummaryMetricsDb = {
    entity_family: string;
    table_name: string;
    batch_total: bigint;
    active: bigint;
    pending_review: bigint;
    approved: bigint;
    rejected: bigint;
    needs_review: bigint;
    ignored: bigint;
    merged: bigint;
    ready_for_publish: bigint;
    promoted: bigint;
    promotion_failed: bigint;
    validation_error_count: bigint;
    validation_warning_count: bigint;
};

export type ImportReviewFamilySummaryMetricsByBatchDb = ImportReviewFamilySummaryMetricsDb & {
    review_batch_id: bigint;
};

export type ImportReviewSummaryRollupMetrics = {
    batch_total_candidates: number;
    active_candidates: number;
    pending_review_candidates: number;
    approved_candidates: number;
    rejected_candidates: number;
    needs_review_candidates: number;
    ignored_candidates: number;
    merged_candidates: number;
    ready_for_publish_candidates: number;
    promoted_candidates: number;
    promotion_failed_candidates: number;
};

export type ImportReviewFamilySummaryMetrics = {
    entity_family: string;
    table_name: string;
    batch_total: number;
    active: number;
    pending_review: number;
    approved: number;
    rejected: number;
    needs_review: number;
    ignored: number;
    merged: number;
    ready_for_publish: number;
    promoted: number;
    promotion_failed: number;
    validation_error_count: number;
    validation_warning_count: number;
};

function n(v: bigint | number): number {
    return typeof v === "bigint" ? Number(v) : v;
}

export function mapFamilySummaryMetricsDb(
    row: ImportReviewFamilySummaryMetricsDb
): ImportReviewFamilySummaryMetrics {
    return {
        entity_family: row.entity_family,
        table_name: row.table_name,
        batch_total: n(row.batch_total),
        active: n(row.active),
        pending_review: n(row.pending_review),
        approved: n(row.approved),
        rejected: n(row.rejected),
        needs_review: n(row.needs_review),
        ignored: n(row.ignored),
        merged: n(row.merged),
        ready_for_publish: n(row.ready_for_publish),
        promoted: n(row.promoted),
        promotion_failed: n(row.promotion_failed),
        validation_error_count: n(row.validation_error_count),
        validation_warning_count: n(row.validation_warning_count),
    };
}

export function rollupFamilySummaries(
    families: ImportReviewFamilySummaryMetrics[]
): ImportReviewSummaryRollupMetrics {
    const sum = (pick: (f: ImportReviewFamilySummaryMetrics) => number) =>
        families.reduce((acc, f) => acc + pick(f), 0);

    return {
        batch_total_candidates: sum((f) => f.batch_total),
        active_candidates: sum((f) => f.active),
        pending_review_candidates: sum((f) => f.pending_review),
        approved_candidates: sum((f) => f.approved),
        rejected_candidates: sum((f) => f.rejected),
        needs_review_candidates: sum((f) => f.needs_review),
        ignored_candidates: sum((f) => f.ignored),
        merged_candidates: sum((f) => f.merged),
        ready_for_publish_candidates: sum((f) => f.ready_for_publish),
        promoted_candidates: sum((f) => f.promoted),
        promotion_failed_candidates: sum((f) => f.promotion_failed),
    };
}
