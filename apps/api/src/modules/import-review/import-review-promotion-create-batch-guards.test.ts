import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { CREATE_BATCH_NO_ELIGIBLE_MESSAGE } from "./import-review-promotion-create-batch-eligibility.js";
import { buildCreateBatchEligibleWhereSql } from "./import-review-promotion-create-batch-eligibility.js";
import { getImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import {
    ImportReviewPromotionNoEligibleCandidatesError,
    ImportReviewPublishBatchNameConflictError,
} from "./import-review-promotion.errors.js";
import type { ImportReviewScopeResolved } from "./import-review-data-repository.js";
import { ImportReviewPromotionRepository } from "./import-review-promotion.repo.js";

const testScope: ImportReviewScopeResolved = {
    reviewBatchId: 2n,
    snapshotVersion: "v1",
} as ImportReviewScopeResolved;

function prismaSqlText(query: unknown): string {
    if (
        query &&
        typeof query === "object" &&
        "strings" in query &&
        Array.isArray((query as { strings: string[] }).strings)
    ) {
        return (query as { strings: string[] }).strings.join("");
    }
    return String(query);
}

describe("create batch eligibility guards", () => {
    it("roads create-batch SQL requires not_ready and road required fields", () => {
        const roads = getImportReviewPublishFamilyConfig("roads");
        assert.ok(roads);
        const sql = buildCreateBatchEligibleWhereSql(roads, 2n, {
            includeWarnings: false,
            includeMerged: false,
        }).strings.join("");
        assert.match(sql, /promotion_status = 'not_ready'/);
        assert.match(sql, /road_class_id/);
        assert.match(sql, /admin_area_id/);
        assert.match(sql, /geom/);
    });
});

describe("createPublishBatchMultiFamily guards", () => {
    it("0 eligible candidates does not create a publish batch", async () => {
        const executeCalls: string[] = [];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                const sql = prismaSqlText(query);
                if (sql.includes("to_regclass")) {
                    return [{ ok: true }];
                }
                if (sql.includes("region_code FROM import_review.review_batches")) {
                    return [{ region_code: "MMR" }];
                }
                if (sql.includes("batch_name")) {
                    return [];
                }
                if (sql.includes("road_candidates") && sql.includes("not_ready")) {
                    return [];
                }
                return [];
            },
            $executeRaw: async (query: unknown) => {
                executeCalls.push(prismaSqlText(query));
                return 0;
            },
            $transaction: async () => {
                throw new Error("transaction should not run");
            },
        };

        const repo = new ImportReviewPromotionRepository(prisma as never);
        const roads = getImportReviewPublishFamilyConfig("roads");
        assert.ok(roads);

        await assert.rejects(
            () =>
                repo.createPublishBatchMultiFamily({
                    scope: testScope,
                    batchName: "empty-roads-batch",
                    note: null,
                    families: [roads],
                    options: { includeWarnings: false, includeMerged: false },
                    createdByUserId: null,
                    limitPerFamily: { roads: 10 },
                }),
            (err: unknown) => {
                assert.ok(err instanceof ImportReviewPromotionNoEligibleCandidatesError);
                assert.equal(err.message, CREATE_BATCH_NO_ELIGIBLE_MESSAGE);
                return true;
            }
        );

        assert.equal(executeCalls.some((sql) => sql.includes("INSERT INTO system.system_publish_batches")), false);
    });

    it("5 eligible with requested limit 10 creates batch with 5 items", async () => {
        const eligibleIds = [1n, 2n, 3n, 4n, 5n];
        let transactionRan = false;

        const prisma = {
            $queryRaw: async (query: unknown) => {
                const sql = prismaSqlText(query);
                if (sql.includes("to_regclass")) {
                    return [{ ok: true }];
                }
                if (sql.includes("region_code FROM import_review.review_batches")) {
                    return [{ region_code: "MMR" }];
                }
                if (sql.includes("system_publish_batches WHERE batch_name")) {
                    return [];
                }
                if (sql.includes("road_candidates") && sql.includes("not_ready")) {
                    return eligibleIds.map((id) => ({ id }));
                }
                if (sql.includes("INSERT INTO system.system_publish_batches")) {
                    return [
                        {
                            id: 31n,
                            public_id: "pb-31",
                            batch_name: "roads-5",
                            status: "draft",
                            source_review_batch_id: 2n,
                            source_snapshot_version: "v1",
                            region_code: "MMR",
                            total_item_count: 0,
                            success_count: 0,
                            failed_count: 0,
                            skipped_count: 0,
                            note: null,
                            created_at: new Date(),
                            published_at: null,
                            promoted_at: null,
                        },
                    ];
                }
                if (sql.includes("RETURNING review_candidate_id")) {
                    return eligibleIds.map((id) => ({ review_candidate_id: id }));
                }
                if (sql.includes("FROM system.system_publish_batches AS pb")) {
                    return [
                        {
                            id: 31n,
                            public_id: "pb-31",
                            batch_name: "roads-5",
                            status: "draft",
                            source_review_batch_id: 2n,
                            source_snapshot_version: "v1",
                            region_code: "MMR",
                            total_item_count: 5,
                            success_count: 0,
                            failed_count: 0,
                            skipped_count: 0,
                            note: null,
                            created_at: new Date(),
                            published_at: null,
                            promoted_at: null,
                        },
                    ];
                }
                return [];
            },
            $executeRaw: async () => 5,
            $transaction: mock.fn(async (fn: (tx: PrismaClient) => Promise<unknown>) => {
                transactionRan = true;
                return fn(prisma as never);
            }),
        };

        const repo = new ImportReviewPromotionRepository(prisma as never);
        const roads = getImportReviewPublishFamilyConfig("roads");
        assert.ok(roads);
        repo.selectCreateBatchEligibleCandidateIds = async () => eligibleIds;

        const result = await repo.createPublishBatchMultiFamily({
            scope: testScope,
            batchName: "roads-5",
            note: null,
            families: [roads],
            options: { includeWarnings: false, includeMerged: false },
            createdByUserId: null,
            limitPerFamily: { roads: 10 },
        });

        assert.equal(transactionRan, true);
        assert.equal(result.itemsAdded, 5);
        assert.equal(result.totalSelected, 5);
    });

    it("failed publish item insert rolls back transaction (no successful batch result)", async () => {
        const eligibleIds = [99n];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                const sql = prismaSqlText(query);
                if (sql.includes("to_regclass")) {
                    return [{ ok: true }];
                }
                if (sql.includes("region_code FROM import_review.review_batches")) {
                    return [{ region_code: "MMR" }];
                }
                if (sql.includes("batch_name")) {
                    return [];
                }
                if (sql.includes("road_candidates") && sql.includes("not_ready")) {
                    return eligibleIds.map((id) => ({ id }));
                }
                if (sql.includes("INSERT INTO system.system_publish_batches")) {
                    return [
                        {
                            id: 40n,
                            public_id: "pb-40",
                            batch_name: "fail-insert",
                            status: "draft",
                            source_review_batch_id: 2n,
                            source_snapshot_version: "v1",
                            region_code: "MMR",
                            total_item_count: 0,
                            success_count: 0,
                            failed_count: 0,
                            skipped_count: 0,
                            note: null,
                            created_at: new Date(),
                            published_at: null,
                            promoted_at: null,
                        },
                    ];
                }
                if (sql.includes("RETURNING review_candidate_id")) {
                    return [];
                }
                return [];
            },
            $executeRaw: async () => 0,
            $transaction: async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prisma as never),
        };

        const repo = new ImportReviewPromotionRepository(prisma as never);
        const roads = getImportReviewPublishFamilyConfig("roads");
        assert.ok(roads);

        await assert.rejects(
            () =>
                repo.createPublishBatchMultiFamily({
                    scope: testScope,
                    batchName: "fail-insert",
                    note: null,
                    families: [roads],
                    options: { includeWarnings: false, includeMerged: false },
                    createdByUserId: null,
                }),
            ImportReviewPromotionNoEligibleCandidatesError
        );
    });

    it("rethrows batch name conflict before transaction", async () => {
        const prisma = {
            $queryRaw: async (query: unknown) => {
                const sql = prismaSqlText(query);
                if (sql.includes("to_regclass")) {
                    return [{ ok: true }];
                }
                if (sql.includes("region_code FROM import_review.review_batches")) {
                    return [{ region_code: "MMR" }];
                }
                if (sql.includes("system_publish_batches WHERE batch_name")) {
                    return [{ id: 1n }];
                }
                if (sql.includes("road_candidates") && sql.includes("not_ready")) {
                    return [{ id: 1n }];
                }
                return [];
            },
            $transaction: async () => {
                throw new Error("should not run");
            },
        };

        const repo = new ImportReviewPromotionRepository(prisma as never);
        const roads = getImportReviewPublishFamilyConfig("roads");
        assert.ok(roads);

        await assert.rejects(
            () =>
                repo.createPublishBatchMultiFamily({
                    scope: testScope,
                    batchName: "duplicate",
                    note: null,
                    families: [roads!],
                    options: { includeWarnings: false, includeMerged: false },
                    createdByUserId: null,
                }),
            ImportReviewPublishBatchNameConflictError
        );
    });
});
