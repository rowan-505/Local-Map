import type { ImportTransportFamily } from "./import-transport.config.js";
import { emptyImportTransportPromotionReady } from "./import-transport-empty-reads.js";
import { ImportTransportBatchNotFoundError } from "./import-transport.errors.js";
import {
    ImportTransportPromotionBatchNotFoundError,
    ImportTransportPromotionInvalidModeError,
    ImportTransportPromotionNoEligibleCandidatesError,
} from "./import-transport-promotion.errors.js";
import { ImportTransportPromotionRepository } from "./import-transport-promotion.repo.js";
import { ImportTransportPromotionValidationService } from "./import-transport-promotion-validation.service.js";
import { ImportTransportPromotionPromoteService } from "./import-transport-promotion-promote.service.js";
import type {
    ImportTransportPromotionBatchLogsResponse,
    ImportTransportPromotionBatchProgressResponse,
    ImportTransportPromotionBatchValidationResult,
} from "./import-transport-promotion-validation.types.js";
import type {
    ImportTransportPromotionBatchPromoteResponse,
    PostImportTransportPromotionBatchPromoteBody,
} from "./import-transport-promotion-promote.types.js";
import type {
    ImportTransportCreatePromotionBatchResponse,
    ImportTransportPromotionBatchDetailResponse,
    ImportTransportPromotionBatchesListResponse,
    ImportTransportPromotionMode,
    ImportTransportPromotionReadyResponse,
} from "./import-transport-promotion.types.js";

export type CreateImportTransportPromotionBatchInput = {
    import_batch_id: bigint;
    mode: ImportTransportPromotionMode;
    entity_family: ImportTransportFamily | null;
    include_warnings: boolean;
};

export class ImportTransportPromotionService {
    constructor(
        private readonly repo: ImportTransportPromotionRepository,
        private readonly validationService: ImportTransportPromotionValidationService,
        private readonly promoteService: ImportTransportPromotionPromoteService
    ) {}

    async getReadyCounts(
        importBatchId: bigint,
        includeWarnings: boolean
    ): Promise<ImportTransportPromotionReadyResponse> {
        const families = this.repo.familiesForMode("all_entities", null);
        if (!(await this.repo.importBatchExists(importBatchId))) {
            return emptyImportTransportPromotionReady(importBatchId, includeWarnings, families);
        }

        const byFamily = await Promise.all(
            families.map((family) =>
                this.repo.fetchFamilyReadyCounts(family, importBatchId, includeWarnings)
            )
        );

        const totals = byFamily.reduce(
            (acc, family) => ({
                ready: acc.ready + family.ready,
                with_warnings: acc.with_warnings + family.with_warnings,
                blocked: acc.blocked + family.blocked,
                already_promoted: acc.already_promoted + family.already_promoted,
                already_batched: acc.already_batched + family.already_batched,
            }),
            { ready: 0, with_warnings: 0, blocked: 0, already_promoted: 0, already_batched: 0 }
        );

        return {
            import_batch_id: importBatchId.toString(),
            include_warnings: includeWarnings,
            by_family: byFamily,
            totals,
        };
    }

    async createBatch(
        input: CreateImportTransportPromotionBatchInput
    ): Promise<ImportTransportCreatePromotionBatchResponse> {
        if (!(await this.repo.importBatchExists(input.import_batch_id))) {
            throw new ImportTransportBatchNotFoundError(input.import_batch_id.toString());
        }

        if (input.mode === "one_entity" && !input.entity_family) {
            throw new ImportTransportPromotionInvalidModeError(
                "entity_family is required when mode is one_entity."
            );
        }

        const families = this.repo.familiesForMode(
            input.mode,
            input.mode === "all_entities" ? null : input.entity_family
        );

        const batchName = buildPromotionBatchName(input);
        const summary = {
            mode: input.mode,
            entity_family: input.mode === "one_entity" ? input.entity_family : null,
            include_warnings: input.include_warnings,
        };

        const batchRow = await this.repo.createPromotionBatchRecord({
            importBatchId: input.import_batch_id,
            batchName,
            itemCounts: { total: 0 },
            summary,
        });

        const byFamilyResults: ImportTransportCreatePromotionBatchResponse["by_family"] = [];
        const itemCounts: Record<string, number> = { total: 0 };
        let itemsAdded = 0;
        let candidatesMarkedBatched = 0;

        for (const family of families) {
            const result = await this.repo.insertPromotionItemsForFamily({
                family,
                importBatchId: input.import_batch_id,
                promotionBatchId: batchRow.id,
                includeWarnings: input.include_warnings,
            });
            byFamilyResults.push({
                entity_family: family,
                items_added: result.itemsAdded,
                marked_batched: result.markedBatched,
            });
            itemCounts[family] = result.itemsAdded;
            itemsAdded += result.itemsAdded;
            candidatesMarkedBatched += result.markedBatched;
        }

        itemCounts.total = itemsAdded;
        await this.repo.updatePromotionBatchItemCounts(batchRow.id, itemCounts);

        if (itemsAdded === 0) {
            await this.repo.deletePromotionBatch(batchRow.id);
            throw new ImportTransportPromotionNoEligibleCandidatesError();
        }

        const detail = await this.repo.getPromotionBatchById(batchRow.id);
        if (!detail) {
            throw new ImportTransportPromotionBatchNotFoundError(batchRow.id.toString());
        }

        return {
            batch: detail,
            items_added: itemsAdded,
            candidates_marked_batched: candidatesMarkedBatched,
            by_family: byFamilyResults,
            message: `Created promotion batch "${detail.batch_name}" with ${itemsAdded} item(s). Candidates marked promotion_status=batched. No core promotion was performed.`,
        };
    }

    async listBatches(input: {
        import_batch_id?: bigint;
        limit: number;
        offset: number;
    }): Promise<ImportTransportPromotionBatchesListResponse> {
        const result = await this.repo.listPromotionBatches(input);
        return {
            items: result.items,
            total: result.total,
            limit: input.limit,
            offset: input.offset,
        };
    }

    async getBatchById(batchId: bigint): Promise<ImportTransportPromotionBatchDetailResponse> {
        const batch = await this.repo.getPromotionBatchById(batchId);
        if (!batch) {
            throw new ImportTransportPromotionBatchNotFoundError(batchId.toString());
        }
        return batch;
    }

    async validateBatch(batchId: bigint): Promise<ImportTransportPromotionBatchValidationResult> {
        return this.validationService.validateBatch(batchId);
    }

    async getBatchProgress(batchId: bigint): Promise<ImportTransportPromotionBatchProgressResponse> {
        return this.validationService.getBatchProgress(batchId);
    }

    async getBatchLogs(batchId: bigint): Promise<ImportTransportPromotionBatchLogsResponse> {
        return this.validationService.getBatchLogs(batchId);
    }

    async promoteBatch(
        batchId: bigint,
        body: PostImportTransportPromotionBatchPromoteBody
    ): Promise<ImportTransportPromotionBatchPromoteResponse> {
        return this.promoteService.promoteBatch(batchId, body);
    }
}

function buildPromotionBatchName(input: CreateImportTransportPromotionBatchInput): string {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    if (input.mode === "one_entity" && input.entity_family) {
        return `Transport promotion ${input.entity_family} ${stamp}`;
    }
    return `Transport promotion all entities ${stamp}`;
}
