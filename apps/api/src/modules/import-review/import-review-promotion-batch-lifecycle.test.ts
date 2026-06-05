import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { buildMarkBatchedByIdsSql } from "./import-review-promotion-eligibility.js";
import { getImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import type { ImportReviewScopeResolved } from "./import-review-data-repository.js";
import { ImportReviewPromotionRepository } from "./import-review-promotion.repo.js";
import {
    listStaleBatchedCandidatesForFamily,
    STALE_BATCHED_RELEASE_ALLOWED_BATCH_STATUSES,
    STALE_BATCHED_RELEASE_BLOCKED_BATCH_STATUSES,
} from "./import-review-promotion-release-stale-batched.js";
import { validateRoadPublishItemsSql } from "./import-review-promotion-roads-validate-sql.js";

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

describe("publish batch road lifecycle", () => {
    it("marks inserted candidate ids batched in the same transaction without not_ready gate", () => {
        const roads = getImportReviewPublishFamilyConfig("roads");
        assert.ok(roads);
        const sql = buildMarkBatchedByIdsSql(roads, [1n, 2n, 3n], 33n, {
            includeWarnings: false,
            includeMerged: false,
        });
        const text = prismaSqlText(sql);
        assert.match(text, /promotion_status = 'batched'/);
        assert.match(text, /review_batch_id/);
        assert.doesNotMatch(text, /promotion_status = 'not_ready'/);
    });

    it("create road batch of 10 marks all linked candidates batched", async () => {
        const eligibleIds = Array.from({ length: 10 }, (_, i) => BigInt(i + 1));
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
                if (sql.includes("INSERT INTO system.system_publish_batches")) {
                    return [
                        {
                            id: 33n,
                            public_id: "pb-33",
                            batch_name: "roads-10",
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
                            id: 33n,
                            public_id: "pb-33",
                            batch_name: "roads-10",
                            status: "draft",
                            source_review_batch_id: 2n,
                            source_snapshot_version: "v1",
                            region_code: "MMR",
                            total_item_count: 10,
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
            $executeRaw: async () => 10,
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
            batchName: "roads-10-lifecycle",
            note: null,
            families: [roads],
            options: { includeWarnings: false, includeMerged: false },
            createdByUserId: null,
            limitPerFamily: { roads: 10 },
        });

        assert.equal(transactionRan, true);
        assert.equal(result.itemsAdded, 10);
        assert.equal(result.byFamily[0]?.marked_batched, 10);
        assert.equal(result.candidatesMarked, 10);
    });

    it("stale release does not target draft batch #33 with pending publish items", async () => {
        const queryCalls: string[] = [];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                queryCalls.push(prismaSqlText(query));
                return [];
            },
        };

        await listStaleBatchedCandidatesForFamily(prisma as never, {
            reviewBatchId: 2n,
            entityFamily: "roads",
        });

        const sql = queryCalls[0] ?? "";
        assert.match(sql, /spb_active\.status IN/);
        assert.match(sql, /latest\.batch_status IN/);
        assert.match(sql, /latest\.publish_status IN/);
        assert.ok(
            STALE_BATCHED_RELEASE_BLOCKED_BATCH_STATUSES.includes("draft"),
            "draft batches must block stale release"
        );
        assert.deepEqual(
            [...STALE_BATCHED_RELEASE_ALLOWED_BATCH_STATUSES],
            ["failed", "partial"]
        );
    });

    it("road validation SQL does not update candidate promotion_status", async () => {
        const eligibleIds = Array.from({ length: 10 }, (_, i) => BigInt(i + 1));
        const queryCalls: string[] = [];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                queryCalls.push(prismaSqlText(query));
                return eligibleIds.map((id) => ({
                    publish_item_id: id,
                    candidate_id: id,
                    validation_status: "ready",
                    error_code: null,
                    error_message: null,
                }));
            },
        };

        await validateRoadPublishItemsSql(prisma as never, {
            publishBatchId: 33n,
            publishItemIds: eligibleIds,
        });

        const sql = queryCalls[0] ?? "";
        assert.match(sql, /UPDATE system\.system_publish_items/);
        assert.doesNotMatch(sql, /UPDATE import_review\.road_candidates/);
        assert.doesNotMatch(sql, /promotion_status = 'not_ready'/);
    });
});
