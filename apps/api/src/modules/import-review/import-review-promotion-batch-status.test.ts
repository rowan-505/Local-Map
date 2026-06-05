import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computePromotionRunFinalize } from "./import-review-promotion-batch-status.js";

describe("computePromotionRunFinalize", () => {
    it("1 promoted + 2 failed sets partial stored status (not partially_promoted)", () => {
        const f = computePromotionRunFinalize(
            {
                promoted_count: 1,
                failed_count: 2,
                skipped_blocked_count: 0,
                skipped_warning_count: 0,
                pending_after_count: 0,
                total_batch_items: 3,
                system_error: false,
            },
            { validation_outcome: "partial", previous_stored_status: "ready" }
        );
        assert.equal(f.promotion_status, "partially_promoted");
        assert.equal(f.stored_batch_status, "partial");
        assert.equal(f.promotion_result_status, "partial");
    });

    it("all promoted with no blockers sets promoted", () => {
        const f = computePromotionRunFinalize(
            {
                promoted_count: 10,
                failed_count: 0,
                skipped_blocked_count: 0,
                skipped_warning_count: 0,
                pending_after_count: 0,
                total_batch_items: 10,
                system_error: false,
            },
            { validation_outcome: "passed", previous_stored_status: "ready" }
        );
        assert.equal(f.stored_batch_status, "promoted");
        assert.equal(f.promotion_result_status, "promoted");
    });
});
