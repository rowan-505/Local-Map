import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import {
    heartbeatAnchorAt,
    ImportReviewPublishBatchValidationAbortedError,
    isValidationHeartbeatStale,
    isValidationHeartbeatStalled,
} from "./import-review-promotion-validation-control.js";
import type { PublishItemEntityRow } from "./import-review-promotion-validation.repo.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import { ImportReviewPromotionValidationRunner } from "./import-review-promotion-validation.js";
import {
    ImportReviewPublishBatchValidationNotRunningError,
    ImportReviewPublishBatchValidationResetError,
} from "./import-review-promotion.errors.js";
import {
    ImportReviewPromotionSimpleBatchValidation,
    type PublishItemSimpleValidationOutcome,
} from "./import-review-promotion-simple-batch-validation.js";

describe("import-review-promotion-validation-control helpers", () => {
    it("detects stale and stalled heartbeats", () => {
        const now = Date.now();
        const fresh = new Date(now - 60_000);
        const stale = new Date(now - 11 * 60_000);
        assert.equal(isValidationHeartbeatStalled(fresh, now), false);
        assert.equal(isValidationHeartbeatStalled(stale, now), true);
        assert.equal(isValidationHeartbeatStale(fresh, now), false);
        assert.equal(isValidationHeartbeatStale(stale, now), true);
        assert.equal(isValidationHeartbeatStale(null, now), true);
    });

    it("prefers batch validation_heartbeat_at over stage log", () => {
        const batchAt = new Date("2026-06-02T10:00:00Z");
        assert.equal(
            heartbeatAnchorAt({ validation_heartbeat_at: batchAt, validation_cancel_requested_at: null }, "2026-06-02T09:00:00Z")?.toISOString(),
            batchAt.toISOString()
        );
    });
});

describe("ImportReviewPromotionValidationRunner cancel and reset", () => {
    it("cancel request stops after current chunk via shouldAbort", async () => {
        const batchId = 17n;
        let cancelRequested = false;
        const chunkCompletions: number[] = [];

        const repo = {
            prisma: {} as PrismaClient,
            updateStageLog: async () => {},
            updateValidationHeartbeat: async () => {},
            updateBatchProgress: async () => {},
            persistItemValidationResults: async () => {},
            isValidationCancelRequested: async () => cancelRequested,
            finishValidationCancelled: async () => {},
            fetchBatchProgress: async () => ({
                id: batchId,
                status: "validating",
                validation_total: 4,
                validation_done: 2,
                validation_percent: 20,
                validated_at: null,
                validation_heartbeat_at: new Date(),
                validation_cancel_requested_at: cancelRequested ? new Date() : null,
                promoted_at: null,
                summary: {},
            }),
            failBatch: async () => {},
        } as unknown as ImportReviewPromotionValidationRepository;

        const runner = new ImportReviewPromotionValidationRunner(repo);
        const batchValidation = new ImportReviewPromotionSimpleBatchValidation({} as PrismaClient);
        batchValidation.listPublishItemTargets = async () =>
            Array.from({ length: 4 }, (_, i) => ({
                publish_item_id: BigInt(i + 1),
                entity_family: "buildings",
                review_candidate_id: BigInt(1000 + i),
                review_batch_id: 2n,
            }));
        batchValidation.validateTargetsChunk = async (targets) =>
            targets.map(
                (t): PublishItemSimpleValidationOutcome => ({
                    publish_item_id: t.publish_item_id,
                    entity_family: t.entity_family,
                    status: "ready",
                    skipped: false,
                    result: { status: "ready", errors: [], warnings: [] },
                })
            );

        (runner as unknown as { simpleBatchValidation: typeof batchValidation }).simpleBatchValidation =
            batchValidation;

        const itemRows: PublishItemEntityRow[] = Array.from({ length: 4 }, (_, i) => ({
            id: BigInt(i + 1),
            entity_family: "buildings",
        }));

        let finishCancelled = false;
        (repo as unknown as { finalizeValidationAborted: () => Promise<void> }).finalizeValidationAborted =
            async () => {
                finishCancelled = true;
            };

        const runPromise = (
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
            progressTotal: 4,
        });

        cancelRequested = true;
        const ok = await runPromise;

        assert.equal(ok, false);
        assert.equal(finishCancelled, true);
    });

    it("reset clears validation_result via repository", async () => {
        const batchId = 99n;
        const cleared: { batchId: bigint }[] = [];

        const repo = {
            prisma: {} as PrismaClient,
            fetchBatchProgress: async () => ({
                id: batchId,
                status: "failed",
                validation_total: 10,
                validation_done: 10,
                validation_percent: 100,
                validated_at: new Date(),
                validation_heartbeat_at: null,
                validation_cancel_requested_at: null,
                promoted_at: null,
                summary: { validation_outcome: "cancelled" },
            }),
            resetValidationState: async (id: bigint) => {
                cleared.push({ batchId: id });
            },
        } as unknown as ImportReviewPromotionValidationRepository;

        const runner = new ImportReviewPromotionValidationRunner(repo);
        const result = await runner.resetValidation(batchId);
        assert.equal(cleared.length, 1);
        assert.equal(cleared[0]?.batchId, batchId);
        assert.equal(result.status, "draft");
    });

    it("stale validating batch can be reset after failStale", async () => {
        const batchId = 17n;
        const staleHeartbeat = new Date(Date.now() - 20 * 60_000);
        let status = "validating";
        const repo = {
            prisma: {} as PrismaClient,
            fetchBatchProgress: async () => ({
                id: batchId,
                status,
                validation_total: 5,
                validation_done: 1,
                validation_percent: 10,
                validated_at: null,
                validation_heartbeat_at: staleHeartbeat,
                validation_cancel_requested_at: null,
                promoted_at: null,
                summary: {},
            }),
            listStageLogs: async () => [],
            finalizeValidationAborted: async () => {
                status = "failed";
            },
            resetValidationState: async () => {
                status = "draft";
            },
        } as unknown as ImportReviewPromotionValidationRepository;

        const runner = new ImportReviewPromotionValidationRunner(repo);
        await runner.resetValidation(batchId);
        assert.equal(status, "draft");
    });

    it("allows reset when promoted_at is set but no items were promoted", async () => {
        const batchId = 18n;
        let resetCalled = false;
        const repo = {
            prisma: {} as PrismaClient,
            fetchBatchProgress: async () => ({
                id: batchId,
                status: "failed",
                validation_total: 37,
                validation_done: 37,
                validation_percent: 100,
                validated_at: new Date(),
                validation_heartbeat_at: null,
                validation_cancel_requested_at: null,
                promoted_at: new Date("2024-06-01T12:00:00.000Z"),
                summary: {
                    promotion_status: "promotion_failed",
                    promotion_result: {
                        promoted_count: 0,
                        success_count: 0,
                        failed_count: 35,
                        status: "failed",
                    },
                },
            }),
            resetValidationState: async () => {
                resetCalled = true;
            },
        } as unknown as ImportReviewPromotionValidationRepository;

        const runner = new ImportReviewPromotionValidationRunner(repo);
        const result = await runner.resetValidation(batchId);
        assert.equal(resetCalled, true);
        assert.equal(result.status, "draft");
    });

    it("cannot cancel or reset promoted batch", async () => {
        const batchId = 1n;
        const repo = {
            prisma: {} as PrismaClient,
            fetchBatchProgress: async () => ({
                id: batchId,
                status: "promoted",
                validation_total: 1,
                validation_done: 1,
                validation_percent: 100,
                validated_at: new Date(),
                validation_heartbeat_at: null,
                validation_cancel_requested_at: null,
                promoted_at: new Date(),
                summary: {
                    promotion_status: "promoted",
                    promotion_result: { promoted_count: 5, success_count: 5, failed_count: 0, status: "promoted" },
                },
            }),
        } as unknown as ImportReviewPromotionValidationRepository;

        const runner = new ImportReviewPromotionValidationRunner(repo);

        await assert.rejects(
            () => runner.cancelValidation(batchId),
            (err: unknown) => err instanceof ImportReviewPublishBatchValidationNotRunningError
        );
        await assert.rejects(
            () => runner.resetValidation(batchId),
            (err: unknown) => err instanceof ImportReviewPublishBatchValidationResetError
        );
    });

    it("cancelValidation finalizes immediately when worker is not in this process", async () => {
        const batchId = 21n;
        const staleHeartbeat = new Date(Date.now() - 3 * 60_000);
        let finalized = false;
        let cancelRequested = false;

        const repo = {
            prisma: {} as PrismaClient,
            fetchBatchProgress: async () => ({
                id: batchId,
                status: "validating",
                validation_total: 988,
                validation_done: 200,
                validation_percent: 30,
                validated_at: null,
                validation_heartbeat_at: staleHeartbeat,
                validation_cancel_requested_at: cancelRequested ? new Date() : null,
                promoted_at: null,
                summary: {},
            }),
            listStageLogs: async () => [],
            requestValidationCancel: async () => {
                cancelRequested = true;
                return true;
            },
            finalizeValidationAborted: async (_id: bigint, reason: string) => {
                assert.equal(reason, "cancelled");
                finalized = true;
            },
        } as unknown as ImportReviewPromotionValidationRepository;

        const runner = new ImportReviewPromotionValidationRunner(repo);
        const result = await runner.cancelValidation(batchId);
        assert.equal(finalized, true);
        assert.equal(result.status, "failed");
        assert.match(result.message, /cancelled/i);
    });

    it("startValidation fails stale validating batch then allows claim on failed", async () => {
        const batchId = 42n;
        const staleHeartbeat = new Date(Date.now() - 20 * 60_000);
        let status = "validating";
        let staleFailed = false;
        let claimed = false;

        const repo = {
            prisma: {
                $queryRaw: async () => [{ count: 0n }],
            } as unknown as PrismaClient,
            fetchBatchProgress: async () => ({
                id: batchId,
                status,
                validation_total: 0,
                validation_done: 0,
                validation_percent: 0,
                validated_at: null,
                validation_heartbeat_at: staleHeartbeat,
                validation_cancel_requested_at: null,
                promoted_at: null,
                summary: {},
            }),
            listStageLogs: async () => [],
            failStaleValidationBatch: async () => {
                staleFailed = true;
                status = "failed";
            },
            claimBatchForValidation: async () => {
                claimed = true;
                status = "validating";
                return { claimed: true, status: "validating" };
            },
            clearStageLogs: async () => {},
            seedStageLogs: async () => {},
        } as unknown as ImportReviewPromotionValidationRepository;

        const runner = new ImportReviewPromotionValidationRunner(repo);
        (
            runner as unknown as { runValidation: (id: bigint) => Promise<void> }
        ).runValidation = async () => {};

        const result = await runner.startValidation(batchId);
        assert.equal(staleFailed, true);
        assert.equal(claimed, true);
        assert.equal(result.status, "validating");
    });
});

function prismaForBatchValidation(): PrismaClient {
    return {
        $queryRaw: async () => [],
    } as unknown as PrismaClient;
}

describe("validatePublishBatch shouldAbort", () => {
    it("throws aborted error before next chunk when shouldAbort is true", async () => {
        const svc = new ImportReviewPromotionSimpleBatchValidation(prismaForBatchValidation());
        let chunkCalls = 0;
        svc.listPublishItemTargets = async () =>
            Array.from({ length: 150 }, (_, i) => ({
                publish_item_id: BigInt(i + 1),
                entity_family: "buildings",
                review_candidate_id: BigInt(1000 + i),
                review_batch_id: 2n,
            }));
        svc.validateTargetsChunk = async (targets) => {
            chunkCalls += 1;
            return targets.map((t) => ({
                publish_item_id: t.publish_item_id,
                entity_family: t.entity_family,
                status: "ready" as const,
                skipped: false,
                result: { status: "ready" as const, errors: [], warnings: [] },
            }));
        };

        await assert.rejects(
            () =>
                svc.validatePublishBatch(17n, {
                    shouldAbort: async () => chunkCalls >= 1,
                }),
            (err: unknown) => err instanceof ImportReviewPublishBatchValidationAbortedError
        );
        assert.equal(chunkCalls, 1);
    });
});
