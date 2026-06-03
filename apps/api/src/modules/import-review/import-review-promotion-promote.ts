import type { FastifyBaseLogger } from "fastify";

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
import { assertPublishBatchHasNoDeprecatedCoreBusItems } from "./import-review-transport-promotion-deprecated.js";
import {
    IMPORT_REVIEW_ADMIN_AREA_PROMOTION_MAX_ITEMS,
    IMPORT_REVIEW_ROAD_PROMOTION_MAX_ITEMS,
    IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION_MAX_ITEMS,
    isImportReviewAdminAreaBulkPromotionEnabled,
    isImportReviewRoadBulkPromotionEnabled,
    isImportReviewRoadPromotionEnabled,
    isImportReviewRoutingBarrierBulkPromotionEnabled,
    isImportReviewRoutingBarrierPromotionEnabled,
} from "./import-review-config.js";
import {
    DEFAULT_PROMOTE_CHUNK_SIZE,
    ImportReviewPromotionPromoteRepository,
    MAX_PROMOTE_CHUNK_SIZE,
    promoteAndCommitImportReviewItem,
} from "./import-review-promotion-promote.repo.js";
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
    type ImportReviewPublishBatchPromotionResult,
    type ImportReviewPublishPromotionStageKey,
} from "./import-review-promotion-promote.types.js";

const runningPromoteBatchIds = new Set<bigint>();

function progressBetween(prevEnd: number, nextEnd: number, done: number, total: number): number {
    if (total <= 0) {
        return nextEnd;
    }
    return prevEnd + (nextEnd - prevEnd) * Math.min(1, Math.max(0, done / total));
}

export class ImportReviewPromotionPromoteRunner {
    constructor(private readonly repo: ImportReviewPromotionPromoteRepository) {}

    isRunning(batchId: bigint): boolean {
        return runningPromoteBatchIds.has(batchId);
    }

    async startPromotion(args: {
        batchId: bigint;
        confirmationText?: string;
        confirmWarnings?: boolean;
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

        await assertPublishBatchHasNoDeprecatedCoreBusItems(this.repo.getPrisma(), args.batchId);

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
                batch: before,
                validation,
            })
        ) {
            throw new ImportReviewPublishBatchInvalidStatusError(
                args.batchId.toString(),
                before.status,
                before.validation_percent === 100
                    ? validation.promotable_count > 0
                        ? "Batch validation outcome does not allow promotion (no promotable items or validation incomplete)."
                        : "Batch has no promotable items; resolve blockers or re-validate."
                    : "Batch must complete validation (validation_percent=100) before promotion."
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
        if (roadItemCount > 0 && !isImportReviewRoadPromotionEnabled()) {
            throw new ImportReviewRoadPromotionDisabledError(args.batchId.toString());
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

        const claim = await this.repo.claimBatchForPromotion(args.batchId);
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

        await this.repo.clearStageLogs(args.batchId);
        await this.repo.seedPromotionStageLogs(args.batchId, stagePlan.stages);

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

    private async runPromotion(args: {
        batchId: bigint;
        chunkSize: number;
        promotedBy: bigint | null;
        confirmWarnings: boolean;
        promotionNote?: string;
        stagePlan: PromotionStagePlan;
        log?: FastifyBaseLogger;
    }): Promise<void> {
        const { batchId, chunkSize, promotedBy, confirmWarnings, promotionNote, stagePlan, log } = args;
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
                const batch = await this.repo.fetchBatchProgress(batchId);
                if (!batch) {
                    throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
                }
                const reserved = await this.repo.countReservedNonPromotableItems(batchId);
                const pendingByFamily = await this.repo.countPendingByEntityFamily(batchId);
                const promotableTotal = pendingIds.length;
                const familyNote = stagePlan.familyStages
                    .map((s) => `${s.entityFamily}: ${pendingByFamily[s.entityFamily] ?? 0}`)
                    .join(", ");
                const note =
                    reserved > 0
                        ? ` ${reserved} non-promotable item(s) will remain reserved.`
                        : "";
                const skipNote =
                    promotionSelection.skipped_blocked_count > 0 ||
                    promotionSelection.skipped_warning_count > 0
                        ? ` Skipping ${promotionSelection.skipped_blocked_count} blocked and ${promotionSelection.skipped_warning_count} warning item(s).`
                        : "";
                let finalValidationNote = "";
                if (pendingIds.length > 0) {
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
                const counts = await this.repo.countByPublishAction(batchId);
                await this.repo.updateBatchProgress({
                    batchId,
                    validationTotal: pendingIds.length,
                    validationDone: 0,
                    validationPercent: stageByKeyFromPlan(stagePlan, PROMOTION_STAGE_PREFLIGHT).progressEnd,
                });
                return {
                    message: `Preflight passed. ${promotableTotal} item(s) to promote (${familyNote}).${skipNote}${note}${finalValidationNote} Loaded ${pendingIds.length} pending item(s): ${counts.insert} insert, ${counts.update} update.`,
                    details: {
                        promotable_items: promotableTotal,
                        skipped_blocked_count: promotionSelection.skipped_blocked_count,
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

            for (const familyStage of stagePlan.familyStages) {
                activeStageKey = familyStage.key as ImportReviewPublishPromotionStageKey;
                const familyPendingIds = pendingIds.filter((id) => {
                    const row = items.find((r) => r.publish_item_id === id);
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

                let familyDone = 0;
                let familySuccess = 0;
                let familyFailed = 0;
                for (let i = 0; i < familyPendingIds.length; i += chunkSize) {
                    const chunk = familyPendingIds.slice(i, i + chunkSize);
                    for (const publishItemId of chunk) {
                        const itemRow = items.find((r) => r.publish_item_id === publishItemId);

                        const result = await promoteAndCommitImportReviewItem(
                            this.repo.getPrisma(),
                            {
                                batchId,
                                publishItemId,
                                promotedBy,
                                confirmWarnings,
                                promotionNote,
                            }
                        );

                        if (result.outcome === "inserted" || result.outcome === "updated") {
                            if (itemRow && result.target_id != null) {
                                if (result.verification_metadata_applied) {
                                    verificationMetadataApplied += 1;
                                }
                                if (result.verification_metadata_skipped_already_verified) {
                                    verificationMetadataSkippedAlreadyVerified += 1;
                                }
                                markedPromoted += 1;
                                promotedFamilies.add(itemRow.entity_family);
                                if (result.outcome === "inserted") {
                                    inserted += 1;
                                    if (familyCounts) {
                                        familyCounts.inserted += 1;
                                    }
                                } else {
                                    updated += 1;
                                    if (familyCounts) {
                                        familyCounts.updated += 1;
                                    }
                                }
                                success += 1;
                                familySuccess += 1;
                                if (familyCounts) {
                                    familyCounts.success += 1;
                                }
                            }
                        } else if (result.outcome === "skipped") {
                            if (itemRow && result.target_id != null) {
                                skipped += 1;
                                success += 1;
                                familySuccess += 1;
                                if (familyCounts) {
                                    familyCounts.skipped += 1;
                                    familyCounts.success += 1;
                                }
                            }
                        } else {
                            failed += 1;
                            familyFailed += 1;
                            if (familyCounts) {
                                familyCounts.failed += 1;
                            }
                        }
                    }

                    familyDone += chunk.length;
                    globalDone += chunk.length;
                    const percent = progressBetween(
                        prevStage?.progressEnd ?? 0,
                        promoteStage.progressEnd,
                        familyDone,
                        familyPendingIds.length
                    );
                    await this.repo.updateBatchProgress({
                        batchId,
                        validationDone: Math.min(globalDone, total),
                        validationPercent: Math.round(percent * 100) / 100,
                    });
                    await this.repo.updateStageLog({
                        batchId,
                        stageKey: familyStage.key as ImportReviewPublishPromotionStageKey,
                        stageStatus: "running",
                        message: `Promoting ${familyStage.entityFamily} to core…`,
                        progressPercent: Math.round(percent * 100) / 100,
                        details: {
                            entity_family: familyStage.entityFamily,
                            done: familyDone,
                            total: familyPendingIds.length,
                            inserted,
                            updated,
                            success,
                            failed,
                            skipped,
                        },
                    });
                }

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
                        : promotionStatus === "partially_promoted"
                          ? "warning"
                          : "success",
            }));
        } catch (err) {
            failureMessage = err instanceof Error ? err.message : "Promotion failed unexpectedly.";
            log?.error({ err, batchId: batchId.toString() }, "publish batch promotion failed");
            await this.repo.failBatch(batchId, failureMessage);
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
            await this.repo.failBatch(batchId, message);
            return false;
        }
    }
}
