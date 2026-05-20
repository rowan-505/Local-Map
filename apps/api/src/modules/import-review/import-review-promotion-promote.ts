import type { FastifyBaseLogger } from "fastify";

import {
    ImportReviewPublishBatchInvalidStatusError,
    ImportReviewPublishBatchNotFoundError,
    ImportReviewPublishBatchPromotionConflictError,
    ImportReviewPublishBatchPromotionConfirmationError,
} from "./import-review-promotion.errors.js";
import {
    DEFAULT_PROMOTE_CHUNK_SIZE,
    ImportReviewPromotionPromoteRepository,
    MAX_PROMOTE_CHUNK_SIZE,
} from "./import-review-promotion-promote.repo.js";
import {
    PROMOTABLE_PUBLISH_FAMILIES,
    type PromotablePublishEntityFamily,
} from "./import-review-promotion-config.js";
import {
    IMPORT_REVIEW_PUBLISH_PROMOTION_STAGES,
    type ImportReviewPublishBatchPromotionResult,
    type ImportReviewPublishPromotionStageKey,
} from "./import-review-promotion-promote.types.js";

const runningPromoteBatchIds = new Set<bigint>();

function stageByKey(key: ImportReviewPublishPromotionStageKey) {
    const stage = IMPORT_REVIEW_PUBLISH_PROMOTION_STAGES.find((s) => s.key === key);
    if (!stage) {
        throw new Error(`Unknown promotion stage: ${key}`);
    }
    return stage;
}

function progressBetween(prevEnd: number, nextEnd: number, done: number, total: number): number {
    if (total <= 0) {
        return nextEnd;
    }
    return prevEnd + (nextEnd - prevEnd) * Math.min(1, Math.max(0, done / total));
}

function parseValidationOutcome(summary: unknown): {
    outcome: string;
    blocked_count: number;
    can_promote: boolean;
    requires_warning_confirmation: boolean;
} | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const vr = (summary as Record<string, unknown>).validation_result;
    if (!vr || typeof vr !== "object" || Array.isArray(vr)) {
        return null;
    }
    const o = vr as Record<string, unknown>;
    return {
        outcome: typeof o.outcome === "string" ? o.outcome : "",
        blocked_count: typeof o.blocked_count === "number" ? o.blocked_count : 0,
        can_promote: o.can_promote !== false,
        requires_warning_confirmation: o.requires_warning_confirmation === true,
    };
}

export class ImportReviewPromotionPromoteRunner {
    constructor(private readonly repo: ImportReviewPromotionPromoteRepository) {}

    isRunning(batchId: bigint): boolean {
        return runningPromoteBatchIds.has(batchId);
    }

    async startPromotion(args: {
        batchId: bigint;
        confirmationText: string;
        confirmWarnings?: boolean;
        warningConfirmationNote?: string;
        chunkSize?: number;
        promotedBy: bigint | null;
        log?: FastifyBaseLogger;
    }): Promise<{ batch_id: string; status: string; message: string }> {
        if (args.confirmationText !== "PROMOTE") {
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

        const validation = parseValidationOutcome(before.summary);
        if (before.status !== "ready" || before.validation_percent !== 100 || !before.validated_at) {
            throw new ImportReviewPublishBatchInvalidStatusError(
                args.batchId.toString(),
                before.status,
                "Batch must be validated (status=ready, validation_percent=100) before promotion."
            );
        }
        if (!validation || validation.outcome !== "passed" || validation.blocked_count > 0) {
            throw new ImportReviewPublishBatchInvalidStatusError(
                args.batchId.toString(),
                before.status,
                "Batch validation must pass with no blocking errors before promotion."
            );
        }
        if (!validation.can_promote) {
            throw new ImportReviewPublishBatchInvalidStatusError(
                args.batchId.toString(),
                before.status,
                "Batch validation does not allow promotion (can_promote=false)."
            );
        }
        if (validation.requires_warning_confirmation) {
            if (args.confirmWarnings !== true) {
                throw new ImportReviewPublishBatchPromotionConfirmationError(
                    args.batchId.toString(),
                    "Validation warnings require confirmation and note before promotion."
                );
            }
            if (!args.warningConfirmationNote?.trim()) {
                throw new ImportReviewPublishBatchPromotionConfirmationError(
                    args.batchId.toString(),
                    "Validation warnings require confirmation and note before promotion."
                );
            }
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

        await this.repo.clearStageLogs(args.batchId);
        await this.repo.seedPromotionStageLogs(args.batchId);

        runningPromoteBatchIds.add(args.batchId);
        void this.runPromotion(args.batchId, chunkSize, args.promotedBy, args.log).catch((err) => {
            args.log?.error({ err, batchId: args.batchId.toString() }, "publish batch promotion crashed");
        });

        return {
            batch_id: args.batchId.toString(),
            status: "promoting",
            message: "Promotion started.",
        };
    }

    private async runPromotion(
        batchId: bigint,
        chunkSize: number,
        promotedBy: bigint | null,
        log?: FastifyBaseLogger
    ): Promise<void> {
        const startedAt = Date.now();
        let inserted = 0;
        let updated = 0;
        let success = 0;
        let failed = 0;
        let skipped = 0;
        let coreVerified = 0;
        let markedPromoted = 0;
        const promotedFamilies = new Set<PromotablePublishEntityFamily>();

        try {
            const preflightOk = await this.runStage(batchId, "promote_preflight", async () => {
                const batch = await this.repo.fetchBatchProgress(batchId);
                if (!batch) {
                    throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
                }
                const reserved = await this.repo.countReservedNonPromotableItems(batchId);
                const pendingByFamily = await this.repo.countPendingByEntityFamily(batchId);
                const total = await this.repo.countPendingPromotableItems(batchId);
                const familyNote = PROMOTABLE_PUBLISH_FAMILIES.map(
                    (f) => `${f}: ${pendingByFamily[f]}`
                ).join(", ");
                const note =
                    reserved > 0
                        ? ` ${reserved} non-promotable item(s) will remain reserved.`
                        : "";
                return {
                    message: `Preflight passed. ${total} pending item(s) ready to promote (${familyNote}).${note}`,
                    details: {
                        pending_items: total,
                        pending_by_entity_family: pendingByFamily,
                        reserved_non_promotable_items: reserved,
                    },
                };
            });
            if (!preflightOk) {
                return;
            }

            let items = await this.repo.listPromotableItems(batchId);
            const pendingIds = items.filter((i) => i.publish_status === "pending").map((i) => i.publish_item_id);

            const loadOk = await this.runStage(batchId, "load_promotable_items", async () => {
                const counts = await this.repo.countByPublishAction(batchId);
                await this.repo.updateBatchProgress({
                    batchId,
                    validationTotal: pendingIds.length,
                    validationDone: 0,
                    validationPercent: stageByKey("load_promotable_items").progressEnd,
                });
                return {
                    message: `Loaded ${pendingIds.length} pending item(s): ${counts.insert} insert, ${counts.update} update.`,
                    details: { total: pendingIds.length, ...counts },
                };
            });
            if (!loadOk) {
                return;
            }

            const finalValOk = await this.runStage(batchId, "final_validation_before_write", async () => {
                const errorCount = await this.repo.runFinalValidationBeforeWrite(pendingIds);
                if (errorCount > 0) {
                    throw new Error(
                        `Final validation found ${errorCount} blocking issue(s). Promotion aborted.`
                    );
                }
                return {
                    message: `Final validation passed for ${pendingIds.length} item(s).`,
                    details: { items: pendingIds.length },
                };
            });
            if (!finalValOk) {
                return;
            }

            const promoteStage = stageByKey("promote_buildings_to_core");
            const prevStage = stageByKey("final_validation_before_write");
            await this.repo.updateStageLog({
                batchId,
                stageKey: "promote_buildings_to_core",
                stageStatus: "running",
                message: "Promoting items to core…",
                progressPercent: prevStage.progressEnd,
            });

            const total = pendingIds.length;
            let done = 0;
            let currentEntityFamily: PromotablePublishEntityFamily | null = null;

            for (let i = 0; i < pendingIds.length; i += chunkSize) {
                const chunk = pendingIds.slice(i, i + chunkSize);
                for (const publishItemId of chunk) {
                    const itemRow = items.find((r) => r.publish_item_id === publishItemId);
                    currentEntityFamily = itemRow?.entity_family ?? null;

                    const result = await this.repo.promoteItem({
                        batchId,
                        publishItemId,
                        promotedBy,
                    });

                    if (result.outcome === "inserted" || result.outcome === "updated") {
                        if (result.target_id && itemRow) {
                            await this.repo.applyItemSuccess({
                                publishItemId,
                                targetId: result.target_id,
                                targetTable: itemRow.target_table,
                                beforeData: result.before_data,
                                afterData: result.after_data ?? { id: result.target_id.toString() },
                            });
                            await this.repo.markCandidatePromoted({
                                entityFamily: itemRow.entity_family,
                                reviewCandidateId: itemRow.review_candidate_id,
                                promotedCoreId: result.target_id,
                                promotedBy,
                            });
                            markedPromoted += 1;
                            promotedFamilies.add(itemRow.entity_family);
                            if (result.outcome === "inserted") {
                                inserted += 1;
                            } else {
                                updated += 1;
                            }
                            success += 1;
                        }
                    } else if (result.outcome === "skipped") {
                        if (result.target_id && itemRow) {
                            await this.repo.applyItemSuccess({
                                publishItemId,
                                targetId: result.target_id,
                                targetTable: itemRow.target_table,
                                beforeData: result.before_data,
                                afterData: result.after_data ?? { skipped: true },
                            });
                            skipped += 1;
                            success += 1;
                        }
                    } else {
                        await this.repo.applyItemFailure({
                            publishItemId,
                            errorMessage: result.error_message ?? "Promotion failed.",
                            afterData: result.after_data,
                        });
                        if (itemRow) {
                            await this.repo.markCandidateFailed(
                                itemRow.entity_family,
                                itemRow.review_candidate_id
                            );
                        }
                        failed += 1;
                    }
                }

                done += chunk.length;
                const percent = progressBetween(prevStage.progressEnd, promoteStage.progressEnd, done, total);
                await this.repo.updateBatchProgress({
                    batchId,
                    validationDone: Math.min(done, total),
                    validationPercent: Math.round(percent * 100) / 100,
                });
                await this.repo.updateStageLog({
                    batchId,
                    stageKey: "promote_buildings_to_core",
                    stageStatus: "running",
                    message: currentEntityFamily
                        ? `Promoting ${currentEntityFamily} to core…`
                        : "Promoting items to core…",
                    progressPercent: Math.round(percent * 100) / 100,
                    details: {
                        entity_family: currentEntityFamily,
                        done,
                        total,
                        inserted,
                        updated,
                        success,
                        failed,
                        skipped,
                    },
                });
            }

            await this.repo.updateStageLog({
                batchId,
                stageKey: "promote_buildings_to_core",
                stageStatus: failed > 0 && success === 0 ? "failed" : "success",
                message: `Promoted ${success} item(s) to core (${inserted} inserted, ${updated} updated).`,
                progressPercent: promoteStage.progressEnd,
                details: {
                    success,
                    failed,
                    skipped,
                    inserted,
                    updated,
                    promoted_entity_families: [...promotedFamilies],
                },
                finished: true,
            });

            await this.runStage(batchId, "write_publish_item_results", async () => ({
                message: `Publish item results written (${success} success, ${failed} failed).`,
                details: { success, failed, skipped },
            }));

            let verifyFailed = false;
            await this.runStage(batchId, "verify_core_rows", async () => {
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

            await this.runStage(batchId, "mark_import_review_promoted", async () => {
                const count = await this.repo.countMarkedPromoted(batchId);
                markedPromoted = count;
                return {
                    message: `Marked ${count} import_review candidate(s) as promoted.`,
                    details: { count },
                };
            });

            const finishedAt = Date.now();
            const durationMs = finishedAt - startedAt;
            const partialSuccess = success > 0 && failed > 0;
            let batchStatus = "promoted";
            let promotionStatus: ImportReviewPublishBatchPromotionResult["status"] = "promoted";
            let logsSummary = "Promotion completed successfully.";

            if (failed > 0 && success === 0) {
                batchStatus = "failed";
                promotionStatus = "failed";
                logsSummary = "Promotion failed.";
            } else if (verifyFailed || partialSuccess) {
                batchStatus = "failed";
                promotionStatus = "failed";
                logsSummary = partialSuccess
                    ? `Promotion completed with partial success. ${failed} item(s) failed.`
                    : "Promotion failed during core verification.";
            }

            const promotionResult: ImportReviewPublishBatchPromotionResult = {
                status: promotionStatus,
                inserted_count: inserted,
                updated_count: updated,
                success_count: success,
                failed_count: failed,
                skipped_count: skipped,
                total: total,
                core_verified_count: coreVerified,
                import_review_marked_promoted_count: markedPromoted,
                partial_success: partialSuccess || undefined,
                started_at: new Date(startedAt).toISOString(),
                finished_at: new Date(finishedAt).toISOString(),
                duration_ms: durationMs,
                promoted_entity_families: [...promotedFamilies],
            };

            await this.runStage(batchId, "update_batch_summary", async () => {
                await this.repo.finalizePromotionBatch({
                    batchId,
                    status: batchStatus,
                    successCount: success,
                    failedCount: failed,
                    skippedCount: skipped,
                    totalItemCount: total,
                    promotedBy,
                    summary: {
                        promotion_result: promotionResult,
                        promotion_logs_summary: logsSummary,
                        partial_success: partialSuccess,
                    },
                });
                return {
                    message: "Batch summary updated.",
                    details: promotionResult as unknown as Record<string, unknown>,
                };
            });

            await this.runStage(batchId, "promotion_final_response", async () => ({
                message: logsSummary,
                details: {
                    counts: {
                        total,
                        inserted,
                        updated,
                        success,
                        failed,
                        skipped,
                        core_verified: coreVerified,
                        import_review_marked_promoted: markedPromoted,
                    },
                },
                stageStatus: promotionStatus === "promoted" ? "success" : "failed",
            }));
        } catch (err) {
            const message = err instanceof Error ? err.message : "Promotion failed unexpectedly.";
            log?.error({ err, batchId: batchId.toString() }, "publish batch promotion failed");
            await this.repo.failBatch(batchId, message);
            await this.repo.updateStageLog({
                batchId,
                stageKey: "promotion_final_response",
                stageStatus: "failed",
                message,
                progressPercent: 100,
                finished: true,
            });
        } finally {
            runningPromoteBatchIds.delete(batchId);
        }
    }

    private async runStage(
        batchId: bigint,
        stageKey: ImportReviewPublishPromotionStageKey,
        fn: () => Promise<{
            message: string;
            details?: Record<string, unknown>;
            stageStatus?: string;
        }>
    ): Promise<boolean> {
        const stage = stageByKey(stageKey);
        const prev =
            IMPORT_REVIEW_PUBLISH_PROMOTION_STAGES[
                Math.max(0, IMPORT_REVIEW_PUBLISH_PROMOTION_STAGES.indexOf(stage) - 1)
            ];
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
            runningPromoteBatchIds.delete(batchId);
            return false;
        }
    }
}
