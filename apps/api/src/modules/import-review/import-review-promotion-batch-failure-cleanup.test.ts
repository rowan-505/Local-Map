import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROMOTABLE_PUBLISH_FAMILIES } from "./import-review-promotion-config.js";
import {
    cleanupPublishBatchTerminalFailure,
    failPendingPublishItemsForPublishBatch,
    PUBLISH_BATCH_VALIDATION_SYSTEM_ERROR_CODE,
    releaseBatchedCandidatesForPublishBatch,
} from "./import-review-promotion-batch-failure-cleanup.js";
import { resetPublishBatchValidationControlColumnsCache } from "./import-review-publish-batch-validation-control-columns.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";

function prismaSqlText(query: unknown): string {
    if (
        query &&
        typeof query === "object" &&
        "strings" in query &&
        Array.isArray((query as { strings: string[] }).strings)
    ) {
        return (query as { strings: string[] }).strings.join("");
    }
    if (Array.isArray(query)) {
        return (query as string[]).join("");
    }
    return String(query);
}

describe("publish batch terminal failure cleanup", () => {
    it("failBatch fails pending items and releases batched candidates for all families", async () => {
        const executeCalls: string[] = [];
        const queryCalls: string[] = [];
        const batchId = 30n;

        const prisma = {
            $executeRaw: async (query: unknown) => {
                executeCalls.push(prismaSqlText(query));
                return 1;
            },
            $queryRaw: async (query: unknown) => {
                queryCalls.push(prismaSqlText(query));
                return [{ id: 1n }];
            },
        };

        resetPublishBatchValidationControlColumnsCache();
        const repo = new ImportReviewPromotionValidationRepository(prisma as never);
        await repo.failBatch(batchId, "Validation SQL exploded.");

        const batchFail = executeCalls.find((sql) => sql.includes("system_publish_batches"));
        const pendingFail = executeCalls.find(
            (sql) =>
                sql.includes("system_publish_items") &&
                sql.includes("publish_status = 'failed'") &&
                sql.includes("publish_status = 'pending'")
        );

        assert.ok(batchFail);
        assert.ok(pendingFail);
        assert.equal(executeCalls.length, 2);

        const releaseCalls = queryCalls.filter(
            (sql) => sql.includes("promotion_status = 'not_ready'") && sql.includes("batched")
        );
        assert.equal(releaseCalls.length, PROMOTABLE_PUBLISH_FAMILIES.length);
        for (const sql of releaseCalls) {
            assert.match(sql, /review_status = 'approved'/);
            assert.match(sql, /publish_batch_id/);
        }
    });

    it("cleanupPublishBatchTerminalFailure marks pending failed then releases per family", async () => {
        const executeCalls: string[] = [];
        const queryCalls: string[] = [];
        const prisma = {
            $executeRaw: async (query: unknown) => {
                executeCalls.push(prismaSqlText(query));
            },
            $queryRaw: async (query: unknown) => {
                queryCalls.push(prismaSqlText(query));
                return [];
            },
        };

        await cleanupPublishBatchTerminalFailure(prisma as never, 99n, {
            errorCode: PUBLISH_BATCH_VALIDATION_SYSTEM_ERROR_CODE,
            errorMessage: "worker died",
        });

        assert.equal(executeCalls.length, 1);
        assert.match(executeCalls[0] ?? "", /system_publish_items/);
        assert.equal(queryCalls.length, PROMOTABLE_PUBLISH_FAMILIES.length);
    });

    it("failPendingPublishItemsForPublishBatch only touches pending rows", async () => {
        const executeCalls: string[] = [];
        const prisma = {
            $executeRaw: async (query: unknown) => {
                executeCalls.push(prismaSqlText(query));
            },
        };

        await failPendingPublishItemsForPublishBatch(prisma as never, 12n, {
            errorCode: "VALIDATION_SYSTEM_ERROR",
            errorMessage: "crash",
        });

        assert.match(executeCalls[0] ?? "", /publish_status = 'pending'/);
        assert.match(executeCalls[0] ?? "", /validation_result/);
    });

    it("releaseBatchedCandidatesForPublishBatch guards successful promotions", async () => {
        const queryCalls: string[] = [];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                queryCalls.push(prismaSqlText(query));
                return [];
            },
        };

        await releaseBatchedCandidatesForPublishBatch(prisma as never, 29n);

        for (const sql of queryCalls) {
            assert.match(sql, /publish_status = 'success'/);
            assert.match(sql, /target_id IS NOT NULL/);
        }
    });
});
