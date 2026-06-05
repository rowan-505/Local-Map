import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import {
    countIncompleteValidationItems,
    resolvePromotionStageCancelTarget,
    resolvePromotionStageResumeAction,
    type PromotionStageSnapshot,
} from "./import-review-promotion-stage-control.js";
import { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import { ImportReviewPromotionValidationRunner } from "./import-review-promotion-validation.js";
import { ImportReviewPromotionService } from "./import-review-promotion.service.js";
import { ImportReviewPromotionRepository } from "./import-review-promotion.repo.js";
import {
    ImportReviewPublishBatchStageControlError,
    ImportReviewPublishBatchValidationResetError,
} from "./import-review-promotion.errors.js";
import { publishItemValidationResultIsComplete } from "./import-review-promotion-validation-resume.js";

function snapshot(overrides: Partial<PromotionStageSnapshot> = {}): PromotionStageSnapshot {
    return {
        status: "ready",
        validationPercent: 100,
        validatedAt: new Date(),
        successCount: 0,
        summary: {},
        incompleteValidationItemCount: 0,
        pendingPromotableCount: 5,
        dryRunPassed: true,
        validationWorkerInProcess: false,
        promotionWorkerInProcess: false,
        ...overrides,
    };
}

describe("import-review-promotion-stage-control resolver", () => {
    it("resume_validation when items lack validation_result", () => {
        assert.equal(
            resolvePromotionStageResumeAction(
                snapshot({ status: "ready", incompleteValidationItemCount: 3 })
            ),
            "resume_validation"
        );
    });

    it("resume_dry_run when validation complete and dry-run missing", () => {
        assert.equal(
            resolvePromotionStageResumeAction(
                snapshot({ dryRunPassed: false, pendingPromotableCount: 2 })
            ),
            "resume_dry_run"
        );
    });

    it("resume_promotion when dry-run passed and promotable pending", () => {
        assert.equal(
            resolvePromotionStageResumeAction(
                snapshot({ dryRunPassed: true, pendingPromotableCount: 2, successCount: 1 })
            ),
            "resume_promotion"
        );
    });

    it("already_complete when promoted and no pending promotable", () => {
        assert.equal(
            resolvePromotionStageResumeAction(
                snapshot({
                    status: "promoted",
                    pendingPromotableCount: 0,
                    dryRunPassed: true,
                })
            ),
            "already_complete"
        );
    });

    it("cancel targets validation when status is validating", () => {
        assert.equal(
            resolvePromotionStageCancelTarget({
                status: "validating",
                summary: {},
                validationWorkerInProcess: true,
                promotionWorkerInProcess: false,
            }),
            "validation"
        );
    });

    it("cancel targets promotion when status is promoting", () => {
        assert.equal(
            resolvePromotionStageCancelTarget({
                status: "promoting",
                summary: {},
                validationWorkerInProcess: false,
                promotionWorkerInProcess: true,
            }),
            "promotion"
        );
    });
});

describe("countIncompleteValidationItems", () => {
    it("counts rows without complete validation_result status", async () => {
        const prisma = {
            $queryRaw: async () => [
                { publish_item_id: 1n, validation_result: { status: "ready", errors: [], warnings: [] } },
                { publish_item_id: 2n, validation_result: {} },
                { publish_item_id: 3n, validation_result: { status: "blocked", errors: [], warnings: [] } },
            ],
        } as unknown as PrismaClient;
        const count = await countIncompleteValidationItems(prisma, 17n);
        assert.equal(count, 1);
        assert.equal(publishItemValidationResultIsComplete({ status: "ready", errors: [], warnings: [] }), true);
    });
});

function stubPromoteRepo(success = 0): ImportReviewPromotionPromoteRepository {
    return {
        countPublishItemsByStatus: async () => ({
            pending: 0,
            success,
            failed: 0,
            skipped: 0,
        }),
    } as unknown as ImportReviewPromotionPromoteRepository;
}

describe("ImportReviewPromotionService stage controls", () => {
    it("resume validation after partial validation_result", async () => {
        const batchId = 42n;
        let validateStarted = false;
        const validationRepo = {
            prisma: {
                $queryRaw: async () => [
                    { publish_item_id: 1n, validation_result: { status: "ready", errors: [], warnings: [] } },
                    { publish_item_id: 2n, validation_result: {} },
                ],
            } as unknown as PrismaClient,
            fetchBatchProgress: async () => ({
                id: batchId,
                status: "ready",
                validation_percent: 60,
                validated_at: null,
                promoted_at: null,
                success_count: 0,
                summary: {},
                validation_cancel_requested_at: null,
                validation_heartbeat_at: null,
                validation_total: 10,
                validation_done: 6,
            }),
        } as unknown as ImportReviewPromotionValidationRepository;

        const svc = new ImportReviewPromotionService(
            {} as ImportReviewPromotionRepository,
            validationRepo,
            stubPromoteRepo()
        );

        svc.startValidateBatch = async () => {
            validateStarted = true;
            return { batch_id: batchId.toString(), status: "validating", message: "Validation started." };
        };

        const result = await svc.resumeBatchStage(batchId);
        assert.equal(result.action, "resume_validation");
        assert.equal(validateStarted, true);
    });

    it("resume promotion after partial promoted items", async () => {
        const batchId = 43n;
        let promoteStarted = false;
        const validationRepo = {
            prisma: {
                $queryRaw: async () => [
                    {
                        publish_item_id: 1n,
                        validation_result: { status: "ready", errors: [], warnings: [] },
                    },
                ],
            } as unknown as PrismaClient,
            fetchBatchProgress: async () => ({
                id: batchId,
                status: "partial",
                validation_percent: 100,
                validated_at: new Date(),
                promoted_at: new Date(),
                success_count: 2,
                summary: {
                    dry_run_result: {
                        status: "passed",
                        checked_at: new Date().toISOString(),
                        total: 5,
                        entity_families: ["buildings"],
                    },
                },
                validation_cancel_requested_at: null,
                validation_heartbeat_at: null,
                validation_total: 5,
                validation_done: 5,
            }),
        } as unknown as ImportReviewPromotionValidationRepository;

        const svc = new ImportReviewPromotionService(
            {} as ImportReviewPromotionRepository,
            validationRepo,
            stubPromoteRepo(2)
        );

        svc.startPromoteBatch = async () => {
            promoteStarted = true;
            return { batch_id: batchId.toString(), status: "promoting", message: "Promotion started." };
        };

        const result = await svc.resumeBatchStage(batchId);
        assert.equal(result.action, "resume_promotion");
        assert.equal(promoteStarted, true);
    });

    it("cancel leaves consistent state via validation cancel", async () => {
        const batchId = 44n;
        let cancelCalled = false;
        const validationRepo = {
            prisma: {
                $queryRaw: async () => [],
            } as unknown as PrismaClient,
            fetchBatchProgress: async () => ({
                id: batchId,
                status: "validating",
                validation_percent: 10,
                validated_at: null,
                promoted_at: null,
                success_count: 0,
                summary: {},
                validation_cancel_requested_at: null,
                validation_heartbeat_at: new Date(),
                validation_total: 10,
                validation_done: 1,
            }),
        } as unknown as ImportReviewPromotionValidationRepository;

        const svc = new ImportReviewPromotionService(
            {} as ImportReviewPromotionRepository,
            validationRepo,
            stubPromoteRepo()
        );

        svc.cancelValidateBatch = async () => {
            cancelCalled = true;
            return {
                batch_id: batchId.toString(),
                status: "validating",
                message: "Validation cancel requested.",
            };
        };

        const result = await svc.cancelCurrentStage(batchId);
        assert.equal(cancelCalled, true);
        assert.equal(result.action, "cancel_validation");
    });

    it("reset validation clears item validation_result via runner", async () => {
        const batchId = 45n;
        const cleared: { validation_result?: unknown }[] = [];
        const validationRepo = {
            prisma: {
                $executeRaw: async () => 1,
                $queryRaw: async () => [],
            } as unknown as PrismaClient,
            fetchBatchProgress: async () => ({
                id: batchId,
                status: "ready",
                validation_percent: 100,
                validated_at: new Date(),
                promoted_at: null,
                success_count: 0,
                summary: {},
                validation_cancel_requested_at: null,
                validation_heartbeat_at: null,
                validation_total: 2,
                validation_done: 2,
            }),
            resetValidationState: async () => {
                cleared.push({ validation_result: {} });
            },
        } as unknown as ImportReviewPromotionValidationRepository;

        const runner = new ImportReviewPromotionValidationRunner(validationRepo);
        const result = await runner.resetValidation(batchId);
        assert.equal(result.status, "draft");
        assert.equal(cleared.length, 1);
    });

    it("cannot reset validation when batch has promoted items", async () => {
        const batchId = 46n;
        const validationRepo = {
            prisma: {} as PrismaClient,
            fetchBatchProgress: async () => ({
                id: batchId,
                status: "partial",
                validation_percent: 100,
                validated_at: new Date(),
                promoted_at: new Date(),
                success_count: 3,
                summary: { promotion_status: "partially_promoted", promotion_result: { promoted_count: 3 } },
                validation_cancel_requested_at: null,
                validation_heartbeat_at: null,
                validation_total: 5,
                validation_done: 5,
            }),
        } as unknown as ImportReviewPromotionValidationRepository;

        const svc = new ImportReviewPromotionService(
            {} as ImportReviewPromotionRepository,
            validationRepo,
            stubPromoteRepo(3)
        );

        await assert.rejects(
            () => svc.resetValidateBatchStage(batchId),
            (err: unknown) => err instanceof ImportReviewPublishBatchValidationResetError
        );
    });

    it("cancelCurrentStage throws when nothing is running", async () => {
        const batchId = 47n;
        const validationRepo = {
            prisma: { $queryRaw: async () => [] } as unknown as PrismaClient,
            fetchBatchProgress: async () => ({
                id: batchId,
                status: "ready",
                validation_percent: 100,
                validated_at: new Date(),
                promoted_at: null,
                success_count: 0,
                summary: {},
                validation_cancel_requested_at: null,
                validation_heartbeat_at: null,
                validation_total: 1,
                validation_done: 1,
            }),
        } as unknown as ImportReviewPromotionValidationRepository;

        const svc = new ImportReviewPromotionService(
            {} as ImportReviewPromotionRepository,
            validationRepo,
            stubPromoteRepo()
        );

        await assert.rejects(
            () => svc.cancelCurrentStage(batchId),
            (err: unknown) => err instanceof ImportReviewPublishBatchStageControlError
        );
    });
});
