import { Prisma, type PrismaClient } from "@prisma/client";

import {
    IMPORT_REVIEW_ENTITY_FAMILIES,
    getImportReviewEntityConfig,
} from "./import-review-config.js";
import type {
    ImportReviewHistoryPublishBatchItemsQuery,
    ImportReviewHistoryPublishBatchesListQuery,
    ImportReviewHistoryReviewBatchesListQuery,
} from "./import-review-history.schema.js";
import {
    buildFamilySummaryMetricsForBatchIdsSql,
    buildFamilySummaryMetricsSql,
    mapFamilySummaryMetricsDb,
    rollupFamilySummaries,
    type ImportReviewFamilySummaryMetricsByBatchDb,
    type ImportReviewFamilySummaryMetricsDb,
} from "./import-review-summary-counts.js";
import type { ImportReviewPublishStageLogRow } from "./import-review-promotion-validation.types.js";

export type ReviewBatchRowDb = {
    id: bigint;
    public_id: string;
    batch_name: string;
    source_snapshot_version: string;
    source_snapshot_id_local: bigint | null;
    region_code: string | null;
    entity_families: string[];
    status: string;
    upload_mode: string;
    total_candidate_count: number;
    uploaded_candidate_count: number;
    preserved_reviewed_count: number;
    skipped_count: number;
    summary: unknown;
    uploaded_at: Date;
    created_at: Date;
    publish_batch_count: bigint;
    latest_validated_at: Date | null;
    latest_promoted_at: Date | null;
    validation_success_count: bigint;
    validation_fail_count: bigint;
    promotion_success_count: bigint;
    promotion_fail_count: bigint;
};

export type PublishBatchHistoryRowDb = {
    id: bigint;
    public_id: string;
    batch_name: string;
    status: string;
    source_review_batch_id: bigint | null;
    source_snapshot_version: string | null;
    region_code: string | null;
    total_item_count: number;
    success_count: number;
    failed_count: number;
    skipped_count: number;
    validation_total: number;
    validation_done: number;
    validation_percent: number;
    validated_at: Date | null;
    note: string | null;
    summary: unknown;
    created_at: Date;
    published_at: Date | null;
    promoted_at: Date | null;
};

export type PublishBatchItemRowDb = {
    id: bigint;
    entity_family: string;
    entity_id: bigint | null;
    publish_action: string | null;
    publish_status: string;
    review_candidate_table: string | null;
    review_candidate_id: bigint | null;
    external_id: string | null;
    target_schema: string | null;
    target_table: string | null;
    target_id: bigint | null;
    error_message: string | null;
    validation_result: unknown;
    published_at: Date | null;
    created_at: Date;
};

function reviewBatchListWhere(query: ImportReviewHistoryReviewBatchesListQuery): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`rb.status IS DISTINCT FROM 'archived'`];

    if (query.status) {
        parts.push(Prisma.sql`rb.status = ${query.status}`);
    }
    if (query.source_snapshot_version) {
        parts.push(Prisma.sql`rb.source_snapshot_version = ${query.source_snapshot_version}`);
    }
    if (query.entity_family) {
        parts.push(Prisma.sql`${query.entity_family} = ANY(rb.entity_families)`);
    }
    if (query.uploaded_after) {
        parts.push(Prisma.sql`rb.uploaded_at >= ${new Date(query.uploaded_after)}`);
    }
    if (query.uploaded_before) {
        parts.push(Prisma.sql`rb.uploaded_at <= ${new Date(query.uploaded_before)}`);
    }

    return Prisma.join(parts, " AND ");
}

function publishBatchListWhere(query: ImportReviewHistoryPublishBatchesListQuery): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];

    if (query.status) {
        parts.push(Prisma.sql`pb.status = ${query.status}`);
    }
    if (query.source_review_batch_id !== undefined) {
        parts.push(Prisma.sql`pb.source_review_batch_id = ${query.source_review_batch_id}`);
    }
    if (query.source_snapshot_version) {
        parts.push(Prisma.sql`pb.source_snapshot_version = ${query.source_snapshot_version}`);
    }
    if (query.entity_family) {
        parts.push(
            Prisma.sql`EXISTS (
                SELECT 1 FROM system.system_publish_items AS spi
                WHERE spi.publish_batch_id = pb.id
                  AND spi.entity_family = ${query.entity_family}
            )`
        );
    }
    if (query.created_after) {
        parts.push(Prisma.sql`pb.created_at >= ${new Date(query.created_after)}`);
    }
    if (query.created_before) {
        parts.push(Prisma.sql`pb.created_at <= ${new Date(query.created_before)}`);
    }

    return Prisma.join(parts, " AND ");
}

const PUBLISH_BATCH_PUBLISH_ROLLUP = Prisma.sql`
    LEFT JOIN LATERAL (
        SELECT
            count(*)::bigint AS publish_batch_count,
            max(pb.validated_at) AS latest_validated_at,
            max(pb.promoted_at) AS latest_promoted_at,
            count(*) FILTER (
                WHERE pb.validated_at IS NOT NULL
                  AND pb.status IN ('ready', 'promoting', 'promoted')
            )::bigint AS validation_success_count,
            count(*) FILTER (
                WHERE pb.status IN ('failed', 'blocked')
            )::bigint AS validation_fail_count,
            coalesce(sum(pb.success_count), 0)::bigint AS promotion_success_count,
            coalesce(sum(pb.failed_count), 0)::bigint AS promotion_fail_count
        FROM system.system_publish_batches AS pb
        WHERE pb.source_review_batch_id = rb.id
    ) AS pub ON true
`;

export class ImportReviewHistoryRepository {
    constructor(private readonly prisma: PrismaClient) {}

    getPrismaClient(): PrismaClient {
        return this.prisma;
    }

    private async pgRegclassExists(qualifiedName: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ exists: boolean }[]>`
            SELECT to_regclass(${qualifiedName}) IS NOT NULL AS exists
        `;
        return rows[0]?.exists ?? false;
    }

    async listReviewBatches(
        query: ImportReviewHistoryReviewBatchesListQuery
    ): Promise<{ rows: ReviewBatchRowDb[]; total: bigint }> {
        const where = reviewBatchListWhere(query);

        const totalRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM import_review.review_batches AS rb
            WHERE ${where}
        `;
        const total = totalRows[0]?.count ?? 0n;

        const rows = await this.prisma.$queryRaw<ReviewBatchRowDb[]>`
            SELECT
                rb.id,
                rb.public_id::text AS public_id,
                rb.batch_name,
                rb.source_snapshot_version,
                rb.source_snapshot_id_local,
                rb.region_code,
                rb.entity_families,
                rb.status,
                rb.upload_mode,
                rb.total_candidate_count,
                rb.uploaded_candidate_count,
                rb.preserved_reviewed_count,
                rb.skipped_count,
                rb.summary,
                rb.uploaded_at,
                rb.created_at,
                coalesce(pub.publish_batch_count, 0)::bigint AS publish_batch_count,
                pub.latest_validated_at,
                pub.latest_promoted_at,
                coalesce(pub.validation_success_count, 0)::bigint AS validation_success_count,
                coalesce(pub.validation_fail_count, 0)::bigint AS validation_fail_count,
                coalesce(pub.promotion_success_count, 0)::bigint AS promotion_success_count,
                coalesce(pub.promotion_fail_count, 0)::bigint AS promotion_fail_count
            FROM import_review.review_batches AS rb
            ${PUBLISH_BATCH_PUBLISH_ROLLUP}
            WHERE ${where}
            ORDER BY rb.uploaded_at DESC, rb.id DESC
            LIMIT ${query.limit ?? 50} OFFSET ${query.offset ?? 0}
        `;

        return { rows, total };
    }

    async fetchReviewBatchById(batchId: bigint): Promise<ReviewBatchRowDb | null> {
        const rows = await this.prisma.$queryRaw<ReviewBatchRowDb[]>`
            SELECT
                rb.id,
                rb.public_id::text AS public_id,
                rb.batch_name,
                rb.source_snapshot_version,
                rb.source_snapshot_id_local,
                rb.region_code,
                rb.entity_families,
                rb.status,
                rb.upload_mode,
                rb.total_candidate_count,
                rb.uploaded_candidate_count,
                rb.preserved_reviewed_count,
                rb.skipped_count,
                rb.summary,
                rb.uploaded_at,
                rb.created_at,
                coalesce(pub.publish_batch_count, 0)::bigint AS publish_batch_count,
                pub.latest_validated_at,
                pub.latest_promoted_at,
                coalesce(pub.validation_success_count, 0)::bigint AS validation_success_count,
                coalesce(pub.validation_fail_count, 0)::bigint AS validation_fail_count,
                coalesce(pub.promotion_success_count, 0)::bigint AS promotion_success_count,
                coalesce(pub.promotion_fail_count, 0)::bigint AS promotion_fail_count
            FROM import_review.review_batches AS rb
            ${PUBLISH_BATCH_PUBLISH_ROLLUP}
            WHERE rb.id = ${batchId}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async listPublishBatchesForReviewBatch(
        reviewBatchId: bigint
    ): Promise<PublishBatchHistoryRowDb[]> {
        return this.prisma.$queryRaw<PublishBatchHistoryRowDb[]>`
            SELECT
                pb.id,
                pb.public_id::text AS public_id,
                pb.batch_name,
                pb.status,
                pb.source_review_batch_id,
                pb.source_snapshot_version,
                pb.region_code,
                pb.total_item_count,
                pb.success_count,
                pb.failed_count,
                pb.skipped_count,
                pb.validation_total,
                pb.validation_done,
                pb.validation_percent::float8 AS validation_percent,
                pb.validated_at,
                pb.note,
                pb.summary,
                pb.created_at,
                pb.published_at,
                pb.promoted_at
            FROM system.system_publish_batches AS pb
            WHERE pb.source_review_batch_id = ${reviewBatchId}
            ORDER BY pb.created_at DESC, pb.id DESC
        `;
    }

    async fetchFamilyMetricsForBatch(reviewBatchId: bigint): Promise<ImportReviewFamilySummaryMetricsDb[]> {
        const warnings: string[] = [];
        const parts: Prisma.Sql[] = [];

        for (const family of IMPORT_REVIEW_ENTITY_FAMILIES) {
            const config = getImportReviewEntityConfig(family);
            const tableName = `import_review.${config.importReviewTable}`;
            if (await this.pgRegclassExists(tableName)) {
                parts.push(buildFamilySummaryMetricsSql(config, reviewBatchId));
            } else {
                warnings.push(`Skipped optional family ${family}`);
            }
        }

        if (parts.length === 0) {
            return [];
        }

        const rows = await this.prisma.$queryRaw<ImportReviewFamilySummaryMetricsDb[]>(
            Prisma.join(parts, " UNION ALL ")
        );
        void warnings;
        return rows.filter((r) => Number(r.batch_total) > 0);
    }

    async fetchFamilyMetricsForBatchIds(
        reviewBatchIds: bigint[]
    ): Promise<ImportReviewFamilySummaryMetricsByBatchDb[]> {
        if (reviewBatchIds.length === 0) {
            return [];
        }

        const parts: Prisma.Sql[] = [];
        for (const family of IMPORT_REVIEW_ENTITY_FAMILIES) {
            const config = getImportReviewEntityConfig(family);
            const tableName = `import_review.${config.importReviewTable}`;
            if (await this.pgRegclassExists(tableName)) {
                const sql = buildFamilySummaryMetricsForBatchIdsSql(config, reviewBatchIds);
                if (sql) {
                    parts.push(sql);
                }
            }
        }

        if (parts.length === 0) {
            return [];
        }

        return this.prisma.$queryRaw<ImportReviewFamilySummaryMetricsByBatchDb[]>(
            Prisma.join(parts, " UNION ALL ")
        );
    }

    async listPublishBatches(
        query: ImportReviewHistoryPublishBatchesListQuery
    ): Promise<{ rows: PublishBatchHistoryRowDb[]; total: bigint }> {
        const where = publishBatchListWhere(query);

        const totalRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_batches AS pb
            WHERE ${where}
        `;
        const total = totalRows[0]?.count ?? 0n;

        const rows = await this.prisma.$queryRaw<PublishBatchHistoryRowDb[]>`
            SELECT
                pb.id,
                pb.public_id::text AS public_id,
                pb.batch_name,
                pb.status,
                pb.source_review_batch_id,
                pb.source_snapshot_version,
                pb.region_code,
                pb.total_item_count,
                pb.success_count,
                pb.failed_count,
                pb.skipped_count,
                pb.validation_total,
                pb.validation_done,
                pb.validation_percent::float8 AS validation_percent,
                pb.validated_at,
                pb.note,
                pb.summary,
                pb.created_at,
                pb.published_at,
                pb.promoted_at
            FROM system.system_publish_batches AS pb
            WHERE ${where}
            ORDER BY pb.created_at DESC, pb.id DESC
            LIMIT ${query.limit ?? 50} OFFSET ${query.offset ?? 0}
        `;

        return { rows, total };
    }

    async fetchPublishBatchById(batchId: bigint): Promise<PublishBatchHistoryRowDb | null> {
        const rows = await this.prisma.$queryRaw<PublishBatchHistoryRowDb[]>`
            SELECT
                pb.id,
                pb.public_id::text AS public_id,
                pb.batch_name,
                pb.status,
                pb.source_review_batch_id,
                pb.source_snapshot_version,
                pb.region_code,
                pb.total_item_count,
                pb.success_count,
                pb.failed_count,
                pb.skipped_count,
                pb.validation_total,
                pb.validation_done,
                pb.validation_percent::float8 AS validation_percent,
                pb.validated_at,
                pb.note,
                pb.summary,
                pb.created_at,
                pb.published_at,
                pb.promoted_at
            FROM system.system_publish_batches AS pb
            WHERE pb.id = ${batchId}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async fetchPublishItemCounts(batchId: bigint): Promise<{
        pending: bigint;
        success: bigint;
        failed: bigint;
        skipped: bigint;
        rolled_back: bigint;
        total: bigint;
    }> {
        const rows = await this.prisma.$queryRaw<
            {
                pending: bigint;
                success: bigint;
                failed: bigint;
                skipped: bigint;
                rolled_back: bigint;
                total: bigint;
            }[]
        >`
            SELECT
                count(*) FILTER (WHERE publish_status = 'pending')::bigint AS pending,
                count(*) FILTER (WHERE publish_status = 'success')::bigint AS success,
                count(*) FILTER (WHERE publish_status = 'failed')::bigint AS failed,
                count(*) FILTER (WHERE publish_status = 'skipped')::bigint AS skipped,
                count(*) FILTER (WHERE publish_status = 'rolled_back')::bigint AS rolled_back,
                count(*)::bigint AS total
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        return (
            rows[0] ?? {
                pending: 0n,
                success: 0n,
                failed: 0n,
                skipped: 0n,
                rolled_back: 0n,
                total: 0n,
            }
        );
    }

    async fetchPublishItemCountsByFamily(batchId: bigint): Promise<
        {
            entity_family: string;
            pending: bigint;
            success: bigint;
            failed: bigint;
            skipped: bigint;
            total: bigint;
        }[]
    > {
        return this.prisma.$queryRaw`
            SELECT
                entity_family,
                count(*) FILTER (WHERE publish_status = 'pending')::bigint AS pending,
                count(*) FILTER (WHERE publish_status = 'success')::bigint AS success,
                count(*) FILTER (WHERE publish_status = 'failed')::bigint AS failed,
                count(*) FILTER (WHERE publish_status = 'skipped')::bigint AS skipped,
                count(*)::bigint AS total
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
            GROUP BY entity_family
            ORDER BY entity_family ASC
        `;
    }

    async fetchPublishBatchDataStateSummary(batchId: bigint): Promise<{
        failed_items: bigint;
        skipped_items: bigint;
        success_with_target_id: bigint;
        success_missing_target_id: bigint;
    }> {
        const rows = await this.prisma.$queryRaw<
            {
                failed_items: bigint;
                skipped_items: bigint;
                success_with_target_id: bigint;
                success_missing_target_id: bigint;
            }[]
        >`
            SELECT
                count(*) FILTER (WHERE publish_status = 'failed')::bigint AS failed_items,
                count(*) FILTER (WHERE publish_status = 'skipped')::bigint AS skipped_items,
                count(*) FILTER (
                    WHERE publish_status = 'success' AND target_id IS NOT NULL
                )::bigint AS success_with_target_id,
                count(*) FILTER (
                    WHERE publish_status = 'success' AND target_id IS NULL
                )::bigint AS success_missing_target_id
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        return (
            rows[0] ?? {
                failed_items: 0n,
                skipped_items: 0n,
                success_with_target_id: 0n,
                success_missing_target_id: 0n,
            }
        );
    }

    async listPublishBatchItems(
        batchId: bigint,
        query: ImportReviewHistoryPublishBatchItemsQuery
    ): Promise<{ rows: PublishBatchItemRowDb[]; total: bigint }> {
        const parts: Prisma.Sql[] = [Prisma.sql`publish_batch_id = ${batchId}`];

        if (query.publish_status) {
            parts.push(Prisma.sql`publish_status = ${query.publish_status}`);
        }
        if (query.entity_family) {
            parts.push(Prisma.sql`entity_family = ${query.entity_family}`);
        }

        const where = Prisma.join(parts, " AND ");

        const totalRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE ${where}
        `;
        const total = totalRows[0]?.count ?? 0n;

        const rows = await this.prisma.$queryRaw<PublishBatchItemRowDb[]>`
            SELECT
                id,
                entity_family,
                entity_id,
                publish_action,
                publish_status,
                review_candidate_table,
                review_candidate_id,
                external_id,
                target_schema,
                target_table,
                target_id,
                error_message,
                validation_result,
                published_at,
                created_at
            FROM system.system_publish_items
            WHERE ${where}
            ORDER BY
                CASE publish_status
                    WHEN 'failed' THEN 0
                    WHEN 'skipped' THEN 1
                    WHEN 'pending' THEN 2
                    ELSE 3
                END,
                id ASC
            LIMIT ${query.limit ?? 50} OFFSET ${query.offset ?? 0}
        `;

        return { rows, total };
    }

    async listStageLogs(batchId: bigint): Promise<ImportReviewPublishStageLogRow[]> {
        return this.prisma.$queryRaw<ImportReviewPublishStageLogRow[]>`
            SELECT
                id,
                publish_batch_id,
                stage_key,
                stage_label,
                stage_status,
                message,
                progress_percent::float8 AS progress_percent,
                details,
                started_at,
                finished_at
            FROM system.system_publish_stage_logs
            WHERE publish_batch_id = ${batchId}
            ORDER BY started_at ASC, id ASC
        `;
    }
}

export { mapFamilySummaryMetricsDb, rollupFamilySummaries };
