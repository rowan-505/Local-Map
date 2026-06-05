import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    roadValidationSqlRowToOutcome,
    roadValidationSqlRowsToOutcomes,
    validateRoadPublishItemsSql,
} from "./import-review-promotion-roads-validate-sql.js";
import type { PublishItemValidationTarget } from "./import-review-promotion-simple-batch-validation.js";

function prismaSqlText(query: unknown): string {
    if (
        query &&
        typeof query === "object" &&
        "strings" in query &&
        Array.isArray((query as { strings: string[] }).strings)
    ) {
        return (query as { strings: string[] }).strings.join("?");
    }
    return String(query);
}

function roadTarget(publishItemId: number, candidateId: number): PublishItemValidationTarget {
    return {
        publish_item_id: BigInt(publishItemId),
        entity_family: "roads",
        review_candidate_id: BigInt(candidateId),
        review_batch_id: 2n,
    };
}

describe("validateRoadPublishItemsSql", () => {
    it("uses target_items CTE and does not reference spi inside spi2-only subqueries", async () => {
        const queryCalls: string[] = [];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                queryCalls.push(prismaSqlText(query));
                return [
                    {
                        publish_item_id: 1n,
                        candidate_id: 101n,
                        validation_status: "ready",
                        error_code: null,
                        error_message: null,
                        validation_warnings: [],
                    },
                    {
                        publish_item_id: 2n,
                        candidate_id: 102n,
                        validation_status: "blocked",
                        error_code: "missing_road_class",
                        error_message: "Road class is required.",
                        validation_warnings: [],
                    },
                ];
            },
        };

        const rows = await validateRoadPublishItemsSql(prisma as never, {
            publishBatchId: 32n,
            publishItemIds: Array.from({ length: 10 }, (_, i) => BigInt(i + 1)),
        });

        assert.equal(rows.length, 2);
        assert.equal(queryCalls.length, 1);
        const sql = queryCalls[0] ?? "";
        assert.match(sql, /WITH target_items AS/);
        assert.match(sql, /FROM target_items/);
        assert.doesNotMatch(sql, /spi2/);
        assert.doesNotMatch(sql, /duplicate_external_id_in_batch/);
    });

    it("maps ready and blocked rows to item-level outcomes for a 10-item chunk", () => {
        const targets = Array.from({ length: 10 }, (_, i) => roadTarget(i + 1, 10_000 + i));
        const rows = targets.map((t, i) => ({
            publish_item_id: t.publish_item_id,
            candidate_id: t.review_candidate_id,
            validation_status: i < 8 ? "ready" : "blocked",
            error_code: i < 8 ? null : "not_batched",
            error_message: i < 8 ? null : "Candidate must be promotion_status=batched before validation.",
            validation_warnings: [],
        }));

        const outcomes = roadValidationSqlRowsToOutcomes(targets, rows);
        assert.equal(outcomes.length, 10);
        assert.equal(outcomes.filter((o) => o.status === "ready").length, 8);
        assert.equal(outcomes.filter((o) => o.status === "blocked").length, 2);
        const blocked = outcomes.find((o) => o.status === "blocked");
        assert.equal(blocked?.result.errors[0]?.code, "not_batched");
    });

    it("roadValidationSqlRowToOutcome preserves real blocked reason", () => {
        const outcome = roadValidationSqlRowToOutcome({
            publish_item_id: 9n,
            candidate_id: 109n,
            validation_status: "blocked",
            error_code: "invalid_geometry",
            error_message: "Geometry is invalid.",
            validation_warnings: [],
        });
        assert.equal(outcome.status, "blocked");
        assert.equal(outcome.result.errors[0]?.code, "invalid_geometry");
    });
});
