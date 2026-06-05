import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bulkImportReviewBuildingDecisionBodySchema } from "./import-review.schema.js";

describe("bulkImportReviewBuildingDecisionBodySchema ids", () => {
    const base = {
        review_batch_id: "2",
        review_decision: "approved" as const,
    };

    it("accepts numeric ids array", () => {
        const parsed = bulkImportReviewBuildingDecisionBodySchema.parse({
            ...base,
            ids: [1, 3, 7],
        });
        assert.deepEqual(parsed.ids?.map((id) => id.toString()), ["1", "3", "7"]);
    });

    it("coerces numeric string ids to bigint", () => {
        const parsed = bulkImportReviewBuildingDecisionBodySchema.parse({
            ...base,
            ids: ["1", "3", "7"],
        });
        assert.deepEqual(parsed.ids?.map((id) => id.toString()), ["1", "3", "7"]);
    });

    it("rejects bulk reject body with aligned review_status", () => {
        const parsed = bulkImportReviewBuildingDecisionBodySchema.parse({
            review_batch_id: "2",
            review_decision: "rejected",
            review_status: "rejected",
            ids: [9],
        });
        assert.equal(parsed.review_decision, "rejected");
        assert.equal(parsed.review_status, "rejected");
    });
});
