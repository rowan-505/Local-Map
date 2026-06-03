import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import {
    buildPublishItemFailureAfterData,
    buildPromotionItemFailureRecord,
    promotionFailureSampleFromRow,
    summarizeFamilyPromotionFailures,
} from "./import-review-promotion-failure.js";
import { extractPromotionFailureCause } from "./import-review-promotion-failure-cause.js";
import { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import { parsePublishBatchItemsQuery } from "./import-review-history-publish-batch-items-query.js";

type ExecuteCall = { sql: string; values: unknown[] };

function createFailureStorageMockPrisma() {
    const executeCalls: ExecuteCall[] = [];
    const prisma: {
        $transaction: <T>(fn: (tx: typeof prisma) => Promise<T>) => Promise<T>;
        $queryRaw: () => Promise<unknown[]>;
        $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
    } = {
        $transaction: async <T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> => fn(prisma),
        $queryRaw: async () => [],
        $executeRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
            executeCalls.push({ sql: query.join("?"), values });
            return 1;
        },
    };
    return { prisma: prisma as never, executeCalls };
}

describe("applyItemFailure stores structured publish item failure", () => {
    it("writes error_message and after_data with prisma metadata for forced place failure", async () => {
        const { prisma, executeCalls } = createFailureStorageMockPrisma();
        const repo = new ImportReviewPromotionPromoteRepository(
            prisma,
            new ImportReviewPromotionValidationRepository(prisma)
        );

        const prismaErr = new Prisma.PrismaClientKnownRequestError("column missing", {
            code: "P2010",
            clientVersion: "6.0.0",
            meta: { code: "42703", message: 'column "c"."is_active" does not exist' },
        });
        const cause = extractPromotionFailureCause(prismaErr);

        await repo.applyItemFailure({
            publishItemId: 1843n,
            errorMessage: "Place promotion failed: column missing",
            entityFamily: "places",
            reviewCandidateId: 900n,
            externalId: "osm:node/1",
            targetSchema: "core",
            targetTable: "core_places",
            publishAction: "insert",
            failureCause: cause,
        });

        assert.equal(executeCalls.length, 1);
        const call = executeCalls[0]!;
        assert.match(call.sql, /publish_status = 'failed'/);
        assert.match(call.sql, /after_data/);

        const afterJson = call.values.find(
            (v) => typeof v === "string" && v.includes('"status":"failed"')
        );
        assert.ok(typeof afterJson === "string", "expected after_data JSON in execute values");
        const after = JSON.parse(afterJson) as Record<string, unknown>;
        assert.equal(after.status, "failed");
        assert.equal(typeof after.error_code, "string");
        assert.ok(String(after.error_code).length > 0);
        assert.equal(after.prisma_code, "P2010");
        assert.equal(after.sqlstate, "42703");
        assert.equal(after.family, "places");
        assert.equal(after.candidate_id, "900");
        assert.equal(after.target_table, "core_places");
        assert.match(String(after.message), /system error|column/i);

        const sample = promotionFailureSampleFromRow({
            id: 1843n,
            entity_family: "places",
            review_candidate_id: 900n,
            external_id: "osm:node/1",
            target_schema: "core",
            target_table: "core_places",
            error_message: String(after.message),
            after_data: after,
        });
        assert.equal(sample.entity_family, "places");
        assert.match(sample.reason, /column|does not exist|system error/i);
    });
});

describe("history failed items query accepts failed filter", () => {
    it("parses publish_status=failed for failed details endpoint", () => {
        const parsed = parsePublishBatchItemsQuery({
            publish_status: "failed",
            limit: 200,
            offset: 0,
        });
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.publish_status, "failed");
        }
    });
});

describe("summarizeFamilyPromotionFailures for stage logs", () => {
    it("includes failed_count, candidate ids, and distinct error messages", () => {
        const summary = summarizeFamilyPromotionFailures([
            {
                review_candidate_id: 10n,
                error_message: "Place promotion failed: system error",
                after_data: {
                    status: "failed",
                    error_code: "PROMOTION_SYSTEM_ERROR",
                    error_message: "Promotion system error while writing to the database.",
                    candidate_id: "10",
                },
            },
            {
                review_candidate_id: 11n,
                error_message: "CATEGORY_REQUIRED: missing",
                after_data: {
                    status: "failed",
                    error_code: "CATEGORY_REQUIRED",
                    error_message: "CATEGORY_REQUIRED: missing",
                    candidate_id: "11",
                },
            },
            {
                review_candidate_id: 12n,
                error_message: "CATEGORY_REQUIRED: missing again",
                after_data: {
                    status: "failed",
                    error_code: "CATEGORY_REQUIRED",
                    error_message: "CATEGORY_REQUIRED: missing",
                    candidate_id: "12",
                },
            },
        ]);

        assert.equal(summary.failed_count, 3);
        assert.deepEqual(summary.sample_candidate_ids, ["10", "11", "12"]);
        assert.equal(summary.sample_error_messages.length, 2);
        assert.match(summary.sample_error_messages[0]!, /system error/i);
        assert.match(summary.sample_error_messages[1]!, /CATEGORY_REQUIRED/);
    });
});

describe("buildPublishItemFailureAfterData", () => {
    it("does not include stack trace fields at top level", () => {
        const cause = extractPromotionFailureCause(new Error("fail\n    at foo.ts:12"));
        const record = buildPromotionItemFailureRecord({
            errorMessage: "fail",
            entityFamily: "places",
            failureCause: cause,
        });
        const after = buildPublishItemFailureAfterData(record, cause);
        assert.equal(after.status, "failed");
        assert.equal((after as Record<string, unknown>).stack, undefined);
        assert.equal((after as Record<string, unknown>).stackTrace, undefined);
    });
});
