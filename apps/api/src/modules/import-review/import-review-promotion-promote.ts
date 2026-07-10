import type { FastifyBaseLogger } from "fastify";

import { rebuildSearchAfterImportReviewBulkPromotion } from "../search/bulk-promotion-search-rebuild.js";
import {
    ImportReviewPublishBatchInvalidStatusError,
    ImportReviewPublishBatchNotFoundError,
    ImportReviewPublishBatchPromotionConflictError,
    ImportReviewPublishBatchPromotionConfirmationError,
    ImportReviewAdminAreaPromotionBatchLimitError,
    ImportReviewRoadPromotionBatchLimitError,
    ImportReviewRoadPromotionDisabledError,
    ImportReviewRoutingBarrierPromotionBatchLimitError,
    ImportReviewRoutingBarrierPromotionDisabledError,
} from "./import-review-promotion.errors.js";
import {
    IMPORT_REVIEW_ADMIN_AREA_PROMOTION_MAX_ITEMS,
    IMPORT_REVIEW_ROAD_PROMOTION_MAX_ITEMS,
    IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION_MAX_ITEMS,
    isImportReviewAdminAreaBulkPromotionEnabled,
    isImportReviewRoadBulkPromotionEnabled,
    isImportReviewRoutingBarrierBulkPromotionEnabled,
    isImportReviewRoutingBarrierPromotionEnabled,
} from "./import-review-config.js";
import {
    promotePublishItemsByFamilyChunks,
    recordPromotionItemOutcome,
    type PromotionRunAggregateCounters,
} from "./import-review-promotion-promote-chunk-executor.js";
import {
    DEFAULT_PROMOTE_CHUNK_SIZE,
    ImportReviewPromotionPromoteRepository,
    MAX_PROMOTE_CHUNK_SIZE,
    promoteAndCommitImportReviewItem,
} from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionProgress } from "./import-review-promotion-progress.js";
import {
    buildPromotionChunkStageDetails,
    buildPromotionPipelineProgressUpdate,
} from "./import-review-promotion-promote-runner-progress.js";
import {
    isPublishBatchClosedForReuse,
    publishBatchClosedForReuseMessage,
} from "./import-review-publish-batch-lifecycle.js";
import {
    parsePublishBatchDryRunResultFromSummary,
    publishBatchDryRunPassed,
} from "./import-review-publish-batch-dry-run.js";
import {
    derivePublishBatchStatus,
    parseCanPromoteFromSummary,
    parseDryRunFromSummary,
    parseValidationOutcomeFromSummary,
} from "./import-review-publish-batch-summary.js";
import {
    PROMOTABLE_PUBLISH_FAMILIES,
    type PromotablePublishEntityFamily,
} from "./import-review-promotion-config.js";
import {
    assertPromotionNotBlocked,
    assertPromotionWarningConfirmationAllowed,
    buildPromotionPreflightFromItemSelection,
    initPromotionCountsByFamily,
    resolvePromotionWarningNote,
} from "./import-review-promotion-promote-api.js";
import { publishBatchReadyForPromotion } from "./import-review-promotion-promote-readiness.js";
import {
    evaluateRoadPromotionGates,
    logRoadPromoteGateDebug,
    roadPromotionGateErrorMessage,
} from "./import-review-road-promotion-gates.js";
import {
    appendSampleFailureHint,
    summarizeFamilyPromotionFailures,
    type PromotionFailureSample,
} from "./import-review-promotion-failure.js";
import {
    buildPromotionStagePlan,
    previousStageFromPlan,
    PROMOTION_STAGE_FINAL,
    PROMOTION_STAGE_MARK_IMPORTED,
    PROMOTION_STAGE_PREFLIGHT,
    PROMOTION_STAGE_UPDATE_SUMMARY,
    PROMOTION_STAGE_VERIFY_CORE,
    resolvePromotionStageFamilies,
    stageByKeyFromPlan,
    type PromotionStagePlan,
} from "./import-review-promotion-promote-stages.js";
import {
    resolvePromotionNote,
    type PublishItemPromotionGateInput,
} from "./import-review-promotion-publish-item-validation.js";
import { classifyPublishItemsForPromotion, computePromotionRunFinalize } from "./import-review-promotion-execution.js";
import {
    recoverStalePromotionBatchIfNeeded,
} from "./import-review-promotion-promote-control.js";
import {
    buildPromotionStageHeartbeatDetails,
    newPromotionAttemptId,
} from "./import-review-promotion-promote-progress.js";
import {
    type ImportReviewPublishBatchPromotionResult,
    type ImportReviewPublishPromotionStageKey,
} from "./import-review-promotion-promote.types.js";

const runningPromoteBatchIds = new Set<bigint>();

export function isImportReviewPromotionWorkerRunning(batchId: bigint): boolean {
    return runningPromoteBatchIds.has(batchId);
}

function progressBetween(prevEnd: number, nextEnd: number, done: number, total: number): number {
    if (total <= 0) {
        return nextEnd;
    }
    return prevEnd + (nextEnd - prevEnd) * Math.min(1, Math.max(0, done / total));
}

export class ImportReviewPromotionPromoteRunner {
    private readonly pipelineProgress: ImportReviewPromotionProgress;

    constructor(
        private readonly repo: ImportReviewPromotionPromoteRepository,
        pipelineProgress?: ImportReviewPromotionProgress
    ) {
        this.pipelineProgress =
            pipelineProgress ?? new ImportReviewPromotionProgress(this.repo.prisma);
    }

    isRunning(batchId: bigint): boolean {
        return runningPromoteBatchIds.has(batchId);
    }

    async startPromotion(args: {
        batchId: bigint;
        confirmationText?: string;
        confirmWarnings?: boolean;
        allowHighRiskFamilies?: boolean;
        confirmLargeBatch?: boolean;
        promotionNote?: string;
        warningConfirmationNote?: string;
        chunkSize?: number;
        promotedBy: bigint | null;
        log?: FastifyBaseLogger;
    }): Promise<{ batch_id: string; status: string; message: string }> {
        const confirmationText = args.confirmationText ?? "PROMOTE";
        if (confirmationText !== "PROMOTE") {
            throw new ImportReviewPublishBatchPromotionConfirmationError(
                args.batchId.toString(),
                'confirmation_text must be exactly "PROMOTE".'
            );
        }

        if (runningPromoteBatchIds.has(args.batchId)) {
            throw new ImportReviewPublishBatchPromotionConflictError(
                args.batchId.toString(),
                "Promotion is already running for this publish batch."
            );
        }

        const before = await this.repo.fetchBatchProgress(args.batchId);
        if (!before) {
            throw new ImportReviewPublishBatchNotFoundError(args.batchId.toString());
        }

        if (before.status === "promoting") {
            throw new ImportReviewPublishBatchPromotionConflictError(
                args.batchId.toString(),
                "Publish batch is already promoting."
            );
        }

        const promotionGate = {
            confirm_warnings: args.confirmWarnings === true,
            promotion_note: args.promotionNote,
            warning_confirmation_note: args.warningConfirmationNote,
            review_note: args.warningConfirmationNote,
        };
        const pendingRows = await this.repo.listPendingPublishItemValidationRows(args.batchId);
        const itemSelection = classifyPublishItemsForPromotion(pendingRows, promotionGate);
        const validation = buildPromotionPreflightFromItemSelection(pendingRows, itemSelection);

        if (
            !publishBatchReadyForPromotion({
                batch: { ...before, summary: before.summary },
                validation,
            })
        ) {
            throw new ImportReviewPublishBatchInvalidStatusError(
                args.batchId.toString(),
                before.status,
                isPublishBatchClosedForReuse(before.status)
                    ? publishBatchClosedForReuseMessage(before.status)
                    : !publishBatchDryRunPassed(parsePublishBatchDryRunResultFromSummary(before.summary))
                      ? "Run batch dry-run after validation before promote."
                      : itemSelection.promotableIds.length > 0
                        ? "Batch validation outcome does not allow promotion."
                        : "No pending ready items to promote."
            );
        }
        try {
            assertPromotionNotBlocked(validation);
        } catch (err) {
            throw new ImportReviewPublishBatchInvalidStatusError(
                args.batchId.toString(),
                before.status,
                err instanceof Error ? err.message : "Batch validation blocks promotion."
            );
        }
        try {
            assertPromotionWarningConfirmationAllowed(validation, promotionGate);
        } catch (err) {
            throw new ImportReviewPublishBatchPromotionConfirmationError(
                args.batchId.toString(),
                err instanceof Error ? err.message : "Warning confirmation required."
            );
        }

        const roadItemCount = await this.repo.countRoadPublishItems(args.batchId);
        if (roadItemCount > 0) {
            const dryRun = await this.repo.readRoadDryRunResult(args.batchId);
            const roadDryRunSummary = await this.repo.readRoadDryRunSummary(args.batchId);
            const routingReadinessSummary = await this.repo.readRoutingReadinessSummary(
                args.batchId
            );
            const roadsReadyAtValidation =
                validation.ready_count > 0 ? validation.ready_count : validation.promotable_count;
            const publishBatchDryRun = parsePublishBatchDryRunResultFromSummary(before.summary);
            const roadGates = evaluateRoadPromotionGates({
                road_item_count: roadItemCount,
                validation_percent: before.validation_percent,
                validation,
                batch_status: before.status,
                batch_summary: before.summary,
                publish_batch_dry_run: publishBatchDryRun,
                road_dry_run: roadDryRunSummary,
                routing_readiness_validation: routingReadinessSummary,
                dry_run: dryRun,
                roads_ready_at_validation: roadsReadyAtValidation,
                promote_request: {
                    allow_high_risk_families: args.allowHighRiskFamilies === true,
                    confirm_large_batch: args.confirmLargeBatch === true,
                },
            });
            logRoadPromoteGateDebug({
                batchId: args.batchId.toString(),
                readyCount: roadsReadyAtValidation,
                isRoadBatch: true,
                dryRunPassed: publishBatchDryRunPassed(publishBatchDryRun),
                envRoadPromotion: roadGates.env_enabled,
                envRoadBulkPromotion: isImportReviewRoadBulkPromotionEnabled(),
                envRoadApiBulkPromotion: roadGates.api_bulk_promotion_allowed,
                allowHighRisk: args.allowHighRiskFamilies === true,
                confirmLargeBatch: args.confirmLargeBatch === true,
                allowed: roadGates.can_promote,
                message: roadGates.primary_blocker_message,
            });
            if (!roadGates.can_promote) {
                throw new ImportReviewRoadPromotionDisabledError(
                    args.batchId.toString(),
                    roadPromotionGateErrorMessage(roadGates)
                );
            }
        }
        if (
            roadItemCount > IMPORT_REVIEW_ROAD_PROMOTION_MAX_ITEMS &&
            !isImportReviewRoadBulkPromotionEnabled()
        ) {
            throw new ImportReviewRoadPromotionBatchLimitError(
                args.batchId.toString(),
                roadItemCount,
                IMPORT_REVIEW_ROAD_PROMOTION_MAX_ITEMS
            );
        }

        const adminAreaItemCount = await this.repo.countAdminAreaPublishItems(args.batchId);
        if (
            adminAreaItemCount > IMPORT_REVIEW_ADMIN_AREA_PROMOTION_MAX_ITEMS &&
            !isImportReviewAdminAreaBulkPromotionEnabled()
        ) {
            throw new ImportReviewAdminAreaPromotionBatchLimitError(
                args.batchId.toString(),
                adminAreaItemCount,
                IMPORT_REVIEW_ADMIN_AREA_PROMOTION_MAX_ITEMS
            );
        }

        const routingBarrierItemCount = await this.repo.countRoutingBarrierPublishItems(args.batchId);
        if (routingBarrierItemCount > 0 && !isImportReviewRoutingBarrierPromotionEnabled()) {
            throw new ImportReviewRoutingBarrierPromotionDisabledError(args.batchId.toString());
        }
        if (
            routingBarrierItemCount > IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION_MAX_ITEMS &&
            !isImportReviewRoutingBarrierBulkPromotionEnabled()
        ) {
            throw new ImportReviewRoutingBarrierPromotionBatchLimitError(
                args.batchId.toString(),
                routingBarrierItemCount,
                IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION_MAX_ITEMS
            );
        }

        const claim = await this.repo.claimBatchForPromotion(
            args.batchId,
            itemSelection.promotableIds.length
        );
        if (!claim.claimed) {
            if (claim.status === "promoting") {
                throw new ImportReviewPublishBatchPromotionConflictError(
                    args.batchId.toString(),
                    "Publish batch is already promoting."
                );
            }
            throw new ImportReviewPublishBatchInvalidStatusError(
                args.batchId.toString(),
                claim.status ?? before.status,
                "Publish batch could not be claimed for promotion."
            );
        }

        const chunkSize = Math.min(
            MAX_PROMOTE_CHUNK_SIZE,
            Math.max(1, args.chunkSize ?? DEFAULT_PROMOTE_CHUNK_SIZE)
        );

        const pendingItemFamilies = await this.repo.listPendingPublishItemEntityFamilies(args.batchId);
        const stageFamilies = resolvePromotionStageFamilies(
            pendingRows,
            pendingItemFamilies,
            promotionGate
        );
        const stagePlan = buildPromotionStagePlan(stageFamilies);

        const promotionAttemptId = newPromotionAttemptId();
        await this.repo.clearStageLogs(args.batchId);
        await this.repo.seedPromotionStageLogs(args.batchId, stagePlan.stages);
        await this.repo.mergePromotionSummaryPatch(args.batchId, {
            promotion_attempt_id: promotionAttemptId,
            promotion_heartbeat_at: new Date().toISOString(),
            promotion_cancel_requested_at: null,
            promotion_progress_total: itemSelection.promotableIds.length,
            promotion_progress_done: 0,
        });

        const promotionNote =
            resolvePromotionNote({
                promotion_note: args.promotionNote,
                warning_confirmation_note: args.warningConfirmationNote,
                review_note: args.warningConfirmationNote,
            }) ??
            resolvePromotionWarningNote({
                confirmation_text: "PROMOTE",
                chunk_size: chunkSize,
                confirm_warnings: args.confirmWarnings === true,
                allow_high_risk_families: args.allowHighRiskFamilies === true,
                confirm_large_batch: args.confirmLargeBatch === true,
                promotion_note: args.promotionNote,
                warning_confirmation_note: args.warningConfirmationNote,
                review_note: args.warningConfirmationNote,
            });

        runningPromoteBatchIds.add(args.batchId);
        void this.runPromotion({
            batchId: args.batchId,
            chunkSize,
            promotedBy: args.promotedBy,
            confirmWarnings: args.confirmWarnings === true,
            promotionNote,
            stagePlan,
            promotionAttemptId,
            log: args.log,
        }).catch((err) => {
            args.log?.error({ err, batchId: args.batchId.toString() }, "publish batch promotion crashed");
        });

        return {
            batch_id: args.batchId.toString(),
            status: "promoting",
            message: "Promotion started.",
        };
    }

    private async assertPromotionNotCancelled(batchId: bigint): Promise<void> {
        if (await this.repo.isPromotionCancelRequested(batchId)) {
            throw new Error("Promotion cancelled.");
        }
    }

    private async touchPromotionProgressHeartbeat(
        batchId: bigint,
        attemptId: string,
        progressTotal: number,
        progressDone: number,
        stageKey: ImportReviewPublishPromotionStageKey,
        stageDetails: Record<string, unknown>
    ): Promise<void> {
        await this.repo.touchPromotionHeartbeat(batchId, {
            attemptId,
            progressTotal,
            progressDone,
            stageDetails,
        });
        await this.repo.updateStageLog({
            batchId,
            stageKey,
            stageStatus: "running",
            message: typeof stageDetails.phase === "string" ? `Preflight: ${stageDetails.phase}` : undefined,
            progressPercent: progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0,
            details: stageDetails,
        });
    }

    private async runPromotion(args: {
        batchId: bigint;
        chunkSize: number;
        promotedBy: bigint | null;
        confirmWarnings: boolean;
        promotionNote?: string;
        stagePlan: PromotionStagePlan;
        promotionAttemptId: string;
        log?: FastifyBaseLogger;
    }): Promise<void> {
        const {
            batchId,
            chunkSize,
            promotedBy,
            confirmWarnings,
            promotionNote,
            stagePlan,
            promotionAttemptId,
            log,
        } = args;
        const promotionGate: PublishItemPromotionGateInput = {
            confirm_warnings: confirmWarnings,
            promotion_note: promotionNote,
            warning_confirmation_note: promotionNote,
            review_note: promotionNote,
        };
        const startedAt = Date.now();
        let inserted = 0;
        let updated = 0;
        let success = 0;
        let failed = 0;
        let skipped = 0;
        let coreVerified = 0;
        let markedPromoted = 0;
        let verificationMetadataApplied = 0;
        let verificationMetadataSkippedAlreadyVerified = 0;
        let activeStageKey: ImportReviewPublishPromotionStageKey | null = null;
        let failureMessage: string | null = null;
        let promotionLogsSummary: string | null = null;
        const promotedFamilies = new Set<string>();
        const countsByFamily = initPromotionCountsByFamily(PROMOTABLE_PUBLISH_FAMILIES);

        try {
            let promotionSelection = await this.repo.selectPublishItemsForPromotion(
                batchId,
                promotionGate
            );
            const pendingIds = promotionSelection.promotableIds;
            const skippedBlockedAtStart = promotionSelection.skipped_blocked_count;
            const skippedWarningAtStart = promotionSelection.skipped_warning_count;

            activeStageKey = PROMOTION_STAGE_PREFLIGHT;
            const preflightOk = await this.runStage(batchId, stagePlan, PROMOTION_STAGE_PREFLIGHT, async () => {
                await this.assertPromotionNotCancelled(batchId);
                const batch = await this.repo.fetchBatchProgress(batchId);
                if (!batch) {
                    throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
                }
                const skipCounts = await this.repo.countPromotionPreflightSkips(batchId);
                const reserved = await this.repo.countReservedNonPromotableItems(batchId);
                const promotableTotal = pendingIds.length;

                let preflightDetails = buildPromotionStageHeartbeatDetails({
                    attemptId: promotionAttemptId,
                    checkedCount: skipCounts.pending_total,
                    promotableCount: promotableTotal,
                    skippedPromotedCount: skipCounts.skipped_promoted_count,
                    skippedFailedCount: skipCounts.skipped_failed_count,
                    skippedBlockedCount: skipCounts.skipped_blocked_count,
                    skippedSkippedCount: skipCounts.skipped_skipped_count,
                    skippedWarningCount: skipCounts.skipped_warning_count,
                    phase: "counting",
                });
                await this.touchPromotionProgressHeartbeat(
                    batchId,
                    promotionAttemptId,
                    promotableTotal,
                    0,
                    PROMOTION_STAGE_PREFLIGHT,
                    preflightDetails
                );

                await this.assertPromotionNotCancelled(batchId);

                const pendingByFamily = await this.repo.countPendingByEntityFamily(batchId);
                const familyNote = stagePlan.familyStages
                    .map((s) => `${s.entityFamily}: ${pendingByFamily[s.entityFamily] ?? 0}`)
                    .join(", ");
                const note =
                    reserved > 0
                        ? ` ${reserved} non-promotable item(s) will remain reserved.`
                        : "";
                const skipNote = ` Skipping ${skipCounts.skipped_promoted_count} promoted, ${skipCounts.skipped_failed_count} failed, ${skipCounts.skipped_blocked_count} blocked, ${skipCounts.skipped_skipped_count} skipped, ${promotionSelection.skipped_warning_count} warning (no confirm).`;

                let finalValidationNote = "";
                if (pendingIds.length > 0) {
                    preflightDetails = {
                        ...preflightDetails,
                        phase: "final_validation",
                    };
                    await this.touchPromotionProgressHeartbeat(
                        batchId,
                        promotionAttemptId,
                        promotableTotal,
                        0,
                        PROMOTION_STAGE_PREFLIGHT,
                        preflightDetails
                    );
                    const errorCount = await this.repo.runFinalValidationBeforeWrite(
                        pendingIds,
                        promotionGate
                    );
                    if (errorCount > 0) {
                        throw new Error(
                            `Final validation found ${errorCount} blocking issue(s). Promotion aborted.`
                        );
                    }
                    finalValidationNote = ` Final validation passed for ${pendingIds.length} item(s).`;
                }
                const counts = await this.repo.countByPublishActionForIds(batchId, pendingIds);
                await this.repo.updateBatchProgress({
                    batchId,
                    validationTotal: promotableTotal,
                    validationDone: 0,
                    validationPercent: stageByKeyFromPlan(stagePlan, PROMOTION_STAGE_PREFLIGHT).progressEnd,
                });
                await this.repo.touchPromotionHeartbeat(batchId, {
                    attemptId: promotionAttemptId,
                    progressTotal: promotableTotal,
                    progressDone: 0,
                });
                return {
                    message: `Preflight passed. ${promotableTotal} item(s) to promote (${familyNote}).${skipNote}${note}${finalValidationNote} Loaded ${pendingIds.length} pending ready item(s): ${counts.insert} insert, ${counts.update} update.`,
                    details: {
                        promotion_attempt_id: promotionAttemptId,
                        promotable_items: promotableTotal,
                        checked_count: skipCounts.pending_total,
                        skipped_promoted_count: skipCounts.skipped_promoted_count,
                        skipped_failed_count: skipCounts.skipped_failed_count,
                        skipped_blocked_count: skipCounts.skipped_blocked_count,
                        skipped_skipped_count: skipCounts.skipped_skipped_count,
                        skipped_warning_count: promotionSelection.skipped_warning_count,
                        pending_by_entity_family: pendingByFamily,
                        reserved_non_promotable_items: reserved,
                        promotion_stage_families: stagePlan.familyStages.map((s) => s.entityFamily),
                        ...counts,
                    },
                };
            });
            if (!preflightOk) {
                return;
            }

            const items = await this.repo.listPromotableItems(batchId);
            const itemsById = new Map(items.map((row) => [row.publish_item_id, row]));

            if (pendingIds.length === 0) {
                const batch = await this.repo.fetchBatchProgress(batchId);
                const logsSummary =
                    skippedBlockedAtStart > 0
                        ? `No promotable items. ${skippedBlockedAtStart} blocked item(s) remain unpromoted.`
                        : skippedWarningAtStart > 0
                          ? `No promotable items. ${skippedWarningAtStart} warning item(s) need confirmation before promotion.`
                          : "No promotable items were found.";
                const finishedAt = Date.now();
                const promotionResult: ImportReviewPublishBatchPromotionResult = {
                    status: "failed",
                    promoted_count: 0,
                    skipped_blocked_count: skippedBlockedAtStart,
                    skipped_warning_count: skippedWarningAtStart,
                    inserted_count: 0,
                    updated_count: 0,
                    success_count: 0,
                    failed_count: 0,
                    skipped_count: 0,
                    total: 0,
                    core_verified_count: 0,
                    import_review_marked_promoted_count: 0,
                    verification_metadata_applied_count: 0,
                    verification_metadata_skipped_already_verified_count: 0,
                    started_at: new Date(startedAt).toISOString(),
                    finished_at: new Date(finishedAt).toISOString(),
                    duration_ms: finishedAt - startedAt,
                    promoted_entity_families: [],
                    by_entity_family: {},
                };

                await this.runStage(batchId, stagePlan, PROMOTION_STAGE_UPDATE_SUMMARY, async () => {
                    await this.repo.finalizePromotionBatch({
                        batchId,
                        status: "failed",
                        successCount: 0,
                        failedCount: 0,
                        skippedCount: 0,
                        totalItemCount: 0,
                        promotedBy,
                        setPromotedAt: false,
                        summary: {
                            promotion_status: "promotion_failed",
                            promotion_result: promotionResult,
                            promotion_logs_summary: logsSummary,
                        },
                    });
                    await this.repo.syncPublishBatchSummary(batchId);
                    await this.repo.syncReviewBatchStatusForPublishBatch(batchId);
                    return {
                        message: "Batch summary updated.",
                        details: promotionResult as unknown as Record<string, unknown>,
                    };
                });

                await this.runStage(batchId, stagePlan, PROMOTION_STAGE_FINAL, async () => ({
                    message: logsSummary,
                    details: { counts: { total: 0, success: 0, failed: 0, skipped: 0 } },
                    stageStatus: "failed",
                }));
                return;
            }

            const batchBeforePromote = await this.repo.fetchBatchProgress(batchId);

            const total = pendingIds.length;
            let globalDone = 0;

            const runCounters: PromotionRunAggregateCounters = {
                inserted,
                updated,
                success,
                failed,
                skipped,
                verificationMetadataApplied,
                verificationMetadataSkippedAlreadyVerified,
            };

            await this.pipelineProgress.startStage(
                batchId,
                "promote_items",
                "Promote publish items",
                total
            );

            for (const familyStage of stagePlan.familyStages) {
                activeStageKey = familyStage.key as ImportReviewPublishPromotionStageKey;
                const familyPendingIds = pendingIds.filter((id) => {
                    const row = itemsById.get(id);
                    return row?.entity_family === familyStage.entityFamily;
                });
                const familyCounts = countsByFamily[familyStage.entityFamily];
                const promoteStage = stageByKeyFromPlan(stagePlan, familyStage.key);
                const prevStage = previousStageFromPlan(stagePlan, familyStage.key);

                await this.repo.updateStageLog({
                    batchId,
                    stageKey: familyStage.key as ImportReviewPublishPromotionStageKey,
                    stageStatus: "running",
                    message: `Promoting ${familyStage.entityFamily} to core…`,
                    progressPercent: prevStage?.progressEnd ?? 0,
                });

                const globalOffset = globalDone;
                const { familySuccess, familyFailed } = await promotePublishItemsByFamilyChunks({
                    family: familyStage.entityFamily,
                    publishItemIds: familyPendingIds,
                    globalProcessedOffset: globalOffset,
                    globalTotal: total,
                    assertNotCancelled: () => this.assertPromotionNotCancelled(batchId),
                    hasItemRow: (publishItemId) => itemsById.has(publishItemId),
                    promoteItem: (publishItemId) =>
                        promoteAndCommitImportReviewItem(this.repo.prisma, {
                            batchId,
                            publishItemId,
                            promotedBy,
                            confirmWarnings,
                            promotionNote,
                        }),
                    recordOutcome: (result, publishItemId) => {
                        const itemRow = itemsById.get(publishItemId);
                        recordPromotionItemOutcome({
                            result,
                            hasItemRow: itemRow != null,
                            counters: runCounters,
                            familyCounts,
                            promotedFamilies,
                            entityFamily: familyStage.entityFamily,
                        });
                        if (
                            itemRow &&
                            result.target_id != null &&
                            (result.outcome === "inserted" || result.outcome === "updated")
                        ) {
                            markedPromoted += 1;
                        }
                    },
                    onChunkComplete: async (chunkEvent) => {
                        globalDone = chunkEvent.globalProcessed;
                        inserted = runCounters.inserted;
                        updated = runCounters.updated;
                        success = runCounters.success;
                        failed = runCounters.failed;
                        skipped = runCounters.skipped;
                        verificationMetadataApplied = runCounters.verificationMetadataApplied;
                        verificationMetadataSkippedAlreadyVerified =
                            runCounters.verificationMetadataSkippedAlreadyVerified;

                        const stagePercent = progressBetween(
                            prevStage?.progressEnd ?? 0,
                            promoteStage.progressEnd,
                            chunkEvent.familyProcessed,
                            chunkEvent.familyTotal
                        );
                        const pipelineUpdate = buildPromotionPipelineProgressUpdate({
                            processed: globalDone,
                            total,
                            currentFamily: chunkEvent.family,
                            promotedCount: success,
                            failedCount: failed,
                            skippedCount: skipped,
                        });

                        await this.repo.updateBatchProgress({
                            batchId,
                            validationDone: Math.min(globalDone, total),
                            validationPercent: Math.round(stagePercent * 100) / 100,
                        });
                        await this.repo.touchPromotionHeartbeat(batchId, {
                            attemptId: promotionAttemptId,
                            progressTotal: total,
                            progressDone: Math.min(globalDone, total),
                            stageDetails: buildPromotionChunkStageDetails({
                                family: chunkEvent.family,
                                processed: globalDone,
                                total,
                                promoted_count: success,
                                failed_count: failed,
                                skipped_count: skipped,
                                percent: pipelineUpdate.percent,
                                chunkIndex: chunkEvent.chunkIndex,
                                chunkSize: chunkEvent.chunkSize,
                                familyItemCount: chunkEvent.familyTotal,
                            }),
                        });
                        await this.pipelineProgress.updateStageProgress(batchId, "promote_items", {
                            processed: globalDone,
                            total,
                            currentFamily: chunkEvent.family,
                            successCount: success,
                            failedCount: failed,
                            skippedCount: skipped,
                            percent: pipelineUpdate.percent,
                            message: pipelineUpdate.message,
                        });
                        await this.repo.updateStageLog({
                            batchId,
                            stageKey: familyStage.key as ImportReviewPublishPromotionStageKey,
                            stageStatus: "running",
                            message: pipelineUpdate.message,
                            progressPercent: Math.round(stagePercent * 100) / 100,
                            details: {
                                entity_family: chunkEvent.family,
                                done: chunkEvent.familyProcessed,
                                total: chunkEvent.familyTotal,
                                current_family: chunkEvent.family,
                                processed: globalDone,
                                promoted_count: success,
                                failed_count: failed,
                                skipped_count: skipped,
                                percent: pipelineUpdate.percent,
                                inserted,
                                updated,
                                success,
                                failed,
                                skipped,
                                chunk_index: chunkEvent.chunkIndex,
                                chunk_size: chunkEvent.chunkSize,
                            },
                        });
                    },
                });

                const familyFailureStageDetails =
                    familyFailed > 0
                        ? summarizeFamilyPromotionFailures(
                              await this.repo.listFailedPublishItemsForFamily(
                                  batchId,
                                  familyStage.entityFamily
                              )
                          )
                        : {
                              failed_count: 0,
                              sample_candidate_ids: [],
                              sample_error_messages: [],
                          };

                const familyMessage =
                    familyFailed > 0
                        ? `Promoted ${familySuccess} ${familyStage.entityFamily} item(s) (${familyFailed} failed).`
                        : `Promoted ${familySuccess} ${familyStage.entityFamily} item(s).`;
                await this.repo.updateStageLog({
                    batchId,
                    stageKey: familyStage.key as ImportReviewPublishPromotionStageKey,
                    stageStatus: familyFailed > 0 && familySuccess === 0 ? "failed" : "success",
                    message: familyMessage,
                    progressPercent: promoteStage.progressEnd,
                    details: {
                        entity_family: familyStage.entityFamily,
                        success: familySuccess,
                        failed: familyFailed,
                        failed_count: familyFailureStageDetails.failed_count,
                        sample_candidate_ids: familyFailureStageDetails.sample_candidate_ids,
                        sample_error_messages: familyFailureStageDetails.sample_error_messages,
                        skipped,
                        inserted,
                        updated,
                        promoted_entity_families: [...promotedFamilies],
                    },
                    finished: true,
                });
            }

            await this.pipelineProgress.finishStage(
                batchId,
                "promote_items",
                failed > 0 && success === 0 ? "failed" : failed > 0 ? "warning" : "success",
                {
                    message:
                        failed > 0
                            ? `Promotion finished with ${success} promoted and ${failed} failed.`
                            : `Promotion finished. ${success} item(s) promoted.`,
                }
            );

            activeStageKey = PROMOTION_STAGE_MARK_IMPORTED;
            await this.runStage(batchId, stagePlan, PROMOTION_STAGE_MARK_IMPORTED, async () => {
                const count = await this.repo.countMarkedPromoted(batchId);
                markedPromoted = count;
                return {
                    message: `Marked ${count} import_review candidate(s) as promoted.`,
                    details: { count },
                };
            });

            let verifyFailed = false;
            activeStageKey = PROMOTION_STAGE_VERIFY_CORE;
            await this.runStage(batchId, stagePlan, PROMOTION_STAGE_VERIFY_CORE, async () => {
                const v = await this.repo.verifyCoreRows(batchId);
                coreVerified = success - v.missing;
                if (v.missing > 0 || v.invalid_geom > 0 || v.missing_names > 0) {
                    verifyFailed = true;
                    return {
                        message: `Core verification found ${v.missing} missing, ${v.invalid_geom} invalid geometry, ${v.missing_names} missing place names.`,
                        stageStatus: "warning",
                        details: v,
                    };
                }
                return {
                    message: `Verified ${coreVerified} core row(s).`,
                    details: v,
                };
            });

            const finishedAt = Date.now();
            const durationMs = finishedAt - startedAt;
            const itemCounts = await this.repo.countPublishItemsByStatus(batchId);
            const runFinalize = computePromotionRunFinalize(
                {
                    promoted_count: success,
                    failed_count: failed,
                    skipped_blocked_count: skippedBlockedAtStart,
                    skipped_warning_count: skippedWarningAtStart,
                    pending_after_count: itemCounts.pending,
                    total_batch_items: itemCounts.total,
                    system_error: verifyFailed && success === 0,
                },
                {
                    validation_outcome: parseValidationOutcomeFromSummary(batchBeforePromote?.summary),
                    previous_stored_status: batchBeforePromote?.status ?? null,
                }
            );

            const derived = derivePublishBatchStatus({
                stored_status: runFinalize.stored_batch_status,
                validated_at: batchBeforePromote?.validated_at ?? null,
                promoted_at: runFinalize.set_promoted_at ? new Date(finishedAt) : null,
                dry_run: parseDryRunFromSummary(batchBeforePromote?.summary),
                validation_outcome: parseValidationOutcomeFromSummary(batchBeforePromote?.summary),
                can_promote: parseCanPromoteFromSummary(batchBeforePromote?.summary),
                promotion_status: runFinalize.promotion_status,
                item_counts: {
                    pending: itemCounts.pending,
                    success: itemCounts.success,
                    failed: itemCounts.failed,
                    skipped: itemCounts.skipped,
                    rolled_back: 0,
                    total: itemCounts.total,
                },
                action_counts: { inserted, updated, merged: 0 },
                core_verified_count: coreVerified,
                import_review_marked_promoted_count: markedPromoted,
                promotion_result_total: itemCounts.total,
                promotion_result_success_count: success,
                promotion_result_core_verified_count: coreVerified,
                promotion_result_marked_promoted_count: markedPromoted,
                evaluate_promotion_outcome: true,
            });

            const batchStatus = runFinalize.stored_batch_status;
            const promotionStatus = runFinalize.promotion_result_status;
            const sampleFailures: PromotionFailureSample[] =
                failed > 0 ? await this.repo.listPromotionFailureSamples(batchId, 5) : [];
            promotionLogsSummary = appendSampleFailureHint(
                verifyFailed
                    ? "Promotion finished but core verification reported issues."
                    : runFinalize.logs_summary,
                sampleFailures
            );

            const promotionResult: ImportReviewPublishBatchPromotionResult = {
                status: promotionStatus,
                promoted_count: success,
                skipped_blocked_count: skippedBlockedAtStart,
                skipped_warning_count: skippedWarningAtStart,
                inserted_count: inserted,
                updated_count: updated,
                success_count: success,
                failed_count: failed,
                skipped_count: skipped,
                total: itemCounts.total,
                core_verified_count: coreVerified,
                import_review_marked_promoted_count: markedPromoted,
                verification_metadata_applied_count: verificationMetadataApplied,
                verification_metadata_skipped_already_verified_count:
                    verificationMetadataSkippedAlreadyVerified,
                partial_promotion: runFinalize.partial_promotion || undefined,
                started_at: new Date(startedAt).toISOString(),
                finished_at: new Date(finishedAt).toISOString(),
                duration_ms: durationMs,
                promoted_entity_families: [...promotedFamilies],
                by_entity_family: countsByFamily,
                sample_failures: sampleFailures.length > 0 ? sampleFailures : undefined,
            };

            activeStageKey = PROMOTION_STAGE_UPDATE_SUMMARY;
            await this.runStage(batchId, stagePlan, PROMOTION_STAGE_UPDATE_SUMMARY, async () => {
                await this.repo.finalizePromotionBatch({
                    batchId,
                    status: batchStatus,
                    successCount: success,
                    failedCount: failed,
                    skippedCount: skipped,
                    totalItemCount: itemCounts.total,
                    promotedBy,
                    setPromotedAt: runFinalize.set_promoted_at,
                    summary: {
                        promotion_status: runFinalize.promotion_status,
                        promotion_result: promotionResult,
                        promotion_logs_summary: promotionLogsSummary,
                        partial_promotion: runFinalize.partial_promotion,
                        partial_success: runFinalize.partial_promotion,
                    },
                });
                await this.repo.syncPublishBatchSummary(batchId);
                await this.repo.syncReviewBatchStatusForPublishBatch(batchId);
                return {
                    message: "Batch summary updated.",
                    details: promotionResult as unknown as Record<string, unknown>,
                };
            });

            if (success > 0 && promotedFamilies.size > 0) {
                try {
                    await rebuildSearchAfterImportReviewBulkPromotion(
                        this.repo.prisma,
                        {
                            workflow: "import-review-publish-batch-promotion",
                            promotedCount: success,
                            promotedFamilies,
                            countsByFamily,
                            batchId,
                        },
                        log
                            ? {
                                  info: (obj, msg) => log.info(obj, msg),
                                  warn: (obj, msg) => log.warn(obj, msg),
                                  error: (obj, msg) => log.error(obj, msg),
                              }
                            : undefined,
                    );
                } catch (searchRebuildErr) {
                    log?.error(
                        { err: searchRebuildErr, batchId: batchId.toString() },
                        "publish batch promotion search family rebuild failed",
                    );
                }
            }

            activeStageKey = PROMOTION_STAGE_FINAL;
            await this.runStage(batchId, stagePlan, PROMOTION_STAGE_FINAL, async () => ({
                message:
                    runFinalize.promotion_status === "promotion_failed"
                        ? runFinalize.logs_summary
                        : (promotionLogsSummary ?? "Promotion completed."),
                details: {
                    promoted_count: success,
                    skipped_blocked_count: skippedBlockedAtStart,
                    skipped_warning_count: skippedWarningAtStart,
                    failed_count: failed,
                    sample_errors: sampleFailures,
                    counts: {
                        total: itemCounts.total,
                        inserted,
                        updated,
                        success,
                        failed,
                        skipped,
                        pending: itemCounts.pending,
                        core_verified: coreVerified,
                        import_review_marked_promoted: markedPromoted,
                        verification_metadata_applied: verificationMetadataApplied,
                        verification_metadata_skipped_already_verified:
                            verificationMetadataSkippedAlreadyVerified,
                    },
                    derived_status: derived.derived_status,
                },
                stageStatus:
                    promotionStatus === "failed"
                        ? "failed"
                        : promotionStatus === "partial"
                          ? "warning"
                          : "success",
            }));
        } catch (err) {
            failureMessage = err instanceof Error ? err.message : "Promotion failed unexpectedly.";
            log?.error({ err, batchId: batchId.toString() }, "publish batch promotion failed");
            if (failureMessage !== "Promotion cancelled.") {
                await this.repo.failBatch(batchId, failureMessage);
            }
            activeStageKey = activeStageKey ?? PROMOTION_STAGE_FINAL;
            await this.repo.updateStageLog({
                batchId,
                stageKey: PROMOTION_STAGE_FINAL,
                stageStatus: "failed",
                message: failureMessage,
                progressPercent: 100,
                finished: true,
            });
        } finally {
            try {
                const batch = await this.repo.fetchBatchProgress(batchId);
                if (batch) {
                    const familyPromotedCounts: Record<string, number> = {};
                    for (const familyStage of stagePlan.familyStages) {
                        familyPromotedCounts[familyStage.entityFamily] =
                            countsByFamily[familyStage.entityFamily]?.success ?? 0;
                    }
                    await this.repo.reconcilePromotionStageLogs({
                        batchId,
                        stagePlan,
                        batchStatus: batch.status,
                        failedStageKey: failureMessage ? activeStageKey : null,
                        failureMessage,
                        promotionLogsSummary,
                        familyPromotedCounts,
                    });
                }
            } catch (reconcileErr) {
                log?.error(
                    { err: reconcileErr, batchId: batchId.toString() },
                    "publish batch promotion stage reconcile failed"
                );
            }
            runningPromoteBatchIds.delete(batchId);
        }
    }

    private async runStage(
        batchId: bigint,
        stagePlan: PromotionStagePlan,
        stageKey: ImportReviewPublishPromotionStageKey,
        fn: () => Promise<{
            message: string;
            details?: Record<string, unknown>;
            stageStatus?: string;
        }>
    ): Promise<boolean> {
        const stage = stageByKeyFromPlan(stagePlan, stageKey);
        const prev = previousStageFromPlan(stagePlan, stageKey);
        await this.repo.updateStageLog({
            batchId,
            stageKey,
            stageStatus: "running",
            message: `Running ${stage.label.toLowerCase()}…`,
            progressPercent: prev?.progressEnd ?? 0,
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
            if (message === "Promotion cancelled.") {
                await this.repo.finalizePromotionAborted({
                    batchId,
                    reason: "cancelled",
                    message,
                });
            } else {
                await this.repo.failBatch(batchId, message);
            }
            return false;
        }
    }
}
