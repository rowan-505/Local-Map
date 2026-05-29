import type { ImportTransportFamily } from "./import-transport.config.js";
import {
    ImportTransportPromotionBatchNotFoundError,
    ImportTransportPromotionBatchValidationConflictError,
    ImportTransportPromotionBatchValidationInvalidStatusError,
} from "./import-transport-promotion.errors.js";
import {
    batchCanPromote,
    batchValidationStatusFromSummaries,
    mapIssuesToItemValidationStatus,
} from "./import-transport-promotion-validation-rules.js";
import type { ImportTransportValidationIssueDraft } from "./import-transport-validation.types.js";
import {
    ImportTransportPromotionValidationRepository,
    type PromotableEntitySets,
} from "./import-transport-promotion-validation.repo.js";
import {
    IMPORT_TRANSPORT_PROMOTION_VALIDATION_STAGES,
    stagesForBatchMode,
    type ImportTransportPromotionBatchProgressResponse,
    type ImportTransportPromotionBatchValidationResult,
    type ImportTransportPromotionBatchLogsResponse,
    type ImportTransportPromotionItemValidationStatus,
    type ImportTransportPromotionValidationStageKey,
} from "./import-transport-promotion-validation.types.js";
import { ImportTransportValidationRepository } from "./import-transport-validation.repo.js";

const runningBatchIds = new Set<bigint>();

function stageForFamily(family: ImportTransportFamily) {
    const stage = IMPORT_TRANSPORT_PROMOTION_VALIDATION_STAGES.find((s) => s.family === family);
    if (!stage) {
        throw new Error(`Unknown promotion validation family: ${family}`);
    }
    return stage;
}

function isRoutePromotable(routeId: string | null, sets: PromotableEntitySets): boolean {
    if (!routeId) {
        return false;
    }
    return sets.promotedRoutes.has(routeId) || sets.batchValidRoutes.has(routeId);
}

function isStopPromotable(stopId: string | null, sets: PromotableEntitySets): boolean {
    if (!stopId) {
        return false;
    }
    return sets.promotedStops.has(stopId) || sets.batchValidStops.has(stopId);
}

function isVariantPromotable(variantId: string | null, sets: PromotableEntitySets): boolean {
    if (!variantId) {
        return false;
    }
    return sets.promotedVariants.has(variantId) || sets.batchValidVariants.has(variantId);
}

function recordBatchValidItems(
    sets: PromotableEntitySets,
    entityKind: string,
    rawEntityId: bigint,
    status: string
): void {
    if (status !== "valid" && status !== "warning") {
        return;
    }
    const id = rawEntityId.toString();
    if (entityKind === "route") {
        sets.batchValidRoutes.add(id);
    } else if (entityKind === "stop") {
        sets.batchValidStops.add(id);
    } else if (entityKind === "route_variant") {
        sets.batchValidVariants.add(id);
    }
}

export class ImportTransportPromotionValidationService {
    constructor(
        private readonly repo: ImportTransportPromotionValidationRepository,
        private readonly candidateValidationRepo: ImportTransportValidationRepository
    ) {}

    isRunning(batchId: bigint): boolean {
        return runningBatchIds.has(batchId);
    }

    async validateBatch(batchId: bigint): Promise<ImportTransportPromotionBatchValidationResult> {
        if (runningBatchIds.has(batchId)) {
            throw new ImportTransportPromotionBatchValidationConflictError(
                batchId.toString(),
                "Validation is already running for this promotion batch."
            );
        }

        const before = await this.repo.fetchBatchProgress(batchId);
        if (!before) {
            throw new ImportTransportPromotionBatchNotFoundError(batchId.toString());
        }

        if (before.promotion_status === "validating") {
            throw new ImportTransportPromotionBatchValidationConflictError(
                batchId.toString(),
                "Promotion batch is already validating."
            );
        }

        if (!["draft", "not_ready", "ready", "failed"].includes(before.promotion_status)) {
            throw new ImportTransportPromotionBatchValidationInvalidStatusError(
                batchId.toString(),
                before.promotion_status
            );
        }

        runningBatchIds.add(batchId);
        try {
            const claim = await this.repo.claimBatchForValidation(batchId);
            if (!claim.claimed) {
                throw new ImportTransportPromotionBatchValidationConflictError(
                    batchId.toString(),
                    `Cannot start validation while batch status is ${claim.status ?? "unknown"}.`
                );
            }

            const stagesToRun = stagesForBatchMode(before.summary);
            const stageKeys = stagesToRun.map((family) => stageForFamily(family).key);
            await this.repo.resetItemValidationStatuses(batchId);
            await this.repo.clearStageLogs(batchId);
            await this.repo.seedStageLogs(batchId, stageKeys);

            const importBatchId = BigInt(before.import_batch_id);
            const totalItems = await this.repo.countBatchItems(batchId);
            const promotableSets = await this.repo.fetchPromotableSets(importBatchId);

            let routesStageHadBlocking = false;
            let stopsStageHadBlocking = false;
            let processedItems = 0;

            for (const family of stagesToRun) {
                const stage = stageForFamily(family);
                const stageKey = stage.key;

                if (family === "variants" && routesStageHadBlocking) {
                    processedItems += await this.skipStage(
                        batchId,
                        stageKey,
                        family,
                        stage.entity_kind,
                        processedItems,
                        totalItems,
                        "Skipped because routes stage has blocking errors."
                    );
                    continue;
                }
                if (family === "route_stops" && (routesStageHadBlocking || stopsStageHadBlocking)) {
                    const reason = routesStageHadBlocking
                        ? "Skipped because routes stage has blocking errors."
                        : "Skipped because stops stage has blocking errors.";
                    processedItems += await this.skipStage(
                        batchId,
                        stageKey,
                        family,
                        stage.entity_kind,
                        processedItems,
                        totalItems,
                        reason
                    );
                    continue;
                }

                const items = await this.repo.listBatchItems(batchId, stage.entity_kind);
                let stageBlocked = 0;
                let stageWarning = 0;
                let stageValid = 0;

                await this.repo.updateStageLog({
                    batchId,
                    stageKey,
                    stageStatus: "running",
                    message: `Validating ${items.length} ${stage.label.toLowerCase()} item(s).`,
                    progressPercent: Math.round((processedItems / Math.max(totalItems, 1)) * 100),
                });

                for (let index = 0; index < items.length; index++) {
                    const item = items[index];
                    const outcome = await this.validateItem({
                        family,
                        importBatchId,
                        rawEntityId: item.raw_entity_id,
                        promotableSets,
                    });

                    await this.repo.updatePromotionItemValidation({
                        itemId: item.id,
                        itemValidationStatus: outcome.item_validation_status,
                        errorMessage: outcome.error_message,
                        details: { validation_issues: outcome.issues },
                    });

                    recordBatchValidItems(
                        promotableSets,
                        item.entity_kind,
                        item.raw_entity_id,
                        outcome.item_validation_status
                    );

                    if (outcome.item_validation_status === "blocked") {
                        stageBlocked += 1;
                    } else if (outcome.item_validation_status === "warning") {
                        stageWarning += 1;
                    } else if (outcome.item_validation_status === "valid") {
                        stageValid += 1;
                    }

                    processedItems += 1;
                    const percent = Math.round((processedItems / Math.max(totalItems, 1)) * 100);
                    await this.repo.updateBatchValidationResult({
                        batchId,
                        validationTotal: totalItems,
                        validationDone: processedItems,
                        validationPercent: percent,
                        validationStatus: "validating",
                        canPromote: false,
                        promotionStatus: "validating",
                    });
                }

                if (family === "routes" && stageBlocked > 0) {
                    routesStageHadBlocking = true;
                }
                if (family === "stops" && stageBlocked > 0) {
                    stopsStageHadBlocking = true;
                }

                const stageStatus =
                    stageBlocked > 0 ? "failed" : stageWarning > 0 ? "warning" : items.length === 0 ? "skipped" : "success";
                await this.repo.updateStageLog({
                    batchId,
                    stageKey,
                    stageStatus,
                    message: `${stage.label}: ${stageValid} valid, ${stageWarning} warning, ${stageBlocked} blocked.`,
                    progressPercent: Math.round((processedItems / Math.max(totalItems, 1)) * 100),
                    details: { valid: stageValid, warning: stageWarning, blocked: stageBlocked, total: items.length },
                    finished: true,
                });
            }

            const byEntity = await this.repo.summarizeByEntity(batchId);
            const validationStatus = batchValidationStatusFromSummaries(byEntity);
            const canPromote = batchCanPromote(byEntity);
            const finalPromotionStatus = canPromote
                ? validationStatus === "passed_with_warnings"
                    ? "ready"
                    : "ready"
                : "not_ready";

            await this.repo.updateBatchValidationResult({
                batchId,
                validationTotal: totalItems,
                validationDone: processedItems,
                validationPercent: 100,
                validationStatus,
                canPromote,
                promotionStatus: finalPromotionStatus,
            });

            const progress = await this.buildProgressResponse(batchId);
            if (!progress) {
                throw new ImportTransportPromotionBatchNotFoundError(batchId.toString());
            }
            return {
                ...progress,
                message: canPromote
                    ? validationStatus === "passed_with_warnings"
                        ? "Validation passed with warnings. Confirm warnings and add a note before promotion."
                        : "Validation passed. Batch is ready for promotion."
                    : "Validation completed with blocking issues. Resolve blocked items before promotion.",
            };
        } finally {
            runningBatchIds.delete(batchId);
        }
    }

    async getBatchProgress(batchId: bigint): Promise<ImportTransportPromotionBatchProgressResponse> {
        const progress = await this.buildProgressResponse(batchId);
        if (!progress) {
            throw new ImportTransportPromotionBatchNotFoundError(batchId.toString());
        }
        return progress;
    }

    async getBatchLogs(batchId: bigint): Promise<ImportTransportPromotionBatchLogsResponse> {
        const batch = await this.repo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportTransportPromotionBatchNotFoundError(batchId.toString());
        }
        const items = await this.repo.listStageLogs(batchId);
        return { batch_id: batchId.toString(), items };
    }

    private async buildProgressResponse(
        batchId: bigint
    ): Promise<ImportTransportPromotionBatchProgressResponse | null> {
        const batch = await this.repo.fetchBatchProgress(batchId);
        if (!batch) {
            return null;
        }
        const [byEntity, stages] = await Promise.all([
            this.repo.summarizeByEntity(batchId),
            this.repo.listStageLogs(batchId),
        ]);
        return {
            batch_id: batch.id,
            promotion_status: batch.promotion_status,
            validation_status: batch.validation_status,
            can_promote: batch.can_promote,
            validation_total: batch.validation_total,
            validation_done: batch.validation_done,
            validation_percent: batch.validation_percent,
            validated_at: batch.validated_at,
            by_entity: byEntity,
            stages,
        };
    }

    private async skipStage(
        batchId: bigint,
        stageKey: ImportTransportPromotionValidationStageKey,
        family: ImportTransportFamily,
        entityKind: string,
        processedItems: number,
        totalItems: number,
        message: string
    ): Promise<number> {
        const skipped = await this.repo.skipItemsForEntityKind(batchId, entityKind, message);
        const nextProcessed = processedItems + skipped;
        await this.repo.updateStageLog({
            batchId,
            stageKey,
            stageStatus: "skipped",
            message,
            progressPercent: Math.round((nextProcessed / Math.max(totalItems, 1)) * 100),
            details: { skipped_items: skipped, entity_family: family },
            finished: true,
        });
        await this.repo.updateBatchValidationResult({
            batchId,
            validationTotal: totalItems,
            validationDone: nextProcessed,
            validationPercent: Math.round((nextProcessed / Math.max(totalItems, 1)) * 100),
            validationStatus: "validating",
            canPromote: false,
            promotionStatus: "validating",
        });
        return skipped;
    }

    private async validateItem(args: {
        family: ImportTransportFamily;
        importBatchId: bigint;
        rawEntityId: bigint;
        promotableSets: PromotableEntitySets;
    }): Promise<{
        item_validation_status: ImportTransportPromotionItemValidationStatus;
        error_message: string | null;
        issues: ImportTransportValidationIssueDraft[];
    }> {
        const issues = await this.candidateValidationRepo.evaluateCandidate(
            args.family,
            args.importBatchId,
            args.rawEntityId
        );

        if (args.family === "variants") {
            const rawRouteId = await this.repo.fetchVariantParentRouteId(
                args.importBatchId,
                args.rawEntityId
            );
            if (!isRoutePromotable(rawRouteId, args.promotableSets)) {
                issues.unshift({
                    issue_code: "parent_route_not_promotable",
                    severity: "error",
                    message: "Parent route is not promoted or promotable for this batch.",
                    details: { raw_route_id: rawRouteId },
                });
            }
        }

        if (args.family === "route_stops") {
            const parents = await this.repo.fetchRouteStopParentIds(
                args.importBatchId,
                args.rawEntityId
            );
            if (!isVariantPromotable(parents.raw_route_variant_id, args.promotableSets)) {
                issues.unshift({
                    issue_code: "parent_variant_not_promotable",
                    severity: "error",
                    message: "Parent route variant is not promoted or promotable for this batch.",
                    details: { raw_route_variant_id: parents.raw_route_variant_id },
                });
            }
            if (!isStopPromotable(parents.raw_stop_id, args.promotableSets)) {
                issues.unshift({
                    issue_code: "parent_stop_not_promotable",
                    severity: "error",
                    message: "Parent stop is not promoted or promotable for this batch.",
                    details: { raw_stop_id: parents.raw_stop_id },
                });
            }
        }

        const status = mapIssuesToItemValidationStatus(issues);
        const primary =
            issues.find((issue) => issue.severity === "error") ??
            issues.find((issue) => issue.severity === "warning");
        return {
            item_validation_status: status,
            error_message: primary?.message ?? null,
            issues,
        };
    }
}
