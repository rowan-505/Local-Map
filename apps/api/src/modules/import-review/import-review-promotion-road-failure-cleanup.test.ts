import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getImportReviewEntityConfig } from "./import-review-config.js";
import { buildCandidateWhereClause, type CandidateListFilters } from "./import-review-candidate-sql.js";
import { applyImportReviewPromotionItemBookkeeping } from "./import-review-promotion-promote-item-tx.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";
import { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";

type ExecuteCall = { sql: string };

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

function roadListRow(publishItemId: bigint, candidateId: bigint) {
    return {
        publish_item_id: publishItemId,
        entity_family: "roads",
        target_table: "core.core_streets",
        publish_action: "insert",
        publish_status: "pending",
        target_id: null,
        review_candidate_id: candidateId,
        review_batch_id: 2n,
        source_snapshot_version: "v1",
        promotion_status: "batched",
        promoted_core_id: null,
        matched_core_id: null,
        external_id: `osm:way/${candidateId}`,
        target_schema: "core",
    };
}

function createRoadBatchPromotionMockPrisma(publishItemIds: readonly bigint[]) {
    const executeCalls: ExecuteCall[] = [];
    const candidateByPublishItem = new Map(
        publishItemIds.map((publishItemId, index) => [publishItemId, BigInt(index + 1)])
    );

    const prisma = {
        $queryRaw: async (query: unknown) => {
            const sql = prismaSqlText(query);
            if (sql.includes("UNION ALL") && sql.includes("'roads'")) {
                return publishItemIds.map((publishItemId) =>
                    roadListRow(publishItemId, candidateByPublishItem.get(publishItemId)!)
                );
            }
            return [];
        },
        $executeRaw: async (query: unknown) => {
            executeCalls.push({ sql: prismaSqlText(query) });
            return 1;
        },
    };

    return { prisma: prisma as never, executeCalls, candidateByPublishItem };
}

describe("road promotion failure cleanup (batch #29 regression)", () => {
    const batchId = 29n;
    const publishItemIds = Array.from({ length: 10 }, (_, i) => BigInt(2900 + i));

    it("8 successes promote candidates; 2 failures release to not_ready", async () => {
        const { prisma, executeCalls } = createRoadBatchPromotionMockPrisma(publishItemIds);
        const repo = new ImportReviewPromotionPromoteRepository(
            prisma,
            new ImportReviewPromotionValidationRepository(prisma)
        );

        for (let i = 0; i < publishItemIds.length; i++) {
            const publishItemId = publishItemIds[i]!;
            const success = i < 8;
            const coreResult: PromoteItemResult = success
                ? {
                      publish_item_id: publishItemId,
                      outcome: "inserted",
                      target_id: BigInt(8000 + i),
                      error_message: null,
                      before_data: null,
                      after_data: { id: String(8000 + i) },
                  }
                : {
                      publish_item_id: publishItemId,
                      outcome: "failed",
                      target_id: null,
                      error_message: `Road promotion failed: test failure ${i}`,
                      before_data: null,
                      after_data: null,
                  };

            await applyImportReviewPromotionItemBookkeeping(
                repo,
                { batchId, publishItemId, promotedBy: null },
                coreResult
            );
        }

        const successPublish = executeCalls.filter((c) =>
            c.sql.includes("publish_status = 'success'")
        );
        const failedPublish = executeCalls.filter((c) =>
            c.sql.includes("publish_status = 'failed'")
        );
        const promotedRoads = executeCalls.filter(
            (c) =>
                c.sql.includes("promotion_status = 'promoted'") &&
                c.sql.includes("review_status = 'promoted'")
        );
        const releasedRoads = executeCalls.filter(
            (c) => c.sql.includes("promotion_status = 'not_ready'")
        );
        const batchedRoads = executeCalls.filter((c) => c.sql.includes("promotion_status = 'batched'"));
        const promotionFailedReview = executeCalls.filter((c) =>
            c.sql.includes("review_status = 'promotion_failed'")
        );

        assert.equal(successPublish.length, 8);
        assert.equal(failedPublish.length, 2);
        assert.equal(promotedRoads.length, 8);
        assert.equal(releasedRoads.length, 2);
        assert.equal(batchedRoads.length, 0);
        assert.equal(promotionFailedReview.length, 0);

        for (const call of failedPublish) {
            assert.match(call.sql, /error_message/);
            assert.match(call.sql, /after_data/);
        }
        for (const call of releasedRoads) {
            assert.match(call.sql, /review_status = 'approved'/);
            assert.match(call.sql, /review_decision = 'approved'/);
            assert.doesNotMatch(call.sql, /promotion_status = 'batched'/);
        }
    });

    it("default roads list hides promoted rows but shows not_ready failed candidates", () => {
        const config = getImportReviewEntityConfig("roads");
        const defaultSql = buildCandidateWhereClause(config, 2n, {
            promotion_state: "all_active",
        }).strings.join(" ");
        const withPromotedSql = buildCandidateWhereClause(config, 2n, {
            include_promoted: true,
        }).strings.join(" ");
        const retrySql = buildCandidateWhereClause(config, 2n, {
            promotion_state: "retry_needed",
        } satisfies CandidateListFilters).strings.join(" ");

        assert.match(defaultSql, /promotion_status = 'promoted'/i);
        assert.doesNotMatch(withPromotedSql, /IS DISTINCT FROM 'promoted'/);
        assert.match(retrySql, /publish_status = 'failed'/);
        assert.doesNotMatch(retrySql, /promotion_status = 'not_ready'/);
    });
});
