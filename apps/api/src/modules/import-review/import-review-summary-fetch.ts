import { Prisma, type PrismaClient } from "@prisma/client";

import type { ImportReviewScopeResolved } from "./import-review-batch-resolver.js";
import { getImportReviewEntityConfig, type ImportReviewEntityFamilySlug } from "./import-review-config.js";
import type { ImportReviewSummaryBucketDb } from "./import-review-data-repository.js";
import {
    buildCombinedFamilySummarySql,
    type ImportReviewCombinedFamilySummaryDb,
    type ImportReviewFamilySummaryMetricsDb,
} from "./import-review-summary-counts.js";
import { summaryFamiliesForScope, summaryTableNamesForFamilies } from "./import-review-summary-scope.js";
import type { ImportReviewSummaryTimingSink } from "./import-review-summary-timing.js";
import { timeImportReviewSummaryStep } from "./import-review-summary-timing.js";

export type ImportReviewScopeSummaryData = {
    buckets: ImportReviewSummaryBucketDb[];
    familyMetrics: ImportReviewFamilySummaryMetricsDb[];
    warnings: string[];
};

async function batchTableExists(
    prisma: PrismaClient,
    qualifiedNames: string[]
): Promise<Set<string>> {
    if (qualifiedNames.length === 0) {
        return new Set();
    }

    const rows = await prisma.$queryRaw<{ qualified_name: string; ok: boolean }[]>`
        SELECT
            n AS qualified_name,
            to_regclass(n) IS NOT NULL AS ok
        FROM unnest(${qualifiedNames}::text[]) AS n
    `;

    return new Set(rows.filter((r) => r.ok).map((r) => r.qualified_name));
}

function parseSummaryBucketsJson(raw: unknown): ImportReviewSummaryBucketDb[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    const out: ImportReviewSummaryBucketDb[] = [];
    for (const row of raw) {
        if (row === null || typeof row !== "object") {
            continue;
        }
        const o = row as Record<string, unknown>;
        out.push({
            entity_family: String(o.entity_family ?? ""),
            review_batch_id: BigInt(String(o.review_batch_id ?? "0")),
            source_snapshot_version: String(o.source_snapshot_version ?? ""),
            match_status: o.match_status === null || o.match_status === undefined ? null : String(o.match_status),
            auto_action: o.auto_action === null || o.auto_action === undefined ? null : String(o.auto_action),
            review_status: o.review_status === null || o.review_status === undefined ? null : String(o.review_status),
            review_decision:
                o.review_decision === null || o.review_decision === undefined ? null : String(o.review_decision),
            promotion_status:
                o.promotion_status === null || o.promotion_status === undefined
                    ? null
                    : String(o.promotion_status),
            row_count: BigInt(String(o.row_count ?? "0")),
        });
    }
    return out;
}

function toFamilyMetricsRow(row: ImportReviewCombinedFamilySummaryDb): ImportReviewFamilySummaryMetricsDb {
    return {
        entity_family: row.entity_family,
        table_name: row.table_name,
        batch_total: row.batch_total,
        active: row.active,
        pending_review: row.pending_review,
        approved: row.approved,
        rejected: row.rejected,
        needs_review: row.needs_review,
        ignored: row.ignored,
        merged: row.merged,
        ready_for_publish: row.ready_for_publish,
        promoted: row.promoted,
        promotion_failed: row.promotion_failed,
        validation_error_count: row.validation_error_count,
        validation_warning_count: row.validation_warning_count,
    };
}

async function fetchFamilyCombinedSummary(
    prisma: PrismaClient,
    family: ImportReviewEntityFamilySlug,
    reviewBatchId: bigint
): Promise<{ buckets: ImportReviewSummaryBucketDb[]; metrics: ImportReviewFamilySummaryMetricsDb | null }> {
    const config = getImportReviewEntityConfig(family);
    const rows = await prisma.$queryRaw<ImportReviewCombinedFamilySummaryDb[]>(
        buildCombinedFamilySummarySql(config, reviewBatchId)
    );
    const row = rows[0];
    if (!row) {
        return { buckets: [], metrics: null };
    }

    return {
        buckets: parseSummaryBucketsJson(row.buckets),
        metrics: toFamilyMetricsRow(row),
    };
}

/**
 * Loads summary buckets + family metrics with one scan per batch family (parallel across families).
 */
export async function fetchImportReviewScopeSummary(
    prisma: PrismaClient,
    scope: ImportReviewScopeResolved,
    timing?: ImportReviewSummaryTimingSink
): Promise<ImportReviewScopeSummaryData> {
    const families = summaryFamiliesForScope(scope);
    const tableEntries = summaryTableNamesForFamilies(families);

    const existing = await timeImportReviewSummaryStep("table_regclass_batch", timing, () =>
        batchTableExists(
            prisma,
            tableEntries.map((t) => t.qualifiedName)
        )
    );

    const warnings: string[] = [];
    const familiesToScan: ImportReviewEntityFamilySlug[] = [];

    for (const entry of tableEntries) {
        if (existing.has(entry.qualifiedName)) {
            familiesToScan.push(entry.family);
        } else {
            warnings.push(`Summary skipped optional family ${entry.family}: table ${entry.qualifiedName} not found.`);
        }
    }

    if (familiesToScan.length === 0) {
        return { buckets: [], familyMetrics: [], warnings };
    }

    const perFamily = await timeImportReviewSummaryStep(
        `family_scans_parallel(n=${familiesToScan.length})`,
        timing,
        () =>
            Promise.all(
                familiesToScan.map(async (family) => {
                    const label = `family_scan:${family}`;
                    return timeImportReviewSummaryStep(label, timing, async () => {
                        const { buckets, metrics } = await fetchFamilyCombinedSummary(
                            prisma,
                            family,
                            scope.reviewBatchId
                        );
                        return { family, buckets, metrics };
                    });
                })
            )
    );

    const buckets: ImportReviewSummaryBucketDb[] = [];
    const familyMetrics: ImportReviewFamilySummaryMetricsDb[] = [];

    for (const result of perFamily) {
        buckets.push(...result.buckets);
        if (result.metrics !== null) {
            familyMetrics.push(result.metrics);
        }
    }

    return { buckets, familyMetrics, warnings };
}
