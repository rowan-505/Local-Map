import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import type { PublishItemEntityRow } from "./import-review-promotion-validation.repo.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import { ImportReviewPromotionValidationRunner } from "./import-review-promotion-validation.js";

describe("ImportReviewPromotionValidationRunner progress on failure", () => {
    it("marks batch failed and candidate-state stage failed when validatePublishBatch throws", async () => {
        const batchId = 17n;
        const itemRows: PublishItemEntityRow[] = [
            { id: 1n, entity_family: "buildings" },
            { id: 2n, entity_family: "buildings" },
        ];

        const failBatchCalls: { batchId: bigint; message: string }[] = [];
        const stageLogUpdates: { stageKey: string; stageStatus: string; finished?: boolean }[] = [];
        const heartbeatCalls: { validationDone: number }[] = [];

        const repo = {
            prisma: {} as PrismaClient,
            isValidationCancelRequested: async () => false,
            touchValidationHeartbeat: async () => {},
            updateStageLog: async (args: {
                stageKey: string;
                stageStatus: string;
                finished?: boolean;
            }) => {
                stageLogUpdates.push({
                    stageKey: args.stageKey,
                    stageStatus: args.stageStatus,
                    finished: args.finished,
                });
            },
            updateValidationHeartbeat: async (args: { validationDone: number }) => {
                heartbeatCalls.push({ validationDone: args.validationDone });
            },
            updateBatchProgress: async () => {},
            fetchBatchProgress: async () => ({
                id: batchId,
                status: "validating",
                validation_total: 2,
                validation_done: 1,
                validation_percent: 20,
                validated_at: null,
                summary: {},
            }),
            failRunningValidationStages: async () => {},
            skipPendingValidationStages: async () => {},
            failBatch: async (id: bigint, message: string) => {
                failBatchCalls.push({ batchId: id, message });
            },
        } as unknown as ImportReviewPromotionValidationRepository;

        const runner = new ImportReviewPromotionValidationRunner(repo);
        const batchValidation = {
            validatePublishBatch: async () => {
                throw new Error("simulated validation failure");
            },
        };
        (runner as unknown as { simpleBatchValidation: typeof batchValidation }).simpleBatchValidation =
            batchValidation;

        const ok = await (
            runner as unknown as {
                runSimplePublishItemValidation: (args: {
                    batchId: bigint;
                    itemRows: PublishItemEntityRow[];
                    itemState: Map<string, unknown>;
                    progressTotal: number;
                }) => Promise<boolean>;
            }
        ).runSimplePublishItemValidation({
            batchId,
            itemRows,
            itemState: new Map(),
            progressTotal: 2,
        });

        assert.equal(ok, false);
        assert.equal(failBatchCalls.length, 1);
        assert.equal(failBatchCalls[0]?.batchId, batchId);
        assert.match(failBatchCalls[0]?.message ?? "", /simulated validation failure/);

        const failedStage = stageLogUpdates.find(
            (u) => u.stageKey === "validate_candidate_state" && u.stageStatus === "failed"
        );
        assert.ok(failedStage);
        assert.equal(failedStage?.finished, true);
    });
});

describe("ImportReviewPromotionValidationRunner progress heartbeat", () => {
    it("writes validation_done via updateValidationHeartbeat during validatePublishBatch", async () => {
        const batchId = 17n;
        const heartbeatCalls: { validationDone: number; validationTotal: number; chunkIndex?: number }[] =
            [];

        const repo = {
            prisma: {} as PrismaClient,
            updateStageLog: async () => {},
            persistItemValidationResults: async () => {},
            updateValidationHeartbeat: async (args: {
                validationDone: number;
                validationTotal: number;
                stageLogDetails: Record<string, unknown>;
            }) => {
                heartbeatCalls.push({
                    validationDone: args.validationDone,
                    validationTotal: args.validationTotal,
                    chunkIndex:
                        typeof args.stageLogDetails.chunk_index === "number"
                            ? args.stageLogDetails.chunk_index
                            : undefined,
                });
            },
            updateBatchProgress: async () => {},
            fetchBatchProgress: async () => null,
            failBatch: async () => {},
        } as unknown as ImportReviewPromotionValidationRepository;

        const runner = new ImportReviewPromotionValidationRunner(repo);

        await (
            runner as unknown as {
                handleValidatePublishBatchProgress: (args: {
                    event: {
                        batchId: bigint;
                        done: number;
                        total: number;
                        family: string;
                        candidateId: bigint;
                        stageKey: "validate_candidate_state";
                        message: string;
                        elapsedMs: number;
                    };
                    progressTotal: number;
                    stageProgressStart: number;
                    stageProgressEnd: number;
                    chunk?: { chunkIndex?: number; chunkSize?: number };
                }) => Promise<void>;
            }
        ).handleValidatePublishBatchProgress({
            event: {
                batchId,
                done: 25,
                total: 100,
                family: "buildings",
                candidateId: 42n,
                stageKey: "validate_candidate_state",
                message: "Validated 25 / 100 publish items (buildings)…",
                elapsedMs: 5000,
            },
            progressTotal: 100,
            stageProgressStart: 15,
            stageProgressEnd: 30,
            chunk: { chunkIndex: 2, chunkSize: 25 },
        });

        assert.equal(heartbeatCalls.length, 1);
        assert.equal(heartbeatCalls[0]?.validationDone, 25);
        assert.equal(heartbeatCalls[0]?.validationTotal, 100);
        assert.equal(heartbeatCalls[0]?.chunkIndex, 2);
    });
});
