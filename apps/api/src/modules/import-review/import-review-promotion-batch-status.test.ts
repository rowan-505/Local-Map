import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    batchHasSuccessfulPromotion,
    batchPromotionBlocksValidationReset,
    computePromotionRunFinalize,
} from "./import-review-promotion-batch-status.js";

const partialValidation = {
    validation_outcome: "partial" as const,
    previous_stored_status: "partial",
};

describe("computePromotionRunFinalize promoted_at semantics", () => {
    it("0 promoted + 35 failed does not set promoted_at", () => {
        const f = computePromotionRunFinalize(
            {
                promoted_count: 0,
                failed_count: 35,
                skipped_blocked_count: 0,
                skipped_warning_count: 0,
                pending_after_count: 0,
                total_batch_items: 37,
                system_error: false,
            },
            partialValidation
        );
        assert.equal(f.set_promoted_at, false);
        assert.equal(f.promotion_status, "promotion_failed");
        assert.equal(f.stored_batch_status, "failed");
        assert.equal(f.promotion_result_status, "failed");
    });

    it("1 promoted + 0 failed sets promoted_at", () => {
        const f = computePromotionRunFinalize(
            {
                promoted_count: 1,
                failed_count: 0,
                skipped_blocked_count: 0,
                skipped_warning_count: 0,
                pending_after_count: 0,
                total_batch_items: 1,
                system_error: false,
            },
            { validation_outcome: "passed", previous_stored_status: "ready" }
        );
        assert.equal(f.set_promoted_at, true);
        assert.equal(f.promotion_status, "promoted");
        assert.equal(f.stored_batch_status, "promoted");
    });

    it("1 promoted + 2 failed sets promoted_at and partially_promoted", () => {
        const f = computePromotionRunFinalize(
            {
                promoted_count: 1,
                failed_count: 2,
                skipped_blocked_count: 0,
                skipped_warning_count: 0,
                pending_after_count: 2,
                total_batch_items: 3,
                system_error: false,
            },
            partialValidation
        );
        assert.equal(f.set_promoted_at, true);
        assert.equal(f.promotion_status, "partially_promoted");
        assert.equal(f.stored_batch_status, "partially_promoted");
        assert.equal(f.promotion_result_status, "partially_promoted");
    });
});

describe("batchPromotionBlocksValidationReset", () => {
    it("reset guard checks real promoted_count, not promoted_at alone", () => {
        assert.equal(
            batchPromotionBlocksValidationReset({
                status: "failed",
                promoted_at: new Date("2024-06-01T12:00:00.000Z"),
                summary: {
                    promotion_status: "promotion_failed",
                    promotion_result: {
                        promoted_count: 0,
                        success_count: 0,
                        failed_count: 35,
                        status: "failed",
                    },
                },
            }),
            false
        );
        assert.equal(
            batchPromotionBlocksValidationReset({
                status: "partially_promoted",
                promoted_at: new Date("2024-06-01T12:00:00.000Z"),
                summary: {
                    promotion_status: "partially_promoted",
                    promotion_result: { promoted_count: 1, success_count: 1, failed_count: 2, status: "partially_promoted" },
                },
            }),
            true
        );
    });
});

describe("batchHasSuccessfulPromotion", () => {
    it("ignores promoted_at and uses success_count from summary", () => {
        assert.equal(
            batchHasSuccessfulPromotion({
                success_count: 0,
                summary: { promotion_result: { success_count: 0, promoted_count: 0 } },
            }),
            false
        );
        assert.equal(
            batchHasSuccessfulPromotion({
                success_count: 0,
                summary: { promotion_result: { success_count: 3, promoted_count: 3 } },
            }),
            true
        );
    });
});
