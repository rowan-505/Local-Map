import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyImportReviewPromotionItemBookkeeping } from "./import-review-promotion-promote-item-tx.js";
import { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import {
    RoadPromotionSqlStepError,
    promoteItemResultFromRoadSqlStepError,
} from "./import-review-promotion-road-sql-steps.js";
import {
    ROAD_PROMOTE_SRC_ALIAS,
    roadReadyFieldExprs,
} from "./import-review-promotion-promote-roads-sql.js";

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

function roadListRow(publishItemId: bigint) {
    return {
        publish_item_id: publishItemId,
        entity_family: "roads",
        target_table: "core.core_streets",
        publish_action: "insert",
        publish_status: "pending",
        target_id: null,
        review_candidate_id: 55n,
        review_batch_id: 1n,
        source_snapshot_version: "v1",
        promotion_status: "batched",
        promoted_core_id: null,
        matched_core_id: null,
        external_id: "osm:W:test",
        target_schema: "core",
    };
}

describe("road promoteAndCommitItem smoke", () => {
    it("maps RoadPromotionSqlStepError to failed result without 25P02 wrapper", async () => {
        const { promoteItemResultFromRoadSqlStepError: mapErr } = await import(
            "./import-review-promotion-road-sql-steps.js"
        );
        const err = new RoadPromotionSqlStepError({
            step: "insert_core_street",
            operation: "insert_core_streets",
            context: { publish_item_id: 5001n, candidate_id: 55n },
            cause: {
                code: "P2010",
                meta: {
                    code: "42P01",
                    message: 'missing FROM-clause entry for table "r"',
                },
            },
        });
        const result = mapErr(5001n, err);
        assert.equal(result.outcome, "failed");
        assert.match(result.error_message ?? "", /missing FROM-clause entry for table "r"/i);
        assert.doesNotMatch(result.error_message ?? "", /25P02/i);
    });

    it("applyItemFailure runs outside aborted core transaction with root SQL error", async () => {
        const publishItemId = 3892n;
        const batchId = 24n;
        let failureUpdateSeen = false;
        let roadReleaseSeen = false;

        const err = new RoadPromotionSqlStepError({
            step: "insert_core_street",
            operation: "insert_core_streets",
            context: { publish_item_id: publishItemId, candidate_id: 55n },
            cause: {
                code: "P2010",
                meta: {
                    code: "42P01",
                    message: 'missing FROM-clause entry for table "r"',
                },
            },
        });
        const coreResult = promoteItemResultFromRoadSqlStepError(publishItemId, err);

        const prisma = {
            $queryRaw: async (query: unknown) => {
                const sql = prismaSqlText(query);
                if (sql.includes("UNION ALL") && sql.includes("'roads'")) {
                    return [roadListRow(publishItemId)];
                }
                return [];
            },
            $executeRaw: async (query: unknown) => {
                const sql = prismaSqlText(query);
                if (sql.includes("publish_status = 'failed'")) {
                    failureUpdateSeen = true;
                }
                if (sql.includes("promotion_status = 'not_ready'")) {
                    roadReleaseSeen = true;
                    assert.match(sql, /review_status = 'approved'/);
                    assert.match(sql, /review_decision = 'approved'/);
                }
                return 1;
            },
        };

        const repo = new ImportReviewPromotionPromoteRepository(
            prisma as never,
            new ImportReviewPromotionValidationRepository(prisma as never)
        );
        const result = await applyImportReviewPromotionItemBookkeeping(repo, {
            batchId,
            publishItemId,
            promotedBy: null,
            confirmWarnings: true,
        }, coreResult);

        assert.equal(result.outcome, "failed");
        assert.match(result.error_message ?? "", /missing FROM-clause entry for table "r"/i);
        assert.doesNotMatch(result.error_message ?? "", /25P02/i);
        assert.equal(failureUpdateSeen, true);
        assert.equal(roadReleaseSeen, true);
    });

    it("promote SQL uses ready alias s and candidate_geom (regression for batch 24)", () => {
        const sql = roadReadyFieldExprs(24n, ROAD_PROMOTE_SRC_ALIAS, "safe_to_promote", "{}").strings.join(
            " "
        );
        assert.match(sql, /\bs\.candidate_geom\b/);
        assert.doesNotMatch(sql, /\br\.geom\b/);
    });
});

describe("road promoteAndCommitItem live DB (optional)", () => {
    it("promotes one pending road on batch 24 only with explicit live-write opt-in", async (t) => {
        if (process.env.IMPORT_REVIEW_LIVE_DB_SMOKE !== "1" || !process.env.DATABASE_URL) {
            t.skip("IMPORT_REVIEW_LIVE_DB_SMOKE=1 and DATABASE_URL are required");
            return;
        }
        const { prisma } = await import("../../db/prisma.js");
        const repo = new ImportReviewPromotionPromoteRepository(
            prisma,
            new ImportReviewPromotionValidationRepository(prisma)
        );
        const items = await repo.listPromotableItems(24n);
        const pending = items.find(
            (row) => row.entity_family === "roads" && row.publish_status === "pending"
        );
        if (!pending) {
            t.skip("no pending road publish items on batch 24");
            return;
        }
        const result = await repo.promoteAndCommitItem({
            batchId: 24n,
            publishItemId: pending.publish_item_id,
            promotedBy: null,
            confirmWarnings: true,
        });
        assert.equal(result.outcome, "inserted", result.error_message ?? "promotion failed");
        assert.ok(result.target_id != null);
        assert.doesNotMatch(result.error_message ?? "", /25P02/i);
    });
});
