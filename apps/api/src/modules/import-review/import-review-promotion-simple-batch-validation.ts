/**
 * Runs simple typed-column validation for every publish item in a batch (chunked by family).
 */

import type { PrismaClient } from "@prisma/client";

import { isValidatablePublishFamily } from "./import-review-promotion-config.js";
import {
    buildPublishItemValidationResultJson,
    type PublishItemValidationStatus,
} from "./import-review-promotion-publish-item-validation.js";
import {
    ImportReviewSimplePromotionValidationRepository,
    validateSimplePromotionCandidateRow,
    type SimplePromotionCandidateValidationRow,
    type SimplePromotionValidationResult,
} from "./import-review-promotion-simple-validation.js";
import {
    getPromotionFamilyConfig,
    isImportReviewSimplePromotionFamily,
    type ImportReviewSimplePromotionFamilyConfig,
} from "./import-review-promotion-simple-config.js";
import { planFamilyValidationChunks } from "./import-review-promotion-validation-chunks.js";
import {
    IMPORT_REVIEW_VALIDATION_HEARTBEAT_INTERVAL_MS,
    ImportReviewPublishBatchValidationAbortedError,
} from "./import-review-promotion-validation-control.js";
import {
    buildValidatePublishBatchProgressMessage,
    shouldReportValidatePublishBatchProgress,
    type ValidatePublishBatchProgressCallback,
} from "./import-review-promotion-validation-progress.js";

export type { ValidatePublishBatchProgressCallback, ValidatePublishBatchProgressEvent } from "./import-review-promotion-validation-progress.js";

export type ValidatePublishBatchChunkCompleteEvent = {
    batchId: bigint;
    family: string;
    chunkIndex: number;
    chunkSize: number;
    done: number;
    total: number;
    outcomes: PublishItemSimpleValidationOutcome[];
    elapsedMs: number;
    lastCandidateId: bigint;
};

export type ValidatePublishBatchChunkCompleteCallback = (
    event: ValidatePublishBatchChunkCompleteEvent
) => void | Promise<void>;

export type ValidateTargetsChunkContext = {
    publishBatchId: bigint;
    doneBefore: number;
    total: number;
    startedAt: number;
    chunkIndex?: number;
    chunkSize?: number;
    onProgress?: ValidatePublishBatchProgressCallback;
    shouldAbort?: () => Promise<boolean>;
};

export type ValidatePublishBatchOptions = {
    onProgress?: ValidatePublishBatchProgressCallback;
    onChunkComplete?: ValidatePublishBatchChunkCompleteCallback;
    /** When true, stop before the next chunk (current chunk already finished). */
    shouldAbort?: () => Promise<boolean>;
};

export type PublishItemValidationTarget = {
    publish_item_id: bigint;
    entity_family: string;
    review_candidate_id: bigint;
    review_batch_id: bigint;
};

export type PublishItemSimpleValidationOutcome = {
    publish_item_id: bigint;
    entity_family: string;
    status: PublishItemValidationStatus;
    result: SimplePromotionValidationResult;
    skipped: boolean;
};

export function outcomeStatusFromResult(
    result: SimplePromotionValidationResult,
    skipped: boolean
): PublishItemValidationStatus {
    if (skipped) {
        return "skipped";
    }
    return result.status === "ready" ? "ready" : result.status === "warning" ? "warning" : "blocked";
}

export function buildChunkValidationErrorOutcome(
    target: PublishItemValidationTarget,
    message: string
): PublishItemSimpleValidationOutcome {
    return {
        publish_item_id: target.publish_item_id,
        entity_family: target.entity_family,
        status: "blocked",
        skipped: false,
        result: {
            status: "blocked",
            errors: [
                {
                    code: "validation_chunk_failed",
                    message,
                },
            ],
            warnings: [],
        },
    };
}

export class ImportReviewPromotionSimpleBatchValidation {
    readonly simpleRepo: ImportReviewSimplePromotionValidationRepository;

    constructor(private readonly prisma: PrismaClient) {
        this.simpleRepo = new ImportReviewSimplePromotionValidationRepository(prisma);
    }

    async fetchReviewBatchIdForPublishBatch(publishBatchId: bigint): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ source_review_batch_id: bigint | null }[]>`
            SELECT source_review_batch_id
            FROM system.system_publish_batches
            WHERE id = ${publishBatchId}
            LIMIT 1
        `;
        return rows[0]?.source_review_batch_id ?? null;
    }

    async listPublishItemTargets(publishBatchId: bigint): Promise<PublishItemValidationTarget[]> {
        const rows = await this.prisma.$queryRaw<
            {
                publish_item_id: bigint;
                entity_family: string;
                review_candidate_id: bigint | null;
            }[]
        >`
            SELECT
                id AS publish_item_id,
                entity_family,
                review_candidate_id
            FROM system.system_publish_items
            WHERE publish_batch_id = ${publishBatchId}
            ORDER BY entity_family ASC, id ASC
        `;
        const reviewBatchId = await this.fetchReviewBatchIdForPublishBatch(publishBatchId);
        if (reviewBatchId === null) {
            return [];
        }
        return rows
            .filter((r) => r.review_candidate_id !== null)
            .map((r) => ({
                publish_item_id: r.publish_item_id,
                entity_family: r.entity_family,
                review_candidate_id: r.review_candidate_id!,
                review_batch_id: reviewBatchId,
            }));
    }

    outcomeForUnsupportedTarget(target: PublishItemValidationTarget): PublishItemSimpleValidationOutcome {
        if (!isValidatablePublishFamily(target.entity_family)) {
            return {
                publish_item_id: target.publish_item_id,
                entity_family: target.entity_family,
                status: "skipped",
                skipped: true,
                result: {
                    status: "warning",
                    errors: [],
                    warnings: [
                        {
                            code: "validation_not_supported_for_family",
                            message: `Entity family ${target.entity_family} is not supported for publish validation yet.`,
                        },
                    ],
                },
            };
        }

        if (!isImportReviewSimplePromotionFamily(target.entity_family)) {
            return {
                publish_item_id: target.publish_item_id,
                entity_family: target.entity_family,
                status: "skipped",
                skipped: true,
                result: {
                    status: "blocked",
                    errors: [
                        {
                            code: "unknown_family",
                            message: `No simple validation config for ${target.entity_family}.`,
                        },
                    ],
                    warnings: [],
                },
            };
        }

        return {
            publish_item_id: target.publish_item_id,
            entity_family: target.entity_family,
            status: "blocked",
            skipped: false,
            result: {
                status: "blocked",
                errors: [{ code: "unknown_family", message: "Missing promotion config." }],
                warnings: [],
            },
        };
    }

    outcomeForLoadedRow(
        target: PublishItemValidationTarget,
        config: ImportReviewSimplePromotionFamilyConfig,
        row: SimplePromotionCandidateValidationRow,
        fkExistsByColumn: Record<string, boolean>,
        nearbyCoreRoads: number | null
    ): PublishItemSimpleValidationOutcome {
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn,
            nearbyCoreRoads,
        });
        const status = outcomeStatusFromResult(result, false);
        return {
            publish_item_id: target.publish_item_id,
            entity_family: target.entity_family,
            status,
            skipped: false,
            result,
        };
    }

    async validatePublishItem(
        target: PublishItemValidationTarget
    ): Promise<PublishItemSimpleValidationOutcome> {
        const outcomes = await this.validateTargetsChunk([target], target.entity_family);
        const outcome = outcomes[0];
        if (!outcome) {
            return buildChunkValidationErrorOutcome(target, "Validation produced no outcome.");
        }
        return outcome;
    }

    async validateTargetsChunk(
        targets: readonly PublishItemValidationTarget[],
        family: string,
        ctx?: ValidateTargetsChunkContext
    ): Promise<PublishItemSimpleValidationOutcome[]> {
        const outcomes: PublishItemSimpleValidationOutcome[] = [];

        if (!isImportReviewSimplePromotionFamily(family)) {
            for (const target of targets) {
                outcomes.push(this.outcomeForUnsupportedTarget(target));
            }
            return outcomes;
        }

        const config = getPromotionFamilyConfig(family);
        if (!config) {
            for (const target of targets) {
                outcomes.push(this.outcomeForUnsupportedTarget(target));
            }
            return outcomes;
        }

        const reviewBatchId = targets[0]?.review_batch_id;
        if (reviewBatchId === undefined) {
            return [];
        }

        const simpleTargets = targets.filter((t) => isValidatablePublishFamily(t.entity_family));
        const skippedTargets = targets.filter((t) => !isValidatablePublishFamily(t.entity_family));
        for (const target of skippedTargets) {
            outcomes.push(this.outcomeForUnsupportedTarget(target));
        }

        if (simpleTargets.length === 0) {
            return outcomes;
        }

        const candidateIds = simpleTargets.map((t) => t.review_candidate_id);
        const rowByCandidateId = await this.simpleRepo.loadCandidateRowsBatch(
            config,
            candidateIds,
            reviewBatchId
        );
        const loadedRows = [...rowByCandidateId.values()];
        const fkByRowId = await this.simpleRepo.resolveFkExistenceBatch(config, loadedRows);

        let lastHeartbeatMs = Date.now();
        let processedInChunk = 0;

        for (const target of simpleTargets) {
            processedInChunk += 1;
            const doneNow = (ctx?.doneBefore ?? 0) + processedInChunk;
            const total = ctx?.total ?? simpleTargets.length;
            const nowMs = Date.now();
            const intervalElapsed = nowMs - lastHeartbeatMs >= IMPORT_REVIEW_VALIDATION_HEARTBEAT_INTERVAL_MS;
            const itemCheckpoint =
                shouldReportValidatePublishBatchProgress(processedInChunk, simpleTargets.length) ||
                processedInChunk === simpleTargets.length;

            if (ctx?.shouldAbort && (itemCheckpoint || intervalElapsed) && (await ctx.shouldAbort())) {
                throw new ImportReviewPublishBatchValidationAbortedError(
                    (ctx.publishBatchId ?? 0n).toString(),
                    "cancelled",
                    "Validation cancelled."
                );
            }

            if (
                ctx?.onProgress &&
                ctx.publishBatchId &&
                (intervalElapsed || itemCheckpoint)
            ) {
                lastHeartbeatMs = nowMs;
                await ctx.onProgress({
                    batchId: ctx.publishBatchId,
                    done: doneNow,
                    total,
                    family,
                    candidateId: target.review_candidate_id,
                    stageKey: "validate_candidate_state",
                    message: buildValidatePublishBatchProgressMessage({
                        done: doneNow,
                        total,
                        family,
                    }),
                    elapsedMs: nowMs - (ctx.startedAt ?? nowMs),
                });
            }

            const row = rowByCandidateId.get(target.review_candidate_id.toString());
            if (!row) {
                outcomes.push({
                    publish_item_id: target.publish_item_id,
                    entity_family: target.entity_family,
                    status: "blocked",
                    skipped: false,
                    result: {
                        status: "blocked",
                        errors: [
                            {
                                code: "missing_candidate",
                                message: "Candidate was not found in the specified review batch.",
                                field: "id",
                            },
                        ],
                        warnings: [],
                    },
                });
                continue;
            }

            let nearbyCoreRoads: number | null = null;
            if (config.family === "routing_barriers" && row.geomDiagnostics?.present) {
                nearbyCoreRoads = await this.simpleRepo.countNearbyCoreRoadsForBarrier(row);
            }

            const fkExistsByColumn = fkByRowId.get(row.id.toString()) ?? {};
            outcomes.push(
                this.outcomeForLoadedRow(target, config, row, fkExistsByColumn, nearbyCoreRoads)
            );
        }

        return outcomes;
    }

    async validatePublishBatch(
        publishBatchId: bigint,
        options?: ValidatePublishBatchOptions
    ): Promise<PublishItemSimpleValidationOutcome[]> {
        const targets = await this.listPublishItemTargets(publishBatchId);
        const total = targets.length;
        const startedAt = Date.now();
        const allOutcomes: PublishItemSimpleValidationOutcome[] = [];
        let done = 0;

        const chunkPlans = planFamilyValidationChunks(targets);

        for (const plan of chunkPlans) {
            if (options?.shouldAbort && (await options.shouldAbort())) {
                throw new ImportReviewPublishBatchValidationAbortedError(
                    publishBatchId.toString(),
                    "cancelled",
                    "Validation cancelled."
                );
            }

            let chunkOutcomes: PublishItemSimpleValidationOutcome[];
            try {
                chunkOutcomes = await this.validateTargetsChunk(plan.targets, plan.family, {
                    publishBatchId,
                    doneBefore: done,
                    total,
                    startedAt,
                    chunkIndex: plan.chunkIndex,
                    chunkSize: plan.chunkSize,
                    onProgress: options?.onProgress,
                    shouldAbort: options?.shouldAbort,
                });
            } catch (err) {
                if (err instanceof ImportReviewPublishBatchValidationAbortedError) {
                    throw err;
                }
                const message =
                    err instanceof Error ? err.message : "Validation chunk failed unexpectedly.";
                chunkOutcomes = plan.targets.map((target) =>
                    buildChunkValidationErrorOutcome(
                        target,
                        `Validation chunk failed (${plan.family} chunk ${plan.chunkIndex}): ${message}`
                    )
                );
                if (options?.onChunkComplete) {
                    done += chunkOutcomes.length;
                    const lastTarget = plan.targets[plan.targets.length - 1]!;
                    await options.onChunkComplete({
                        batchId: publishBatchId,
                        family: plan.family,
                        chunkIndex: plan.chunkIndex,
                        chunkSize: plan.chunkSize,
                        done,
                        total,
                        outcomes: chunkOutcomes,
                        elapsedMs: Date.now() - startedAt,
                        lastCandidateId: lastTarget.review_candidate_id,
                    });
                }
                throw err;
            }

            allOutcomes.push(...chunkOutcomes);
            done += chunkOutcomes.length;

            const lastTarget = plan.targets[plan.targets.length - 1]!;
            const elapsedMs = Date.now() - startedAt;

            if (options?.onChunkComplete) {
                await options.onChunkComplete({
                    batchId: publishBatchId,
                    family: plan.family,
                    chunkIndex: plan.chunkIndex,
                    chunkSize: plan.chunkSize,
                    done,
                    total,
                    outcomes: chunkOutcomes,
                    elapsedMs,
                    lastCandidateId: lastTarget.review_candidate_id,
                });
            }

            if (options?.shouldAbort && (await options.shouldAbort())) {
                throw new ImportReviewPublishBatchValidationAbortedError(
                    publishBatchId.toString(),
                    "cancelled",
                    "Validation cancelled."
                );
            }

            if (!options?.onChunkComplete && options?.onProgress) {
                await options.onProgress({
                    batchId: publishBatchId,
                    done,
                    total,
                    family: plan.family,
                    candidateId: lastTarget.review_candidate_id,
                    stageKey: "validate_candidate_state",
                    message: buildValidatePublishBatchProgressMessage({
                        done,
                        total,
                        family: plan.family,
                    }),
                    elapsedMs,
                });
            }
        }

        return allOutcomes;
    }

    toPersistedValidationJson(outcome: PublishItemSimpleValidationOutcome): Record<string, unknown> {
        if (outcome.skipped) {
            return buildPublishItemValidationResultJson({
                status: "warning",
                errors: [],
                warnings: outcome.result.warnings,
            }) as unknown as Record<string, unknown>;
        }
        return buildPublishItemValidationResultJson({
            status: outcome.result.status,
            errors: outcome.result.errors,
            warnings: outcome.result.warnings,
        }) as unknown as Record<string, unknown>;
    }
}
