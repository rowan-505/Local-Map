import type { FastifyBaseLogger } from "fastify";

import {
    ImportReviewPublishBatchInvalidStatusError,
    ImportReviewPublishBatchNotFoundError,
    ImportReviewPublishBatchValidationConflictError,
} from "./import-review-promotion.errors.js";
import {
    IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES,
    type ImportReviewPublishBatchValidationResult,
    type ImportReviewPublishValidationStageKey,
    type ImportReviewValidationIssue,
    type ImportReviewValidationSeverity,
} from "./import-review-promotion-validation.types.js";
import {
    IMPORT_REVIEW_VALIDATION_CHUNK_SIZE,
    ImportReviewPromotionValidationRepository,
} from "./import-review-promotion-validation.repo.js";

const runningBatchIds = new Set<bigint>();

type ItemIssueState = {
    issues: ImportReviewValidationIssue[];
    blocked: boolean;
    warned: boolean;
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

function mergeIssues(
    state: Map<string, ItemIssueState>,
    rows: { publish_item_id: bigint; code: string; message: string; severity: ImportReviewValidationSeverity }[],
    stageKey: ImportReviewPublishValidationStageKey
): void {
    for (const row of rows) {
        const id = row.publish_item_id.toString();
        let entry = state.get(id);
        if (!entry) {
            entry = { issues: [], blocked: false, warned: false };
            state.set(id, entry);
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

export class ImportReviewPromotionValidationRunner {
    constructor(private readonly repo: ImportReviewPromotionValidationRepository) {}

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
        const itemState = new Map<string, ItemIssueState>();
        let itemIds: bigint[] = [];
        let validationTotal = 0;

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
                itemIds = await this.repo.listPublishItemIds(batchId);
                validationTotal = itemIds.length;
                const nonBuildingCount = await this.repo.countNonBuildingItems(batchId);
                if (nonBuildingCount > 0) {
                    throw new Error(
                        `Batch contains ${nonBuildingCount} non-building item(s); only buildings are supported.`
                    );
                }
                const pending = await this.repo.countPendingBuildingItems(batchId);
                await this.repo.updateBatchProgress({
                    batchId,
                    validationTotal,
                    validationDone: 0,
                    validationPercent: stageByKey("load_items").progressEnd,
                });
                return {
                    message: `Loaded ${validationTotal} building publish item(s) (${pending} pending).`,
                    details: { total_items: validationTotal, pending_items: pending },
                };
            });

            if (!loadItemsOk) {
                return;
            }

            await this.runItemStage(batchId, "candidate_integrity", itemIds, validationTotal, itemState, (chunk) =>
                this.repo.validateCandidateIntegrity(chunk)
            );
            await this.runItemStage(batchId, "geometry_validation", itemIds, validationTotal, itemState, (chunk) =>
                this.repo.validateGeometry(chunk)
            );
            await this.runItemStage(batchId, "required_field_validation", itemIds, validationTotal, itemState, (chunk) =>
                this.repo.validateRequiredFields(chunk)
            );
            await this.runItemStage(batchId, "reference_validation", itemIds, validationTotal, itemState, (chunk) =>
                this.repo.validateReferences(chunk)
            );
            await this.runItemStage(batchId, "duplicate_validation", itemIds, validationTotal, itemState, (chunk) =>
                this.repo.validateDuplicates(chunk)
            );
            await this.runItemStage(batchId, "action_validation", itemIds, validationTotal, itemState, (chunk) =>
                this.repo.validateActions(chunk)
            );

            await this.runStage(batchId, "validation_summary", async () => {
                const actionCounts = await this.repo.fetchItemActionCounts(batchId);

                let validCount = 0;
                let warningCount = 0;
                let blockedCount = 0;

                const persistRows: {
                    publishItemId: bigint;
                    status: string;
                    issues: ImportReviewValidationIssue[];
                    errorMessage: string | null;
                }[] = [];

                for (const id of itemIds) {
                    const key = id.toString();
                    const state = itemState.get(key) ?? { issues: [], blocked: false, warned: false };
                    let status: "valid" | "warning" | "blocked" = "valid";
                    if (state.blocked) {
                        status = "blocked";
                        blockedCount += 1;
                    } else if (state.warned) {
                        status = "warning";
                        warningCount += 1;
                    } else {
                        validCount += 1;
                    }

                    const firstError = state.issues.find((i) => i.severity === "error");
                    persistRows.push({
                        publishItemId: id,
                        status,
                        issues: state.issues,
                        errorMessage: firstError?.message ?? null,
                    });
                }

                await this.repo.persistItemValidationResults(persistRows);

                const validationResult: ImportReviewPublishBatchValidationResult = {
                    outcome: blockedCount > 0 ? "blocked" : "passed",
                    valid_count: validCount,
                    warning_count: warningCount,
                    blocked_count: blockedCount,
                    total_items: validationTotal,
                    by_publish_action: {
                        insert: actionCounts.insert,
                        update: actionCounts.update,
                        merge: actionCounts.merge,
                    },
                    entity_family: { buildings: actionCounts.buildings },
                };

                const logsSummary =
                    blockedCount > 0
                        ? `Validation blocked. ${blockedCount} item(s) have errors.`
                        : "Validation passed. Batch is ready for promotion.";

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
                    validationTotal,
                    validationDone: validationTotal,
                    validationPercent: 100,
                });

                return {
                    message: logsSummary,
                    details: validationResult as unknown as Record<string, unknown>,
                    stageStatus: blockedCount > 0 ? "warning" : "success",
                };
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Validation failed unexpectedly.";
            log?.error({ err, batchId: batchId.toString() }, "publish batch validation failed");
            await this.repo.failBatch(batchId, message);
            await this.repo.updateStageLog({
                batchId,
                stageKey: "validation_summary",
                stageStatus: "failed",
                message,
                progressPercent: 100,
                finished: true,
            });
        } finally {
            runningBatchIds.delete(batchId);
        }
    }

    private async runItemStage(
        batchId: bigint,
        stageKey: ImportReviewPublishValidationStageKey,
        itemIds: bigint[],
        validationTotal: number,
        itemState: Map<string, ItemIssueState>,
        validateChunk: (chunk: bigint[]) => Promise<
            { publish_item_id: bigint; code: string; message: string; severity: ImportReviewValidationSeverity }[]
        >
    ): Promise<void> {
        const stage = stageByKey(stageKey);
        const prevStage = IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES[IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES.indexOf(stage) - 1];
        const prevEnd = prevStage?.progressEnd ?? 0;

        await this.repo.updateStageLog({
            batchId,
            stageKey,
            stageStatus: "running",
            message: `Running ${stage.label.toLowerCase()}…`,
            progressPercent: prevEnd,
        });

        let done = 0;
        for (let i = 0; i < itemIds.length; i += IMPORT_REVIEW_VALIDATION_CHUNK_SIZE) {
            const chunk = itemIds.slice(i, i + IMPORT_REVIEW_VALIDATION_CHUNK_SIZE);
            const rows = await validateChunk(chunk);
            mergeIssues(itemState, rows, stageKey);
            done += chunk.length;
            const percent = progressBetweenStages(prevEnd, stage.progressEnd, done, validationTotal);
            await this.repo.updateBatchProgress({
                batchId,
                validationDone: done,
                validationPercent: Math.round(percent * 100) / 100,
            });
        }

        const issueCount = [...itemState.values()].filter((s) =>
            s.issues.some((i) => i.stage_key === stageKey)
        ).length;

        await this.repo.updateStageLog({
            batchId,
            stageKey,
            stageStatus: issueCount > 0 ? "warning" : "success",
            message: `${stage.label} complete (${issueCount} item(s) flagged).`,
            progressPercent: stage.progressEnd,
            details: { flagged_items: issueCount },
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
            runningBatchIds.delete(batchId);
            return false;
        }
    }
}
