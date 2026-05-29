import type { ImportTransportFamily } from "./import-transport.config.js";
import {
    ImportTransportPromotionBatchNotFoundError,
    ImportTransportPromotionBatchPromotionConflictError,
} from "./import-transport-promotion.errors.js";
import { assertBatchReadyForPromotion, buildPromotionSummaryFromCounts } from "./import-transport-promotion-promote-guards.js";
import { ImportTransportPromotionPromoteRepository } from "./import-transport-promotion-promote.repo.js";
import {
    IMPORT_TRANSPORT_PROMOTION_EXECUTION_STAGES,
    type ImportTransportPromotionBatchPromoteResponse,
    type ImportTransportPromoteItemResult,
    type PostImportTransportPromotionBatchPromoteBody,
} from "./import-transport-promotion-promote.types.js";
import { ImportTransportPromotionValidationRepository } from "./import-transport-promotion-validation.repo.js";
import { stagesForBatchMode } from "./import-transport-promotion-validation.types.js";

const runningPromoteBatchIds = new Set<bigint>();

function stageForFamily(family: ImportTransportFamily) {
    const stage = IMPORT_TRANSPORT_PROMOTION_EXECUTION_STAGES.find((s) => s.family === family);
    if (!stage) {
        throw new Error(`Unknown promotion execution family: ${family}`);
    }
    return stage;
}

export class ImportTransportPromotionPromoteService {
    constructor(
        private readonly promoteRepo: ImportTransportPromotionPromoteRepository,
        private readonly validationRepo: ImportTransportPromotionValidationRepository
    ) {}

    isRunning(batchId: bigint): boolean {
        return runningPromoteBatchIds.has(batchId);
    }

    async promoteBatch(
        batchId: bigint,
        body: PostImportTransportPromotionBatchPromoteBody
    ): Promise<ImportTransportPromotionBatchPromoteResponse> {
        if (runningPromoteBatchIds.has(batchId)) {
            throw new ImportTransportPromotionBatchPromotionConflictError(
                batchId.toString(),
                "Promotion is already running for this batch."
            );
        }

        const batch = await this.validationRepo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportTransportPromotionBatchNotFoundError(batchId.toString());
        }

        const items = await this.validationRepo.listAllBatchItems(batchId);
        assertBatchReadyForPromotion({
            batch,
            items,
            confirm_warnings: body.confirm_warnings === true,
            review_note: body.review_note,
        });

        runningPromoteBatchIds.add(batchId);
        try {
            const claimed = await this.promoteRepo.claimBatchForPromotion(batchId);
            if (!claimed) {
                throw new ImportTransportPromotionBatchPromotionConflictError(
                    batchId.toString(),
                    "Promotion batch is not in a promotable status."
                );
            }

            const importBatchId = BigInt(batch.import_batch_id);
            const families = stagesForBatchMode(batch.summary);
            const results: ImportTransportPromoteItemResult[] = [];

            for (const family of families) {
                const stage = stageForFamily(family);
                const stageItems = await this.promoteRepo.listPromotableItems(batchId, stage.entity_kind);

                for (const item of stageItems) {
                    if (item.promotion_status === "promoted" && item.promoted_target_id != null) {
                        results.push({
                            promotion_item_id: item.id.toString(),
                            entity_kind: item.entity_kind,
                            raw_entity_id: item.raw_entity_id.toString(),
                            outcome: "skipped",
                            promoted_target_id: item.promoted_target_id.toString(),
                            error_message: null,
                        });
                        continue;
                    }

                    const result = await this.promoteItem({
                        family,
                        promotionBatchId: batchId,
                        importBatchId,
                        promotionItemId: item.id,
                        rawEntityId: item.raw_entity_id,
                    });
                    results.push(result);
                }
            }

            const promoted = results.filter((r) => r.outcome === "promoted").length;
            const failed = results.filter((r) => r.outcome === "failed").length;
            const skipped = results.filter((r) => r.outcome === "skipped").length;
            const byEntity = await this.validationRepo.summarizeByEntity(batchId);

            const promotionStatus = failed > 0 ? "failed" : "promoted";
            const summaryPatch = buildPromotionSummaryFromCounts({
                promoted,
                failed,
                skipped,
                by_entity: byEntity,
                review_note: body.review_note,
            });

            await this.promoteRepo.finalizeBatchPromotion({
                batchId,
                promotionStatus,
                summaryPatch,
                errorMessage: failed > 0 ? `${failed} item(s) failed during promotion.` : null,
            });

            const message =
                failed > 0
                    ? `Promotion finished with ${promoted} promoted, ${failed} failed, ${skipped} skipped.`
                    : `Promotion finished: ${promoted} promoted, ${skipped} skipped.`;

            return {
                batch_id: batchId.toString(),
                promotion_status: promotionStatus,
                message,
                promoted,
                failed,
                skipped,
                items: results,
                summary: summaryPatch,
            };
        } finally {
            runningPromoteBatchIds.delete(batchId);
        }
    }

    private async promoteItem(args: {
        family: ImportTransportFamily;
        promotionBatchId: bigint;
        importBatchId: bigint;
        promotionItemId: bigint;
        rawEntityId: bigint;
    }): Promise<ImportTransportPromoteItemResult> {
        const common = {
            promotionBatchId: args.promotionBatchId,
            importBatchId: args.importBatchId,
            promotionItemId: args.promotionItemId,
            rawEntityId: args.rawEntityId,
        };

        switch (args.family) {
            case "routes":
                return this.promoteRepo.promoteRouteItem(common);
            case "stops":
                return this.promoteRepo.promoteStopItem(common);
            case "variants":
                return this.promoteRepo.promoteVariantItem(common);
            case "route_stops":
                return this.promoteRepo.promoteRouteStopItem(common);
            default:
                return {
                    promotion_item_id: args.promotionItemId.toString(),
                    entity_kind: args.family,
                    raw_entity_id: args.rawEntityId.toString(),
                    outcome: "failed",
                    promoted_target_id: null,
                    error_message: `Unsupported entity family: ${args.family}`,
                };
        }
    }
}
