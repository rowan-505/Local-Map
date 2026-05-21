import { ImportReviewHistoryReviewBatchNotFoundError } from "./import-review-history.errors.js";
import type {
    ImportReviewHistoryPublishBatchDetail,
    ImportReviewHistoryPublishBatchItem,
    ImportReviewHistoryPublishBatchListItem,
    ImportReviewHistoryPublishBatchLogsResponse,
    ImportReviewHistoryReviewBatchCounts,
    ImportReviewHistoryReviewBatchDetail,
    ImportReviewHistoryReviewBatchListItem,
} from "./import-review-history.types.js";
import type {
    ImportReviewHistoryPublishBatchItemsQuery,
    ImportReviewHistoryPublishBatchesListQuery,
    ImportReviewHistoryReviewBatchesListQuery,
} from "./import-review-history.schema.js";
import {
    ImportReviewHistoryRepository,
    mapFamilySummaryMetricsDb,
    rollupFamilySummaries,
    type PublishBatchHistoryRowDb,
    type PublishBatchItemRowDb,
    type ReviewBatchRowDb,
} from "./import-review-history.repo.js";
import type { ImportReviewFamilySummaryMetrics } from "./import-review-summary-counts.js";
import type { ImportReviewPublishStageLogRow } from "./import-review-promotion-validation.types.js";
import { ImportReviewPublishBatchNotFoundError } from "./import-review-promotion.errors.js";
import {
    ImportReviewPublishBatchSummaryRepository,
    applyComputedCountsToBatchSummary,
    type PublishBatchComputedSummary,
} from "./import-review-publish-batch-summary.js";
import {
    ImportReviewReviewBatchSummaryRepository,
    type ReviewBatchComputedSummary,
} from "./import-review-review-batch-summary.js";

function n(v: bigint | number): number {
    return typeof v === "bigint" ? Number(v) : v;
}

function toIso(d: Date | null): string | null {
    return d ? d.toISOString() : null;
}

function bigStr(v: bigint | null | undefined): string | null {
    return v != null ? v.toString() : null;
}

function countsFromFamilies(families: ImportReviewFamilySummaryMetrics[]): ImportReviewHistoryReviewBatchCounts {
    const rollup = rollupFamilySummaries(families);
    return {
        batch_total_candidates: rollup.batch_total_candidates,
        active_candidates: rollup.active_candidates,
        pending_review_candidates: rollup.pending_review_candidates,
        approved_candidates: rollup.approved_candidates,
        rejected_candidates: rollup.rejected_candidates,
        promoted_candidates: rollup.promoted_candidates,
        promotion_failed_candidates: rollup.promotion_failed_candidates,
    };
}

function mapReviewBatchListItem(
    row: ReviewBatchRowDb,
    families: ImportReviewFamilySummaryMetrics[],
    computed: ReviewBatchComputedSummary | null
): ImportReviewHistoryReviewBatchListItem {
    return {
        id: row.id.toString(),
        public_id: row.public_id,
        batch_name: row.batch_name,
        source_snapshot_version: row.source_snapshot_version,
        source_snapshot_id_local: bigStr(row.source_snapshot_id_local),
        status: computed?.stored_status ?? row.status,
        derived_status: computed?.derived_status ?? row.status,
        derived_status_reason: computed?.derived_status_reason ?? null,
        stored_status_recommendation: computed?.stored_status_recommendation ?? null,
        status_note: computed?.derived_status_reason ?? null,
        created_at: row.created_at.toISOString(),
        uploaded_at: row.uploaded_at.toISOString(),
        validated_at: toIso(row.latest_validated_at),
        promoted_at: toIso(row.latest_promoted_at),
        total_candidate_count: row.total_candidate_count,
        entity_families: [...row.entity_families],
        counts: countsFromFamilies(families),
        counts_by_entity_family: families,
        publish_batches: {
            publish_batch_count: n(row.publish_batch_count),
            validated_at: toIso(row.latest_validated_at),
            promoted_at: toIso(row.latest_promoted_at),
            validation_success_count: n(row.validation_success_count),
            validation_fail_count: n(row.validation_fail_count),
            promotion_success_count: n(row.promotion_success_count),
            promotion_fail_count: n(row.promotion_fail_count),
        },
        latest_publish_batch: computed?.latest_publish_batch ?? null,
    };
}

function mapPublishBatchListItem(
    row: PublishBatchHistoryRowDb,
    computed: PublishBatchComputedSummary | null
): ImportReviewHistoryPublishBatchListItem {
    const validationResult = parseValidationOutcome(row.summary);
    const validationSuccess =
        row.validated_at != null &&
        row.status !== "failed" &&
        row.status !== "blocked" &&
        validationResult?.outcome !== "blocked"
            ? 1
            : 0;
    const validationFail =
        row.status === "failed" || row.status === "blocked" || validationResult?.outcome === "blocked" ? 1 : 0;

    const base = {
        id: row.id.toString(),
        public_id: row.public_id,
        batch_name: row.batch_name,
        status: row.status,
        source_review_batch_id: bigStr(row.source_review_batch_id),
        source_snapshot_version: row.source_snapshot_version,
        region_code: row.region_code,
        total_item_count: row.total_item_count,
        success_count: row.success_count,
        failed_count: row.failed_count,
        skipped_count: row.skipped_count,
        validation_total: row.validation_total,
        validation_done: row.validation_done,
        validation_percent: row.validation_percent,
        validated_at: toIso(row.validated_at),
        created_at: row.created_at.toISOString(),
        published_at: toIso(row.published_at),
        promoted_at: toIso(row.promoted_at),
        validation_success_count: validationSuccess,
        validation_fail_count: validationFail,
    };
    const enriched = applyComputedCountsToBatchSummary(base, computed);
    return {
        ...enriched,
        derived_status: enriched.derived_status,
        derived_status_reason: enriched.derived_status_reason,
        stored_status_recommendation: enriched.stored_status_recommendation,
        status_note: enriched.derived_status_reason,
        validation_total: row.validation_total,
        validation_done: row.validation_done,
        validation_percent: row.validation_percent,
        validation_success_count: validationSuccess,
        validation_fail_count: validationFail,
    };
}

function parseValidationOutcome(summary: unknown): { outcome: string; blocked_count: number } | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const vr = (summary as Record<string, unknown>).validation_result;
    if (!vr || typeof vr !== "object" || Array.isArray(vr)) {
        return null;
    }
    const o = vr as Record<string, unknown>;
    return {
        outcome: typeof o.outcome === "string" ? o.outcome : "passed",
        blocked_count: Number(o.blocked_count ?? 0),
    };
}

function parseLogsSummary(summary: unknown, key: "validation_logs_summary" | "promotion_logs_summary"): string | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const v = (summary as Record<string, unknown>)[key];
    return typeof v === "string" ? v : null;
}

function parseValidationSummary(summary: unknown): unknown {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    return (summary as Record<string, unknown>).validation_result ?? null;
}

function parsePromotionSummary(summary: unknown): unknown {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    return (summary as Record<string, unknown>).promotion_result ?? null;
}

function mapStageLog(row: ImportReviewPublishStageLogRow) {
    return {
        id: row.id.toString(),
        stage_key: row.stage_key,
        stage_label: row.stage_label,
        stage_status: row.stage_status,
        message: row.message,
        progress_percent: row.progress_percent,
        details: row.details,
        started_at: row.started_at.toISOString(),
        finished_at: row.finished_at ? row.finished_at.toISOString() : null,
    };
}

function mapPublishItem(row: PublishBatchItemRowDb): ImportReviewHistoryPublishBatchItem {
    return {
        id: row.id.toString(),
        entity_family: row.entity_family,
        entity_id: bigStr(row.entity_id),
        publish_action: row.publish_action,
        publish_status: row.publish_status,
        review_candidate_table: row.review_candidate_table,
        review_candidate_id: bigStr(row.review_candidate_id),
        external_id: row.external_id,
        target_schema: row.target_schema,
        target_table: row.target_table,
        target_id: bigStr(row.target_id),
        error_message: row.error_message,
        validation_result: row.validation_result,
        published_at: toIso(row.published_at),
        created_at: row.created_at.toISOString(),
    };
}

export class ImportReviewHistoryService {
    private readonly publishSummaryRepo: ImportReviewPublishBatchSummaryRepository;
    private readonly reviewSummaryRepo: ImportReviewReviewBatchSummaryRepository;

    constructor(private readonly repo: ImportReviewHistoryRepository) {
        const prisma = repo.getPrismaClient();
        this.publishSummaryRepo = new ImportReviewPublishBatchSummaryRepository(prisma);
        this.reviewSummaryRepo = new ImportReviewReviewBatchSummaryRepository(prisma);
    }

    private async computePublishSummary(batchId: bigint): Promise<PublishBatchComputedSummary | null> {
        return this.publishSummaryRepo.computePublishBatchSummary(batchId);
    }

    async listReviewBatches(query: ImportReviewHistoryReviewBatchesListQuery) {
        const { rows, total } = await this.repo.listReviewBatches(query);
        const batchIds = rows.map((r) => r.id);
        const familyRows = await this.repo.fetchFamilyMetricsForBatchIds(batchIds);

        const familiesByBatch = new Map<string, ImportReviewFamilySummaryMetrics[]>();
        for (const row of familyRows) {
            const key = row.review_batch_id.toString();
            const mapped = mapFamilySummaryMetricsDb(row);
            if (mapped.batch_total <= 0) {
                continue;
            }
            const list = familiesByBatch.get(key) ?? [];
            list.push(mapped);
            familiesByBatch.set(key, list);
        }

        const items = await Promise.all(
            rows.map(async (row) => {
                const computed = await this.reviewSummaryRepo.computeReviewBatchSummary(row.id);
                return mapReviewBatchListItem(
                    row,
                    familiesByBatch.get(row.id.toString()) ?? [],
                    computed
                );
            })
        );

        return {
            items,
            total: n(total),
            limit: query.limit ?? 50,
            offset: query.offset ?? 0,
        };
    }

    async getReviewBatchById(batchId: bigint): Promise<ImportReviewHistoryReviewBatchDetail> {
        const row = await this.repo.fetchReviewBatchById(batchId);
        if (!row) {
            throw new ImportReviewHistoryReviewBatchNotFoundError(batchId.toString());
        }

        const computed = await this.reviewSummaryRepo.computeReviewBatchSummary(batchId);
        const familyRows = await this.repo.fetchFamilyMetricsForBatch(batchId);
        const families = familyRows.map(mapFamilySummaryMetricsDb).filter((f) => f.batch_total > 0);
        const publishRows = await this.repo.listPublishBatchesForReviewBatch(batchId);
        const publishSummaries = await Promise.all(
            publishRows.map((pb) => this.computePublishSummary(pb.id))
        );

        const base = mapReviewBatchListItem(row, families, computed);

        return {
            ...base,
            region_code: row.region_code,
            upload_mode: row.upload_mode,
            uploaded_candidate_count: row.uploaded_candidate_count,
            preserved_reviewed_count: row.preserved_reviewed_count,
            skipped_count: row.skipped_count,
            summary: row.summary,
            publish_batch_summaries: publishRows.map((pb, i) =>
                mapPublishBatchListItem(pb, publishSummaries[i] ?? null)
            ),
            publish_batch_attempts: computed?.publish_attempts ?? [],
        };
    }

    async listPublishBatches(query: ImportReviewHistoryPublishBatchesListQuery) {
        const { rows, total } = await this.repo.listPublishBatches(query);
        const summaries = await Promise.all(rows.map((row) => this.computePublishSummary(row.id)));
        return {
            items: rows.map((row, i) => mapPublishBatchListItem(row, summaries[i] ?? null)),
            total: n(total),
            limit: query.limit ?? 50,
            offset: query.offset ?? 0,
        };
    }

    async getPublishBatchById(batchId: bigint): Promise<ImportReviewHistoryPublishBatchDetail> {
        const row = await this.repo.fetchPublishBatchById(batchId);
        if (!row) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }

        const [itemCounts, familyCounts, dataState, stageLogs, reviewBatch] = await Promise.all([
            this.repo.fetchPublishItemCounts(batchId),
            this.repo.fetchPublishItemCountsByFamily(batchId),
            this.repo.fetchPublishBatchDataStateSummary(batchId),
            this.repo.listStageLogs(batchId),
            row.source_review_batch_id
                ? this.repo.fetchReviewBatchById(row.source_review_batch_id)
                : Promise.resolve(null),
        ]);

        const itemCountsByFamily: ImportReviewHistoryPublishBatchDetail["item_counts_by_entity_family"] =
            {};
        for (const fc of familyCounts) {
            itemCountsByFamily[fc.entity_family] = {
                pending: n(fc.pending),
                success: n(fc.success),
                failed: n(fc.failed),
                skipped: n(fc.skipped),
                total: n(fc.total),
            };
        }

        const listItem = mapPublishBatchListItem(row, await this.computePublishSummary(batchId));

        return {
            ...listItem,
            note: row.note,
            item_counts: {
                pending: n(itemCounts.pending),
                success: n(itemCounts.success),
                failed: n(itemCounts.failed),
                skipped: n(itemCounts.skipped),
                rolled_back: n(itemCounts.rolled_back),
                total: n(itemCounts.total),
            },
            item_counts_by_entity_family: itemCountsByFamily,
            validation_summary: parseValidationSummary(row.summary),
            promotion_summary: parsePromotionSummary(row.summary),
            validation_logs_summary: parseLogsSummary(row.summary, "validation_logs_summary"),
            promotion_logs_summary: parseLogsSummary(row.summary, "promotion_logs_summary"),
            process_state_logs: stageLogs.map(mapStageLog),
            data_state_summary: {
                failed_items: n(dataState.failed_items),
                skipped_items: n(dataState.skipped_items),
                success_with_target_id: n(dataState.success_with_target_id),
                success_missing_target_id: n(dataState.success_missing_target_id),
            },
            source_review_batch: reviewBatch
                ? {
                      id: reviewBatch.id.toString(),
                      batch_name: reviewBatch.batch_name,
                      source_snapshot_version: reviewBatch.source_snapshot_version,
                      status: reviewBatch.status,
                  }
                : null,
        };
    }

    async listPublishBatchItems(batchId: bigint, query: ImportReviewHistoryPublishBatchItemsQuery) {
        const batch = await this.repo.fetchPublishBatchById(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }

        const { rows, total } = await this.repo.listPublishBatchItems(batchId, query);
        return {
            items: rows.map(mapPublishItem),
            total: n(total),
            limit: query.limit ?? 50,
            offset: query.offset ?? 0,
        };
    }

    async getPublishBatchLogs(batchId: bigint): Promise<ImportReviewHistoryPublishBatchLogsResponse> {
        const batch = await this.repo.fetchPublishBatchById(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }

        const stageLogs = await this.repo.listStageLogs(batchId);
        return {
            batch_id: batchId.toString(),
            process_state_logs: stageLogs.map(mapStageLog),
            validation_logs_summary: parseLogsSummary(batch.summary, "validation_logs_summary"),
            promotion_logs_summary: parseLogsSummary(batch.summary, "promotion_logs_summary"),
        };
    }
}
