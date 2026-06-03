import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { ImportReviewPromotionService } from "./import-review-promotion.service.js";
import type { ImportReviewPromotionRepository } from "./import-review-promotion.repo.js";
import type { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import type { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import {
    groupCandidateIdsByFamily,
    listFailedReadyPublishItemCandidates,
    resolveFailedReadyRetryCandidates,
} from "./import-review-promotion-retry-failed-ready.js";
import { ImportReviewPublishBatchRetryNotAvailableError } from "./import-review-promotion.errors.js";
import type { JwtUser } from "../../plugins/auth.js";

const testUser = { sub: "1", email: "test@example.com", roles: ["admin"] } as JwtUser;

function queryRawSqlText(sql: unknown): string {
    if (sql && typeof sql === "object" && "strings" in sql && Array.isArray((sql as { strings: unknown }).strings)) {
        return ((sql as { strings: string[] }).strings).join("?");
    }
    return String(sql);
}

describe("groupCandidateIdsByFamily", () => {
    it("deduplicates candidate ids per family", () => {
        const grouped = groupCandidateIdsByFamily([
            { entity_family: "places", review_candidate_id: 3n },
            { entity_family: "places", review_candidate_id: 1n },
            { entity_family: "places", review_candidate_id: 1n },
        ]);
        assert.deepEqual(grouped.places, [1n, 3n]);
    });
});

describe("listFailedReadyPublishItemCandidates", () => {
    it("queries failed items with validation ready only", async () => {
        let captured = "";
        const prisma = {
            $queryRaw: mock.fn(async (sql: unknown) => {
                captured = queryRawSqlText(sql);
                return [{ entity_family: "places", review_candidate_id: 10n }];
            }),
        } as unknown as PrismaClient;
        const rows = await listFailedReadyPublishItemCandidates(prisma, 18n);
        assert.match(captured, /publish_status/);
        assert.match(captured, /publish_status/);
        assert.match(captured, /validation_result/);
        assert.match(captured, /ready/);
        assert.equal(rows.length, 1);
    });
});

function mockPrismaForPlacesRetry(failedReadyIds: bigint[], resolvedIds?: bigint[]) {
    const resolved = resolvedIds ?? failedReadyIds;
    let call = 0;
    return {
        $queryRaw: mock.fn(async () => {
            call += 1;
            if (call === 1) {
                return failedReadyIds.map((id) => ({
                    entity_family: "places",
                    review_candidate_id: id,
                }));
            }
            if (call === 2) {
                return resolved.map((id) => ({ id }));
            }
            if (call === 3) {
                return [];
            }
            return [{ region_code: "yangon" }];
        }),
    } as unknown as PrismaClient;
}

describe("createRetryBatchFromFailedReady service", () => {
    it("failed ready items create new draft batch with correct count", async () => {
        const sourceBatchId = 18n;
        const reviewBatchId = 2n;
        const failedReadyIds = Array.from({ length: 35 }, (_, i) => BigInt(100 + i));

        const prisma = mockPrismaForPlacesRetry(failedReadyIds);

        let createArgs: { candidateIdsByFamily?: Record<string, readonly bigint[]> } | undefined;
        const repo = {
            getPrisma: () => prisma,
            fetchPublishBatchById: async () => ({
                id: sourceBatchId,
                source_review_batch_id: reviewBatchId,
                status: "partial",
            }),
            resolveScope: async () => ({ reviewBatchId, snapshotVersion: "snap" }),
            fetchReviewBatchRegion: async () => "yangon",
            batchNameExists: async () => false,
            createPublishBatchMultiFamily: async (args: {
                candidateIdsByFamily?: Record<string, readonly bigint[]>;
            }) => {
                createArgs = args;
                return {
                    batch: { id: 99n, batch_name: "retry-places", status: "draft" },
                    itemsAdded: 35,
                    candidatesMarked: 35,
                    byFamily: [{ entity_family: "places", items_added: 35, marked_batched: 35, skipped_reasons: [] }],
                    timing: { resolve_ms: 0, eligibility_ms: 0, payload_ms: 0, transaction_ms: 0 },
                    totalSelected: 35,
                };
            },
        } as unknown as ImportReviewPromotionRepository;

        const promoteRepo = {
            selectPublishItemsForPromotion: async () => ({
                promotableIds: [],
                skipped_blocked_count: 0,
                skipped_warning_count: 0,
                skipped_other_count: 0,
            }),
        } as unknown as ImportReviewPromotionPromoteRepository;

        const validationRepo = {
            getPrismaClient: () => prisma,
        } as unknown as ImportReviewPromotionValidationRepository;

        const service = new ImportReviewPromotionService(repo, validationRepo, promoteRepo);
        service.getBatchById = async () =>
            ({
                id: "99",
                public_id: "pb_99",
                batch_name: "retry-places",
                status: "draft",
                source_review_batch_id: reviewBatchId.toString(),
                total_item_count: 35,
            }) as Awaited<ReturnType<ImportReviewPromotionService["getBatchById"]>>;

        const result = await service.createRetryBatchFromFailedReady(
            sourceBatchId,
            {
                confirm_large_batch: true,
                allow_high_risk_families: false,
                mixed_high_risk_confirm: false,
            },
            testUser
        );

        assert.equal(result.id, 99);
        assert.equal(result.status, "draft");
        assert.equal(result.failed_ready_retry_count, 35);
        assert.equal(result.failed_ready_source_count, 35);
        assert.equal(result.source_publish_batch_id, "18");
        assert.equal(result.total_item_count, 35);
        assert.equal(createArgs?.candidateIdsByFamily?.places?.length, 35);
    });

    it("excludes blocked items (validation_result not ready never listed)", async () => {
        const prisma = {
            $queryRaw: mock.fn(async (sql: unknown) => {
                const text = queryRawSqlText(sql);
                if (text.includes("system_publish_items") && text.includes("publish_status = 'failed'")) {
                    return [{ entity_family: "places", review_candidate_id: 5n }];
                }
                return [];
            }),
        } as unknown as PrismaClient;
        const rows = await listFailedReadyPublishItemCandidates(prisma, 18n);
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.review_candidate_id, 5n);
    });

    it("excludes already promoted candidates via resolver", async () => {
        const prisma = mockPrismaForPlacesRetry([2n], [2n]);
        const { source_failed_ready_count, resolution } = await resolveFailedReadyRetryCandidates({
            prisma,
            sourceBatchId: 18n,
            reviewBatchId: 2n,
        });
        assert.equal(source_failed_ready_count, 1);
        assert.equal(resolution.totalItems, 1);
        assert.deepEqual(resolution.candidateIdsByFamily.places, [2n]);
    });

    it("rejects retry when source batch still has promotable pending items", async () => {
        const repo = {
            getPrisma: () => ({} as PrismaClient),
            fetchPublishBatchById: async () => ({
                id: 18n,
                source_review_batch_id: 2n,
                status: "partial",
            }),
        } as unknown as ImportReviewPromotionRepository;
        const promoteRepo = {
            selectPublishItemsForPromotion: async () => ({
                promotableIds: [1n],
                skipped_blocked_count: 0,
                skipped_warning_count: 0,
                skipped_other_count: 0,
            }),
        } as unknown as ImportReviewPromotionPromoteRepository;
        const service = new ImportReviewPromotionService(
            repo,
            { getPrismaClient: () => ({}) } as ImportReviewPromotionValidationRepository,
            promoteRepo
        );

        await assert.rejects(
            () =>
                service.createRetryBatchFromFailedReady(
                    18n,
                    {
                        confirm_large_batch: false,
                        allow_high_risk_families: false,
                        mixed_high_risk_confirm: false,
                    },
                    testUser
                ),
            (e: unknown) => e instanceof ImportReviewPublishBatchRetryNotAvailableError
        );
    });
});
