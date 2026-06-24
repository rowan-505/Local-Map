import type { FastifyBaseLogger } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";

import { batchPromotionBlocksValidationReset } from "./import-review-promotion-batch-status.js";
import { isValidatablePublishFamily, PROMOTABLE_PUBLISH_FAMILIES } from "./import-review-promotion-config.js";
import {
    ImportReviewPublishBatchInvalidStatusError,
    ImportReviewPublishBatchNotFoundError,
    ImportReviewPublishBatchValidationConflictError,
    ImportReviewPublishBatchValidationNotRunningError,
    ImportReviewPublishBatchValidationResetError,
} from "./import-review-promotion.errors.js";
import {
    ImportReviewPromotionSimpleBatchValidation,
    type PublishItemSimpleValidationOutcome,
} from "./import-review-promotion-simple-batch-validation.js";
import { computePublishBatchValidationFinalize } from "./import-review-promotion-validation-summary.js";
import {
    IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES,
    type ImportReviewPublishBatchEntityValidationCounts,
    type ImportReviewPublishBatchValidationResult,
    type ImportReviewPublishValidationStageKey,
    type ImportReviewValidationIssue,
    type ImportReviewValidationSeverity,
} from "./import-review-promotion-validation.types.js";
import { ImportReviewPromotionProgress } from "./import-review-promotion-progress.js";
import {
    ImportReviewPromotionValidationRepository,
    type PublishItemEntityRow,
} from "./import-review-promotion-validation.repo.js";
import {
    buildValidateCandidateStateStageHeartbeatDetails,
    buildValidatePublishBatchProgressMessage,
    type ValidatePublishBatchChunkHeartbeat,
    type ValidatePublishBatchProgressEvent,
} from "./import-review-promotion-validation-progress.js";
import {
    extractStageLogHeartbeatIso,
    heartbeatAnchorAt,
    ImportReviewPublishBatchValidationAbortedError,
    isValidationHeartbeatStale,
    isValidationHeartbeatStalled,
    type ImportReviewValidationHeartbeatState,
} from "./import-review-promotion-validation-control.js";
import { outcomeFromPersistedValidationResult } from "./import-review-promotion-validation-resume.js";

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

function mergeSimpleValidationOutcomeIntoItemState(
    outcome: PublishItemSimpleValidationOutcome,
    itemState: Map<string, ItemIssueState>,
    stageKey: ImportReviewPublishValidationStageKey
): void {
    const key = outcome.publish_item_id.toString();
    const entry = itemState.get(key);
    if (!entry) {
        return;
    }

    entry.issues = [];
    entry.blocked = false;
    entry.warned = false;
    entry.skipped = outcome.skipped;

    const pushIssue = (
        issue: { code: string; message: string; field?: string },
        severity: ImportReviewValidationSeverity
    ) => {
        entry.issues.push({
            code: issue.code,
            message: issue.message,
            severity,
            stage_key: stageKey,
            entity_family: outcome.entity_family,
            ...(issue.field !== undefined ? { field: issue.field } : {}),
        });
        if (severity === "error") {
            entry.blocked = true;
        } else if (severity === "warning") {
            entry.warned = true;
        }
    };

    for (const err of outcome.result.errors) {
        pushIssue(err, "error");
    }
    for (const warn of outcome.result.warnings) {
        pushIssue(warn, "warning");
    }

    if (outcome.skipped) {
        entry.warned = true;
    } else if (outcome.status === "blocked") {
        entry.blocked = true;
    } else if (outcome.status === "warning") {
        entry.warned = true;
    }
}

async function seedItemStateFromPersistedValidation(
    prisma: PrismaClient,
    batchId: bigint,
    itemRows: PublishItemEntityRow[],
    itemState: Map<string, ItemIssueState>,
    stageKey: ImportReviewPublishValidationStageKey
): Promise<number> {
    const rows = await prisma.$queryRaw<
        { publish_item_id: bigint; entity_family: string; validation_result: unknown }[]
    >`
        SELECT id AS publish_item_id, entity_family, validation_result
        FROM system.system_publish_items
        WHERE publish_batch_id = ${batchId}
    `;
    const rowByItemId = new Map(itemRows.map((r) => [r.id.toString(), r]));
    let seeded = 0;

    for (const row of rows) {
        const itemRow = rowByItemId.get(row.publish_item_id.toString());
        if (!itemRow) {
            continue;
        }
        const target = {
            publish_item_id: row.publish_item_id,
            entity_family: row.entity_family,
            review_candidate_id: 0n,
            review_batch_id: 0n,
        };
        const outcome = outcomeFromPersistedValidationResult(target, row.validation_result);
        if (!outcome) {
            continue;
        }
        mergeSimpleValidationOutcomeIntoItemState(outcome, itemState, stageKey);
        seeded += 1;
    }

    return seeded;
}

function persistRowsFromSimpleValidationOutcomes(
    outcomes: readonly PublishItemSimpleValidationOutcome[],
    batchValidation: ImportReviewPromotionSimpleBatchValidation,
    stageKey: ImportReviewPublishValidationStageKey
): {
    publishItemId: bigint;
    status: string;
    validationJson: Record<string, unknown>;
    errorMessage: string | null;
}[] {
    return outcomes.map((outcome) => {
        const errors = outcome.result.errors.map((e) => ({
            ...e,
            severity: "error" as const,
            stage_key: stageKey,
            entity_family: outcome.entity_family,
        }));
        const warnings = outcome.result.warnings.map((w) => ({
            ...w,
            severity: "warning" as const,
            stage_key: stageKey,
            entity_family: outcome.entity_family,
        }));
        const status = outcome.skipped
            ? "skipped"
            : outcome.status === "ready"
              ? "ready"
              : outcome.status === "warning"
                ? "warning"
                : "blocked";
        const firstError = outcome.result.errors[0];
        return {
            publishItemId: outcome.publish_item_id,
            status,
            validationJson: batchValidation.toPersistedValidationJson(outcome),
            errorMessage: firstError?.message ?? null,
        };
    });
}

export class ImportReviewPromotionValidationRunner {
    private readonly simpleBatchValidation: ImportReviewPromotionSimpleBatchValidation;
    private readonly pipelineProgress: ImportReviewPromotionProgress;

    constructor(
        private readonly repo: ImportReviewPromotionValidationRepository,
        pipelineProgress?: ImportReviewPromotionProgress
    ) {
        this.simpleBatchValidation = new ImportReviewPromotionSimpleBatchValidation(
            repo.prisma
        );
        this.pipelineProgress =
            pipelineProgress ?? new ImportReviewPromotionProgress(repo.prisma);
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

        let batchRow = before;
        if (batchRow.status === "validating") {
            if (runningBatchIds.has(batchId)) {
                throw new ImportReviewPublishBatchValidationConflictError(
                    batchId.toString(),
                    "Validation is already running for this publish batch."
                );
            }
            const anchor = await this.resolveValidationHeartbeatAnchor(batchId, batchRow);
            if (isValidationHeartbeatStale(anchor)) {
                await this.repo.failStaleValidationBatch(batchId);
                const refreshed = await this.repo.fetchBatchProgress(batchId);
                if (refreshed) {
                    batchRow = refreshed;
                }
            } else {
                throw new ImportReviewPublishBatchValidationConflictError(
                    batchId.toString(),
                    "Publish batch is already validating. Cancel validation or wait for completion."
                );
            }
        }

        if (!["draft", "blocked", "failed", "ready", "partial"].includes(batchRow.status)) {
            throw new ImportReviewPublishBatchInvalidStatusError(
                batchId.toString(),
                batchRow.status,
                `Cannot validate publish batch with status=${batchRow.status}.`
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

    async cancelValidation(batchId: bigint): Promise<{ batch_id: string; status: string; message: string }> {
        const batch = await this.repo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        if (batch.status !== "validating") {
            throw new ImportReviewPublishBatchValidationNotRunningError(
                batchId.toString(),
                batch.status,
                `Cannot cancel validation when batch status is ${batch.status}.`
            );
        }

        await this.repo.requestValidationCancel(batchId);

        const anchor = await this.resolveValidationHeartbeatAnchor(batchId, batch);
        const workerInProcess = runningBatchIds.has(batchId);
        const heartbeatStalled = isValidationHeartbeatStalled(anchor);

        if (!workerInProcess || heartbeatStalled) {
            await this.repo.finalizeValidationAborted(batchId, "cancelled");
            runningBatchIds.delete(batchId);
            return {
                batch_id: batchId.toString(),
                status: "failed",
                message: heartbeatStalled
                    ? "Validation cancelled (worker was not responding)."
                    : "Validation cancelled.",
            };
        }

        return {
            batch_id: batchId.toString(),
            status: "validating",
            message: "Validation cancel requested; worker stops at the next checkpoint.",
        };
    }

    async resetValidation(batchId: bigint): Promise<{ batch_id: string; status: string; message: string }> {
        const batch = await this.repo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        if (
            batchPromotionBlocksValidationReset({
                status: batch.status,
                promoted_at: batch.promoted_at,
                success_count: null,
                summary: batch.summary,
            })
        ) {
            throw new ImportReviewPublishBatchValidationResetError(
                batchId.toString(),
                "Cannot reset validation on a promoted publish batch."
            );
        }
        if (batch.status === "promoting") {
            throw new ImportReviewPublishBatchValidationResetError(
                batchId.toString(),
                "Cannot reset validation while batch is promoting."
            );
        }
        if (batch.status === "validating") {
            const anchor = await this.resolveValidationHeartbeatAnchor(batchId, batch);
            const workerInProcess = runningBatchIds.has(batchId);
            const heartbeatStalled =
                isValidationHeartbeatStalled(anchor) || isValidationHeartbeatStale(anchor);
            const cancelRequested = batch.validation_cancel_requested_at != null;

            if (workerInProcess && !heartbeatStalled && !cancelRequested) {
                throw new ImportReviewPublishBatchValidationConflictError(
                    batchId.toString(),
                    "Validation is still running in this API process. Cancel validation first."
                );
            }

            const reason: "cancelled" | "stale_worker" = cancelRequested ? "cancelled" : "stale_worker";
            await this.repo.finalizeValidationAborted(batchId, reason);
            runningBatchIds.delete(batchId);
        } else if (runningBatchIds.has(batchId)) {
            throw new ImportReviewPublishBatchValidationConflictError(
                batchId.toString(),
                "Validation is still running in this API process. Cancel validation first."
            );
        }

        await this.repo.resetValidationState(batchId);
        return {
            batch_id: batchId.toString(),
            status: "draft",
            message: "Validation state reset. Publish items were kept; validation results cleared.",
        };
    }

    private async resolveValidationHeartbeatAnchor(
        batchId: bigint,
        batch: ImportReviewValidationHeartbeatState
    ): Promise<Date | null> {
        const logs = await this.repo.listStageLogs(batchId);
        const runningCandidate = logs.find(
            (l) => l.stage_key === "validate_candidate_state" && l.stage_status === "running"
        );
        const stageIso = runningCandidate
            ? extractStageLogHeartbeatIso(runningCandidate.details)
            : null;
        return heartbeatAnchorAt(batch, stageIso);
    }

    private async ensureNotAborted(batchId: bigint): Promise<void> {
        if (await this.repo.isValidationCancelRequested(batchId)) {
            throw new ImportReviewPublishBatchValidationAbortedError(
                batchId.toString(),
                "cancelled",
                "Validation cancelled."
            );
        }
    }

    private async handleValidationAborted(
        batchId: bigint,
        err: ImportReviewPublishBatchValidationAbortedError,
        _progressTotal: number,
        log?: FastifyBaseLogger
    ): Promise<void> {
        await this.pipelineProgress
            .failStage(batchId, "validate_items", err)
            .catch(() => undefined);
        await this.repo.finalizeValidationAborted(batchId, err.reason);

        log?.info(
            { batchId: batchId.toString(), reason: err.reason },
            "[import-review] publish validation aborted"
        );
    }

    private async runValidation(batchId: bigint, log?: FastifyBaseLogger): Promise<void> {
        let itemRows: PublishItemEntityRow[] = [];
        let itemState = new Map<string, ItemIssueState>();
        let groupedItems = new Map<string, bigint[]>();
        let validationTotal = 0;
        let validatableItemTotal = 0;

        try {
            await this.ensureNotAborted(batchId);
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

            const alreadyValidated = await seedItemStateFromPersistedValidation(
                this.repo.prisma,
                batchId,
                itemRows,
                itemState,
                "validate_candidate_state"
            );
            if (alreadyValidated > 0) {
                await this.repo.updateBatchProgress({
                    batchId,
                    validationTotal: progressTotal,
                    validationDone: alreadyValidated,
                    validationPercent: Math.min(
                        100,
                        Math.round((alreadyValidated / progressTotal) * 10000) / 100
                    ),
                });
            }

            await this.pipelineProgress.startStage(
                batchId,
                "validate_items",
                "Validate publish items",
                progressTotal
            );

            const simpleValidationOk = await this.runSimplePublishItemValidation({
                batchId,
                itemRows,
                itemState,
                progressTotal,
                log,
            });
            if (!simpleValidationOk) {
                return;
            }

            await this.runStage(batchId, "write_validation_summary", async () => {
                const actionCounts = await this.repo.fetchItemActionCounts(batchId);

                let readyCount = 0;
                let warningCount = 0;
                let blockedCount = 0;
                let skippedCount = 0;

                const byEntity: Record<string, ImportReviewPublishBatchEntityValidationCounts> = {};
                const initEntity = (family: string): ImportReviewPublishBatchEntityValidationCounts => {
                    if (!byEntity[family]) {
                        byEntity[family] = {
                            total: 0,
                            ready: 0,
                            valid: 0,
                            warning: 0,
                            blocked: 0,
                            skipped: 0,
                        };
                    }
                    return byEntity[family];
                };

                const persistRows: {
                    publishItemId: bigint;
                    status: string;
                    validationJson: Record<string, unknown>;
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

                    let status: "ready" | "warning" | "blocked" | "skipped" = "ready";
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
                        readyCount += 1;
                        bucket.ready += 1;
                        bucket.valid += 1;
                    }

                    const errors = state.issues.filter((i) => i.severity === "error");
                    const warnings = state.issues.filter((i) => i.severity === "warning");
                    const firstError = errors[0];
                    persistRows.push({
                        publishItemId: row.id,
                        status,
                        validationJson: {
                            status,
                            errors,
                            warnings,
                            issues: state.issues,
                        },
                        errorMessage: firstError?.message ?? null,
                    });
                }

                await this.repo.persistItemValidationResults(persistRows);

                const promotableFamilies = PROMOTABLE_PUBLISH_FAMILIES.filter(
                    (family) =>
                        (byEntity[family]?.ready ?? 0) + (byEntity[family]?.warning ?? 0) > 0
                );

                const finalized = computePublishBatchValidationFinalize({
                    readyCount,
                    warningCount,
                    blockedCount,
                    skippedCount,
                    totalCount: validationTotal,
                    promotableFamiliesCount: promotableFamilies.length,
                    by_publish_action: {
                        insert: actionCounts.insert,
                        update: actionCounts.update,
                        merge: actionCounts.merge,
                    },
                    by_entity: byEntity,
                    selected_entity_families: [
                        ...new Set(itemRows.map((row) => row.entity_family)),
                    ].sort(),
                    promotable_entity_families: [...promotableFamilies],
                });

                await this.repo.finalizeBatch({
                    batchId,
                    status: finalized.batchStatus,
                    validationTotal,
                    summary: {
                        validation_result: finalized.validationResult,
                        validation_logs_summary: finalized.logsSummary,
                    },
                });

                await this.repo.updateBatchProgress({
                    batchId,
                    validationTotal: progressTotal,
                    validationDone: progressTotal,
                    validationPercent: 100,
                });

                const pipelineFinishStatus =
                    finalized.stageStatus === "warning" ? "warning" : "success";
                await this.pipelineProgress.finishStage(
                    batchId,
                    "validate_items",
                    pipelineFinishStatus,
                    { message: finalized.logsSummary }
                );

                return {
                    message: finalized.logsSummary,
                    details: finalized.validationResult as unknown as Record<string, unknown>,
                    stageStatus: finalized.stageStatus,
                };
            });
        } catch (err) {
            if (err instanceof ImportReviewPublishBatchValidationAbortedError) {
                await this.handleValidationAborted(
                    batchId,
                    err,
                    validatableItemTotal || validationTotal || 1,
                    log
                );
            } else {
                const poolTimeout =
                    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2024";
                const message = poolTimeout
                    ? "Database connection timed out. Use a smaller batch or SQL bulk promotion."
                    : err instanceof Error
                      ? err.message
                      : "Validation failed unexpectedly.";
                log?.error({ err, batchId: batchId.toString() }, "publish batch validation failed");
                await this.pipelineProgress
                    .failStage(batchId, "validate_items", message)
                    .catch(() => undefined);
                await this.repo.failRunningValidationStages(batchId, "stale_worker", message);
                await this.repo.skipPendingValidationStages(batchId, "Skipped (validation failed).");
                await this.repo.failBatch(batchId, message);
            }
        } finally {
            runningBatchIds.delete(batchId);
        }
    }

    private async runSimplePublishItemValidation(args: {
        batchId: bigint;
        itemRows: PublishItemEntityRow[];
        itemState: Map<string, ItemIssueState>;
        progressTotal: number;
        log?: FastifyBaseLogger;
    }): Promise<boolean> {
        const stageKey = "validate_candidate_state" as ImportReviewPublishValidationStageKey;
        const stage = stageByKey(stageKey);
        const prevEnd = stageByKey("group_by_entity").progressEnd;

        await this.repo.updateStageLog({
            batchId: args.batchId,
            stageKey,
            stageStatus: "running",
            message: "Validating publish items (typed columns per family)…",
            progressPercent: prevEnd,
            details: {
                process_state: "running",
                engine: "import-review-promotion-simple-validation+roads-bulk-sql",
                processed_count: 0,
                total_item_count: args.progressTotal,
                elapsed_ms: 0,
                last_heartbeat_at: new Date().toISOString(),
            },
        });

        try {
            await this.ensureNotAborted(args.batchId);
            const outcomes = await this.simpleBatchValidation.validatePublishBatch(args.batchId, {
                shouldAbort: async () => this.repo.isValidationCancelRequested(args.batchId),
                onProgress: async (event) => {
                    await this.handleValidatePublishBatchProgress({
                        event,
                        progressTotal: args.progressTotal,
                        stageProgressStart: prevEnd,
                        stageProgressEnd: stage.progressEnd,
                        log: args.log,
                    });
                },
                onChunkComplete: async (chunkEvent) => {
                    await this.ensureNotAborted(args.batchId);
                    for (const outcome of chunkEvent.outcomes) {
                        mergeSimpleValidationOutcomeIntoItemState(
                            outcome,
                            args.itemState,
                            stageKey
                        );
                    }
                    await this.repo.persistItemValidationResults(
                        persistRowsFromSimpleValidationOutcomes(
                            chunkEvent.outcomes,
                            this.simpleBatchValidation,
                            stageKey
                        )
                    );
                    await this.handleValidatePublishBatchProgress({
                        event: {
                            batchId: chunkEvent.batchId,
                            done: chunkEvent.done,
                            total: chunkEvent.total,
                            family: chunkEvent.family,
                            candidateId: chunkEvent.lastCandidateId,
                            stageKey: "validate_candidate_state",
                            message: buildValidatePublishBatchProgressMessage({
                                done: chunkEvent.done,
                                total: chunkEvent.total,
                                family: chunkEvent.family,
                            }),
                            elapsedMs: chunkEvent.elapsedMs,
                        },
                        progressTotal: args.progressTotal,
                        stageProgressStart: prevEnd,
                        stageProgressEnd: stage.progressEnd,
                        chunk: {
                            chunkIndex: chunkEvent.chunkIndex,
                            chunkSize: chunkEvent.chunkSize,
                        },
                        log: args.log,
                    });
                },
            });

            await this.ensureNotAborted(args.batchId);

            const processedCount = outcomes.length;
            await this.repo.updateBatchProgress({
                batchId: args.batchId,
                validationTotal: args.progressTotal,
                validationDone: processedCount,
                validationPercent: stage.progressEnd,
            });

            const flagged = outcomes.filter((o) => o.result.status !== "ready").length;
            await this.repo.updateStageLog({
                batchId: args.batchId,
                stageKey,
                stageStatus: flagged > 0 ? "warning" : "success",
                message: `Simple validation complete (${flagged} item(s) with warnings or blockers).`,
                progressPercent: stage.progressEnd,
                details: {
                    flagged_items: flagged,
                    process_state: "completed",
                    engine: "import-review-promotion-simple-validation+roads-bulk-sql",
                    processed_count: processedCount,
                    total_item_count: args.progressTotal,
                },
                finished: true,
            });
            return true;
        } catch (err) {
            if (err instanceof ImportReviewPublishBatchValidationAbortedError) {
                await this.handleValidationAborted(
                    args.batchId,
                    err,
                    args.progressTotal,
                    args.log
                );
                return false;
            }
            const message =
                err instanceof Error ? err.message : "Simple publish-item validation failed.";
            const progress = await this.repo.fetchBatchProgress(args.batchId);
            await this.repo.updateStageLog({
                batchId: args.batchId,
                stageKey,
                stageStatus: "failed",
                message,
                progressPercent: progress?.validation_percent ?? prevEnd,
                details: {
                    process_state: "failed",
                    engine: "import-review-promotion-simple-validation+roads-bulk-sql",
                    processed_count: progress?.validation_done ?? 0,
                    total_item_count: args.progressTotal,
                    error_message: message,
                },
                finished: true,
            });
            await this.pipelineProgress
                .failStage(args.batchId, "validate_items", message)
                .catch(() => undefined);
            await this.repo.failBatch(args.batchId, message);
            return false;
        }
    }

    private async handleValidatePublishBatchProgress(args: {
        event: ValidatePublishBatchProgressEvent;
        progressTotal: number;
        stageProgressStart: number;
        stageProgressEnd: number;
        chunk?: ValidatePublishBatchChunkHeartbeat;
        log?: FastifyBaseLogger;
    }): Promise<void> {
        const total = Math.max(args.progressTotal, args.event.total, 1);
        const percent = progressBetweenStages(
            args.stageProgressStart,
            args.stageProgressEnd,
            args.event.done,
            total
        );
        const roundedPercent = Math.round(percent * 100) / 100;

        await this.repo.updateValidationHeartbeat({
            batchId: args.event.batchId,
            stageKey: args.event.stageKey,
            validationTotal: total,
            validationDone: args.event.done,
            validationPercent: roundedPercent,
            message: args.event.message,
            stageLogDetails: buildValidateCandidateStateStageHeartbeatDetails(
                args.event,
                args.chunk
            ),
        });

        await this.pipelineProgress
            .updateStageProgress(args.event.batchId, "validate_items", {
                processed: args.event.done,
                total,
                percent: roundedPercent,
                currentFamily: args.event.family,
                currentCandidateId: args.event.candidateId,
                message: args.event.message,
                heartbeatAt: new Date().toISOString(),
            })
            .catch(() => undefined);

        args.log?.info(
            {
                batchId: args.event.batchId.toString(),
                done: args.event.done,
                total: args.event.total,
                family: args.event.family,
                candidateId: args.event.candidateId.toString(),
                elapsedMs: args.event.elapsedMs,
                validationPercent: roundedPercent,
                ...(args.chunk?.chunkIndex !== undefined
                    ? { chunkIndex: args.chunk.chunkIndex, chunkSize: args.chunk.chunkSize }
                    : {}),
            },
            "[import-review] publish validation progress"
        );
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
        await this.ensureNotAborted(batchId);
        const stage = stageByKey(stageKey);
        await this.repo.touchValidationHeartbeat(batchId);
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
            if (err instanceof ImportReviewPublishBatchValidationAbortedError) {
                throw err;
            }
            const message = err instanceof Error ? err.message : "Stage failed.";
            await this.repo.updateStageLog({
                batchId,
                stageKey,
                stageStatus: "failed",
                message,
                progressPercent: stage.progressEnd,
                finished: true,
            });
            await this.repo.skipPendingValidationStages(batchId, "Skipped (validation failed).");
            await this.repo.failBatch(batchId, message);
            return false;
        }
    }
}
