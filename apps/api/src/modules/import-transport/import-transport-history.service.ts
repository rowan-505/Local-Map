import { ImportTransportHistoryRepository } from "./import-transport-history.repo.js";
import {
    ImportTransportHistoryImportBatchNotFoundError,
    ImportTransportHistoryPromotionBatchNotFoundError,
} from "./import-transport-history.errors.js";
import type {
    ImportTransportHistoryImportBatchesListQuery,
    ImportTransportHistoryPromotionBatchItemsQuery,
    ImportTransportHistoryPromotionBatchesListQuery,
} from "./import-transport-history.schema.js";
import type {
    ImportTransportHistoryImportBatchDetail,
    ImportTransportHistoryImportBatchListItem,
    ImportTransportHistoryListResponse,
    ImportTransportHistoryPromotionBatchDetail,
    ImportTransportHistoryPromotionBatchItem,
    ImportTransportHistoryPromotionBatchListItem,
    ImportTransportHistoryPromotionBatchLogsResponse,
    ImportTransportHistoryPromotionBatchSummary,
    ImportTransportHistorySourceDataset,
} from "./import-transport-history.types.js";

function toIso(d: Date | null | undefined): string | null {
    return d ? d.toISOString() : null;
}

function mapSourceDataset(row: {
    source_dataset_id: bigint;
    dataset_code: string;
    dataset_name: string;
    dataset_transport_mode: string;
    dataset_source_format: string;
    dataset_provider_name: string | null;
    dataset_region_code: string | null;
}): ImportTransportHistorySourceDataset {
    return {
        id: row.source_dataset_id.toString(),
        code: row.dataset_code,
        name: row.dataset_name,
        transport_mode: row.dataset_transport_mode,
        source_format: row.dataset_source_format,
        provider_name: row.dataset_provider_name,
        region_code: row.dataset_region_code,
    };
}

function parseSummaryRecord(value: unknown): Record<string, unknown> {
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function promotionCountsFromSummary(summary: Record<string, unknown>, fallback: {
    promoted_count: number;
    failed_count: number;
    skipped_count: number;
}) {
    const result = summary.promotion_result;
    if (result != null && typeof result === "object" && !Array.isArray(result)) {
        const o = result as Record<string, unknown>;
        return {
            promoted_count: typeof o.promoted === "number" ? o.promoted : fallback.promoted_count,
            failed_count: typeof o.failed === "number" ? o.failed : fallback.failed_count,
            skipped_count: typeof o.skipped === "number" ? o.skipped : fallback.skipped_count,
        };
    }
    return fallback;
}

export class ImportTransportHistoryService {
    constructor(private readonly repo: ImportTransportHistoryRepository) {}

    async listImportBatches(
        query: ImportTransportHistoryImportBatchesListQuery
    ): Promise<ImportTransportHistoryListResponse<ImportTransportHistoryImportBatchListItem>> {
        const { rows, total } = await this.repo.listImportBatches(query);
        const items = await Promise.all(rows.map((row) => this.mapImportBatchListItem(row)));
        return { items, total: Number(total), limit: query.limit, offset: query.offset };
    }

    async getImportBatchById(batchId: bigint): Promise<ImportTransportHistoryImportBatchDetail> {
        const row = await this.repo.getImportBatchById(batchId);
        if (!row) {
            throw new ImportTransportHistoryImportBatchNotFoundError(batchId.toString());
        }

        const [base, promotionSummaries] = await Promise.all([
            this.mapImportBatchListItem(row),
            this.repo.listPromotionBatchSummariesForImportBatch(batchId),
        ]);

        return {
            ...base,
            source_file_name: row.source_file_name,
            source_file_checksum: row.source_file_checksum,
            record_counts: parseSummaryRecord(row.record_counts),
            summary: parseSummaryRecord(row.summary),
            error_message: row.error_message,
            promotion_batch_summaries: promotionSummaries.map(mapPromotionBatchSummary),
        };
    }

    async listPromotionBatches(
        query: ImportTransportHistoryPromotionBatchesListQuery
    ): Promise<ImportTransportHistoryListResponse<ImportTransportHistoryPromotionBatchListItem>> {
        const { rows, total } = await this.repo.listPromotionBatches(query);
        const items = await Promise.all(rows.map((row) => this.mapPromotionBatchListItem(row)));
        return { items, total: Number(total), limit: query.limit, offset: query.offset };
    }

    async getPromotionBatchById(batchId: bigint): Promise<ImportTransportHistoryPromotionBatchDetail> {
        const row = await this.repo.getPromotionBatchById(batchId);
        if (!row) {
            throw new ImportTransportHistoryPromotionBatchNotFoundError(batchId.toString());
        }

        const [base, countsByEntity] = await Promise.all([
            this.mapPromotionBatchListItem(row),
            this.repo.fetchEntityCountsForBatch(row.import_batch_id),
        ]);

        return {
            ...base,
            target_schema: row.target_schema,
            item_counts: parseSummaryRecord(row.item_counts),
            summary: parseSummaryRecord(row.summary),
            error_message: row.error_message,
            counts_by_entity: countsByEntity,
            source_import_batch: {
                id: row.import_batch_id.toString(),
                batch_name: row.import_batch_name,
                import_status: row.import_status,
                source_snapshot_version: row.source_snapshot_version,
                source_dataset: mapSourceDataset(row),
            },
        };
    }

    async listPromotionBatchItems(
        batchId: bigint,
        query: ImportTransportHistoryPromotionBatchItemsQuery
    ): Promise<ImportTransportHistoryListResponse<ImportTransportHistoryPromotionBatchItem>> {
        const batch = await this.repo.getPromotionBatchById(batchId);
        if (!batch) {
            throw new ImportTransportHistoryPromotionBatchNotFoundError(batchId.toString());
        }

        const { rows, total } = await this.repo.listPromotionBatchItems(batchId, query);
        return {
            items: rows.map((row) => ({
                id: row.id.toString(),
                entity_kind: row.entity_kind,
                raw_entity_id: row.raw_entity_id.toString(),
                promotion_status: row.promotion_status,
                item_validation_status: row.item_validation_status,
                match_status: row.match_status,
                promoted_target_schema: row.promoted_target_schema,
                promoted_target_table: row.promoted_target_table,
                promoted_target_id: row.promoted_target_id?.toString() ?? null,
                promoted_core_id: row.promoted_core_id?.toString() ?? null,
                error_message: row.error_message,
                created_at: row.created_at.toISOString(),
                updated_at: row.updated_at.toISOString(),
            })),
            total: Number(total),
            limit: query.limit,
            offset: query.offset,
        };
    }

    async getPromotionBatchLogs(batchId: bigint): Promise<ImportTransportHistoryPromotionBatchLogsResponse> {
        const batch = await this.repo.getPromotionBatchById(batchId);
        if (!batch) {
            throw new ImportTransportHistoryPromotionBatchNotFoundError(batchId.toString());
        }

        const rows = await this.repo.listPromotionBatchLogs(batchId);
        return {
            batch_id: batchId.toString(),
            items: rows.map((row) => ({
                id: row.id.toString(),
                stage_key: row.stage_key,
                stage_label: row.stage_label,
                stage_status: row.stage_status,
                message: row.message,
                progress_percent: Number(row.progress_percent),
                details:
                    row.details != null && typeof row.details === "object" && !Array.isArray(row.details)
                        ? (row.details as Record<string, unknown>)
                        : {},
                started_at: row.started_at.toISOString(),
                finished_at: row.finished_at?.toISOString() ?? null,
            })),
        };
    }

    private async mapImportBatchListItem(
        row: Awaited<ReturnType<ImportTransportHistoryRepository["getImportBatchById"]>> & object
    ): Promise<ImportTransportHistoryImportBatchListItem> {
        if (!row) {
            throw new ImportTransportHistoryImportBatchNotFoundError("unknown");
        }

        const [countsByEntity, validation] = await Promise.all([
            this.repo.fetchEntityCountsForBatch(row.id),
            this.repo.fetchValidationCounts(row.id),
        ]);

        const totalCandidates = countsByEntity.reduce((sum, family) => sum + family.total, 0);

        return {
            id: row.id.toString(),
            public_id: row.public_id,
            batch_name: row.batch_name,
            import_status: row.import_status,
            validation_status: row.validation_status,
            source_snapshot_version: row.source_snapshot_version,
            source_dataset: mapSourceDataset(row),
            imported_at: toIso(row.imported_at),
            validated_at: toIso(row.validated_at),
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            total_candidates: totalCandidates,
            counts_by_entity: countsByEntity,
            validation,
            promotion_batches: {
                promotion_batch_count: Number(row.promotion_batch_count),
                latest_promoted_at: toIso(row.latest_promoted_at),
                latest_validated_at: toIso(row.latest_validated_at),
            },
        };
    }

    private async mapPromotionBatchListItem(
        row: NonNullable<Awaited<ReturnType<ImportTransportHistoryRepository["getPromotionBatchById"]>>>
    ): Promise<ImportTransportHistoryPromotionBatchListItem> {
        const summary = parseSummaryRecord(row.summary);
        const statusCounts = await this.repo.fetchPromotionItemStatusCounts(row.id);
        const promotionCounts = promotionCountsFromSummary(summary, statusCounts);

        return {
            id: row.id.toString(),
            public_id: row.public_id,
            batch_name: row.batch_name,
            import_batch_id: row.import_batch_id.toString(),
            import_batch_name: row.import_batch_name,
            promotion_status: row.promotion_status,
            validation_status: row.validation_status,
            can_promote: row.can_promote,
            mode: typeof summary.mode === "string" ? summary.mode : null,
            entity_family: typeof summary.entity_family === "string" ? summary.entity_family : null,
            include_warnings: summary.include_warnings === true,
            item_total: statusCounts.item_total,
            promoted_count: promotionCounts.promoted_count,
            failed_count: promotionCounts.failed_count,
            skipped_count: promotionCounts.skipped_count,
            validation_blocked_count: statusCounts.validation_blocked_count,
            validation_warning_count: statusCounts.validation_warning_count,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            validated_at: toIso(row.validated_at),
            promoted_at: toIso(row.promoted_at),
        };
    }
}

function mapPromotionBatchSummary(row: {
    id: bigint;
    batch_name: string;
    promotion_status: string;
    validation_status: string;
    can_promote: boolean;
    created_at: Date;
    promoted_at: Date | null;
    validated_at: Date | null;
    promoted_count: bigint;
    failed_count: bigint;
    skipped_count: bigint;
}): ImportTransportHistoryPromotionBatchSummary {
    return {
        id: row.id.toString(),
        batch_name: row.batch_name,
        promotion_status: row.promotion_status,
        validation_status: row.validation_status,
        can_promote: row.can_promote,
        created_at: row.created_at.toISOString(),
        promoted_at: toIso(row.promoted_at),
        validated_at: toIso(row.validated_at),
        promoted_count: Number(row.promoted_count),
        failed_count: Number(row.failed_count),
        skipped_count: Number(row.skipped_count),
    };
}
