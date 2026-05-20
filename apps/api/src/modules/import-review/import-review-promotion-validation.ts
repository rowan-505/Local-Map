import type { FastifyBaseLogger } from "fastify";

import { isValidatablePublishFamily, PROMOTABLE_PUBLISH_FAMILIES } from "./import-review-promotion-config.js";
import {
    ImportReviewPublishBatchInvalidStatusError,
    ImportReviewPublishBatchNotFoundError,
    ImportReviewPublishBatchValidationConflictError,
} from "./import-review-promotion.errors.js";
import { ImportReviewPromotionValidationRules } from "./import-review-promotion-validation-rules.js";
import {
    IMPORT_REVIEW_PUBLISH_ITEM_VALIDATION_STAGES,
    IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES,
    type ImportReviewPublishBatchEntityValidationCounts,
    type ImportReviewPublishBatchValidationResult,
    type ImportReviewPublishItemValidationStageKey,
    type ImportReviewPublishValidationStageKey,
    type ImportReviewValidationIssue,
    type ImportReviewValidationSeverity,
} from "./import-review-promotion-validation.types.js";
import {
    IMPORT_REVIEW_VALIDATION_CHUNK_SIZE,
    ImportReviewPromotionValidationRepository,
    type PublishItemEntityRow,
} from "./import-review-promotion-validation.repo.js";

const runningBatchIds = new Set<bigint>();

type ItemIssueState = {
    issues: ImportReviewValidationIssue[];
    blocked: boolean;
    warned: boolean;
    skipped: boolean;
    entityFamily: string;
};

function stageByKey(key: ImportReviewPublishValidationStageKey) {
    const stage = IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES.find((s) => s.key === key);
    if (!stage) {
        throw new Error(`Unknown validation stage: ${key}`);
    }
    return stage;
}

function progressBetweenStages(
    prevEnd: number,
    nextEnd: number,
    done: number,
    total: number
): number {
    if (total <= 0) {
        return nextEnd;
    }
    const ratio = Math.min(1, Math.max(0, done / total));
    return prevEnd + (nextEnd - prevEnd) * ratio;
}

function itemsFullyValidated(globalStagePasses: number, totalItems: number): number {
    const stageCount = IMPORT_REVIEW_PUBLISH_ITEM_VALIDATION_STAGES.length;
    if (stageCount <= 0 || totalItems <= 0) {
        return 0;
    }
    return Math.min(Math.floor(globalStagePasses / stageCount), totalItems);
}

function mergeIssues(
    state: Map<string, ItemIssueState>,
    rows: { publish_item_id: bigint; code: string; message: string; severity: ImportReviewValidationSeverity }[],
    stageKey: ImportReviewPublishValidationStageKey
): void {
    for (const row of rows) {
        const id = row.publish_item_id.toString();
        let entry = state.get(id);
        if (!entry) {
            continue;
        }
        if (entry.skipped) {
            continue;
        }
        entry.issues.push({
            code: row.code,
            message: row.message,
            severity: row.severity,
            stage_key: stageKey,
        });
        if (row.severity === "error") {
            entry.blocked = true;
        } else if (row.severity === "warning") {
            entry.warned = true;
        }
    }
}

function markUnsupportedSkipped(
    state: Map<string, ItemIssueState>,
    itemIds: bigint[],
    entityFamily: string
): void {
    for (const id of itemIds) {
        const key = id.toString();
        const entry = state.get(key);
        if (!entry) {
            continue;
        }
        entry.skipped = true;
        entry.issues.push({
            code: "validation_not_supported_for_family",
            message: `Entity family ${entityFamily} is not supported for publish validation yet.`,
            severity: "warning",
            stage_key: "group_by_entity",
        });
        entry.warned = true;
    }
}

function initItemState(rows: PublishItemEntityRow[]): Map<string, ItemIssueState> {
    const state = new Map<string, ItemIssueState>();
    for (const row of rows) {
        state.set(row.id.toString(), {
            issues: [],
            blocked: false,
            warned: false,
            skipped: false,
            entityFamily: row.entity_family,
        });
    }
    return state;
}

function groupItemsByFamily(rows: PublishItemEntityRow[]): Map<string, bigint[]> {
    const grouped = new Map<string, bigint[]>();
    for (const row of rows) {
        const list = grouped.get(row.entity_family) ?? [];
        list.push(row.id);
        grouped.set(row.entity_family, list);
    }
    return grouped;
}

export class ImportReviewPromotionValidationRunner {
    private readonly rules: ImportReviewPromotionValidationRules;

    constructor(private readonly repo: ImportReviewPromotionValidationRepository) {
        this.rules = new ImportReviewPromotionValidationRules(repo.getPrismaClient());
    }

    isRunning(batchId: bigint): boolean {
        return runningBatchIds.has(batchId);
    }

    async startValidation(batchId: bigint, log?: FastifyBaseLogger): Promise<{ batch_id: string; status: string; message: string }> {
        if (runningBatchIds.has(batchId)) {
            throw new ImportReviewPublishBatchValidationConflictError(
                batchId.toString(),
                "Validation is already running for this publish batch."
            );
        }

        const before = await this.repo.fetchBatchProgress(batchId);
        if (!before) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }

        if (before.status === "validating") {
            throw new ImportReviewPublishBatchValidationConflictError(
                batchId.toString(),
                "Publish batch is already validating."
            );
        }

        if (!["draft", "blocked", "failed", "ready"].includes(before.status)) {
            throw new ImportReviewPublishBatchInvalidStatusError(
                batchId.toString(),
                before.status,
                `Cannot validate publish batch with status=${before.status}.`
            );
        }

        const claim = await this.repo.claimBatchForValidation(batchId);
        if (!claim.claimed) {
            if (before.status === "validating") {
                throw new ImportReviewPublishBatchValidationConflictError(
                    batchId.toString(),
                    "Publish batch is already validating."
                );
            }
            throw new ImportReviewPublishBatchInvalidStatusError(
                batchId.toString(),
                claim.status ?? before.status,
                "Publish batch status changed and could not be claimed for validation."
            );
        }

        await this.repo.clearStageLogs(batchId);
        await this.repo.seedStageLogs(batchId);

        runningBatchIds.add(batchId);
        void this.runValidation(batchId, log).catch((err) => {
            log?.error({ err, batchId: batchId.toString() }, "publish batch validation crashed");
        });

        return {
            batch_id: batchId.toString(),
            status: "validating",
            message: "Validation started.",
        };
    }

    private async runValidation(batchId: bigint, log?: FastifyBaseLogger): Promise<void> {
        let itemRows: PublishItemEntityRow[] = [];
        let itemState = new Map<string, ItemIssueState>();
        let groupedItems = new Map<string, bigint[]>();
        let validationTotal = 0;
        let validatableItemTotal = 0;

        try {
            await this.runStage(batchId, "load_batch", async () => {
                const batch = await this.repo.fetchBatchProgress(batchId);
                if (!batch) {
                    throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
                }
                const totalItems = await this.repo.countPublishItems(batchId);
                return {
                    message: `Loaded publish batch (${totalItems} item(s)).`,
                    details: { total_items: totalItems, status: batch.status },
                };
            });

            const loadItemsOk = await this.runStage(batchId, "load_items", async () => {
                itemRows = await this.repo.listPublishItemsWithEntity(batchId);
                validationTotal = itemRows.length;
                itemState = initItemState(itemRows);
                groupedItems = groupItemsByFamily(itemRows);
                validatableItemTotal = [...groupedItems.entries()]
                    .filter(([family]) => isValidatablePublishFamily(family))
                    .reduce((sum, [, ids]) => sum + ids.length, 0);

                const pending = await this.repo.countPendingItems(batchId);
                await this.repo.updateBatchProgress({
                    batchId,
                    validationTotal: validatableItemTotal || validationTotal,
                    validationDone: 0,
                    validationPercent: stageByKey("load_items").progressEnd,
                });
                return {
                    message: `Loaded ${validationTotal} publish item(s) (${pending} pending).`,
                    details: { total_items: validationTotal, pending_items: pending },
                };
            });

            if (!loadItemsOk) {
                return;
            }

            const groupOk = await this.runStage(batchId, "group_by_entity", async () => {
                const counts = await this.repo.countItemsByEntityFamily(batchId);
                const byEntity: Record<string, { total: number }> = {};
                for (const row of counts) {
                    byEntity[row.entity_family] = { total: Number(row.count) };
                    if (!isValidatablePublishFamily(row.entity_family)) {
                        markUnsupportedSkipped(itemState, groupedItems.get(row.entity_family) ?? [], row.entity_family);
                    }
                }
                const families = Object.keys(byEntity);
                return {
                    message: `Grouped ${validationTotal} item(s) across ${families.length} entity famil${families.length === 1 ? "y" : "ies"}.`,
                    details: { by_entity: byEntity, validatable_items: validatableItemTotal },
                };
            });

            if (!groupOk) {
                return;
            }

            const progressTotal = validatableItemTotal || validationTotal || 1;
            let globalStagePasses = 0;

            for (const stageKey of IMPORT_REVIEW_PUBLISH_ITEM_VALIDATION_STAGES) {
                await this.runMultiFamilyItemStage({
                    batchId,
                    stageKey,
                    groupedItems,
                    itemState,
                    progressTotal,
                    globalStagePassesRef: { value: globalStagePasses },
                    onProgress: (passes) => {
                        globalStagePasses = passes;
                    },
                });
            }

            await this.runStage(batchId, "write_validation_summary", async () => {
                const actionCounts = await this.repo.fetchItemActionCounts(batchId);

                let validCount = 0;
                let warningCount = 0;
                let blockedCount = 0;
                let skippedCount = 0;

                const byEntity: Record<string, ImportReviewPublishBatchEntityValidationCounts> = {};
                const initEntity = (family: string): ImportReviewPublishBatchEntityValidationCounts => {
                    if (!byEntity[family]) {
                        byEntity[family] = { total: 0, valid: 0, warning: 0, blocked: 0, skipped: 0 };
                    }
                    return byEntity[family];
                };

                const persistRows: {
                    publishItemId: bigint;
                    status: string;
                    issues: ImportReviewValidationIssue[];
                    errorMessage: string | null;
                }[] = [];

                for (const row of itemRows) {
                    const key = row.id.toString();
                    const state = itemState.get(key) ?? {
                        issues: [],
                        blocked: false,
                        warned: false,
                        skipped: false,
                        entityFamily: row.entity_family,
                    };
                    const bucket = initEntity(row.entity_family);
                    bucket.total += 1;

                    let status: "valid" | "warning" | "blocked" | "skipped" = "valid";
                    if (state.skipped) {
                        status = "skipped";
                        skippedCount += 1;
                        bucket.skipped += 1;
                    } else if (state.blocked) {
                        status = "blocked";
                        blockedCount += 1;
                        bucket.blocked += 1;
                    } else if (state.warned) {
                        status = "warning";
                        warningCount += 1;
                        bucket.warning += 1;
                    } else {
                        validCount += 1;
                        bucket.valid += 1;
                    }

                    const firstError = state.issues.find((i) => i.severity === "error");
                    persistRows.push({
                        publishItemId: row.id,
                        status,
                        issues: state.issues,
                        errorMessage: firstError?.message ?? null,
                    });
                }

                await this.repo.persistItemValidationResults(persistRows);

                const promotableFamilies = PROMOTABLE_PUBLISH_FAMILIES.filter(
                    (family) =>
                        (byEntity[family]?.valid ?? 0) + (byEntity[family]?.warning ?? 0) > 0
                );
                const canPromote = blockedCount === 0 && promotableFamilies.length > 0;
                const requiresWarningConfirmation = warningCount > 0;

                const validationResult: ImportReviewPublishBatchValidationResult = {
                    outcome: blockedCount > 0 ? "blocked" : "passed",
                    can_promote: canPromote,
                    requires_warning_confirmation: requiresWarningConfirmation,
                    valid_count: validCount,
                    warning_count: warningCount,
                    blocked_count: blockedCount,
                    skipped_count: skippedCount,
                    total_items: validationTotal,
                    by_publish_action: {
                        insert: actionCounts.insert,
                        update: actionCounts.update,
                        merge: actionCounts.merge,
                    },
                    by_entity: byEntity,
                    entity_family: { buildings: actionCounts.buildings },
                    promotable_entity_families: [...promotableFamilies],
                };

                let logsSummary: string;
                if (blockedCount > 0) {
                    logsSummary = `Validation blocked. ${blockedCount} item(s) have errors.`;
                } else if (requiresWarningConfirmation) {
                    logsSummary = `Validation passed with ${warningCount} warning(s). Confirmation required before promotion.`;
                } else {
                    logsSummary = "Validation passed. Batch is ready for promotion.";
                }

                const finalStatus = blockedCount > 0 ? "blocked" : "ready";

                await this.repo.finalizeBatch({
                    batchId,
                    status: finalStatus,
                    validationTotal,
                    summary: {
                        validation_result: validationResult,
                        validation_logs_summary: logsSummary,
                    },
                });

                await this.repo.updateBatchProgress({
                    batchId,
                    validationTotal: progressTotal,
                    validationDone: progressTotal,
                    validationPercent: 100,
                });

                return {
                    message: logsSummary,
                    details: validationResult as unknown as Record<string, unknown>,
                    stageStatus: blockedCount > 0 ? "warning" : requiresWarningConfirmation ? "warning" : "success",
                };
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Validation failed unexpectedly.";
            log?.error({ err, batchId: batchId.toString() }, "publish batch validation failed");
            await this.repo.failBatch(batchId, message);
            await this.repo.updateStageLog({
                batchId,
                stageKey: "write_validation_summary",
                stageStatus: "failed",
                message,
                progressPercent: 100,
                finished: true,
            });
        } finally {
            runningBatchIds.delete(batchId);
        }
    }

    private async runMultiFamilyItemStage(args: {
        batchId: bigint;
        stageKey: ImportReviewPublishItemValidationStageKey;
        groupedItems: Map<string, bigint[]>;
        itemState: Map<string, ItemIssueState>;
        progressTotal: number;
        globalStagePassesRef: { value: number };
        onProgress: (passes: number) => void;
    }): Promise<void> {
        const stage = stageByKey(args.stageKey);
        const prevStage =
            IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES[
                IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES.indexOf(stage) - 1
            ];
        const prevEnd = prevStage?.progressEnd ?? 0;
        const stageCount = IMPORT_REVIEW_PUBLISH_ITEM_VALIDATION_STAGES.length;

        await this.repo.updateStageLog({
            batchId: args.batchId,
            stageKey: args.stageKey,
            stageStatus: "running",
            message: `Running ${stage.label.toLowerCase()}…`,
            progressPercent: prevEnd,
            details: {
                process_state: "running",
                stage_count: stageCount,
                item_processed_count: 0,
                total_item_count: args.progressTotal,
            },
        });

        let stageDone = 0;
        const validatableFamilies = [...args.groupedItems.entries()].filter(([family]) =>
            isValidatablePublishFamily(family)
        );

        for (const [family, familyItemIds] of validatableFamilies) {
            for (let i = 0; i < familyItemIds.length; i += IMPORT_REVIEW_VALIDATION_CHUNK_SIZE) {
                const chunk = familyItemIds.slice(i, i + IMPORT_REVIEW_VALIDATION_CHUNK_SIZE);
                const rows = await this.rules.validateStage(args.stageKey, family, chunk);
                mergeIssues(args.itemState, rows, args.stageKey);
                stageDone += chunk.length;
                args.globalStagePassesRef.value += chunk.length;
                args.onProgress(args.globalStagePassesRef.value);

                const itemsValidated = itemsFullyValidated(
                    args.globalStagePassesRef.value,
                    args.progressTotal
                );
                const percent = progressBetweenStages(
                    prevEnd,
                    stage.progressEnd,
                    itemsValidated,
                    args.progressTotal
                );
                await this.repo.updateBatchProgress({
                    batchId: args.batchId,
                    validationDone: itemsValidated,
                    validationPercent: Math.round(percent * 100) / 100,
                });
                await this.repo.updateStageLog({
                    batchId: args.batchId,
                    stageKey: args.stageKey,
                    stageStatus: "running",
                    message: `Validating ${family} (${stageDone}/${familyItemIds.length} in stage)…`,
                    progressPercent: Math.round(percent * 100) / 100,
                    details: {
                        entity_family: family,
                        process_state: "running",
                        stage_count: stageCount,
                        item_processed_count: stageDone,
                        total_item_count: args.progressTotal,
                        counts: { done: stageDone, family_total: familyItemIds.length },
                    },
                });
            }
        }

        const issueCount = [...args.itemState.values()].filter((s) =>
            s.issues.some((i) => i.stage_key === args.stageKey)
        ).length;

        await this.repo.updateStageLog({
            batchId: args.batchId,
            stageKey: args.stageKey,
            stageStatus: issueCount > 0 ? "warning" : "success",
            message: `${stage.label} complete (${issueCount} item(s) flagged).`,
            progressPercent: stage.progressEnd,
            details: {
                flagged_items: issueCount,
                process_state: "completed",
                stage_count: stageCount,
                item_processed_count: args.progressTotal,
                total_item_count: args.progressTotal,
            },
            finished: true,
        });
    }

    private async runStage(
        batchId: bigint,
        stageKey: ImportReviewPublishValidationStageKey,
        fn: () => Promise<{
            message: string;
            details?: Record<string, unknown>;
            stageStatus?: string;
        }>
    ): Promise<boolean> {
        const stage = stageByKey(stageKey);
        await this.repo.updateStageLog({
            batchId,
            stageKey,
            stageStatus: "running",
            message: `Running ${stage.label.toLowerCase()}…`,
            progressPercent:
                IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES[
                    Math.max(0, IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES.indexOf(stage) - 1)
                ]?.progressEnd ?? 0,
        });

        try {
            const result = await fn();
            await this.repo.updateBatchProgress({
                batchId,
                validationPercent: stage.progressEnd,
            });
            await this.repo.updateStageLog({
                batchId,
                stageKey,
                stageStatus: result.stageStatus ?? "success",
                message: result.message,
                progressPercent: stage.progressEnd,
                details: result.details,
                finished: true,
            });
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Stage failed.";
            await this.repo.updateStageLog({
                batchId,
                stageKey,
                stageStatus: "failed",
                message,
                progressPercent: stage.progressEnd,
                finished: true,
            });
            await this.repo.failBatch(batchId, message);
            return false;
        }
    }
}
