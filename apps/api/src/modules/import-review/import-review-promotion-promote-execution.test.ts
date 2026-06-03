import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    classifyPublishItemsForPromotion,
    computePromotionRunFinalize,
    type PublishItemValidationRow,
} from "./import-review-promotion-execution.js";
import {
    canPromotePublishItem,
    publishItemPromotionBlockReason,
} from "./import-review-promotion-publish-item-validation.js";
function row(id: number, status: string, warnings: { code: string; message: string }[] = []): PublishItemValidationRow {
    return {
        publish_item_id: BigInt(id),
        validation_result: {
            status,
            errors: status === "blocked" ? [{ code: "x", message: "blocked", severity: "error" }] : [],
            warnings,
            issues: [],
        },
    };
}

describe("classifyPublishItemsForPromotion", () => {
    it("promotes ready items and skips blocked", () => {
        const ready = Array.from({ length: 3 }, (_, i) => row(i + 1, "ready"));
        const blocked = [row(4, "blocked"), row(5, "blocked")];
        const selection = classifyPublishItemsForPromotion([...ready, ...blocked]);
        assert.equal(selection.promotableIds.length, 3);
        assert.equal(selection.skipped_blocked_count, 2);
        assert.equal(selection.skipped_warning_count, 0);
        assert.equal(canPromotePublishItem(blocked[0]!.validation_result), false);
    });

    it("skips warning items without confirmation", () => {
        const selection = classifyPublishItemsForPromotion(
            [row(1, "ready"), row(2, "warning", [{ code: "w", message: "warn" }])],
            { confirm_warnings: false }
        );
        assert.deepEqual(selection.promotableIds, [1n]);
        assert.equal(selection.skipped_warning_count, 1);
    });

    it("includes warning items when confirm_warnings and promotion_note are set", () => {
        const selection = classifyPublishItemsForPromotion(
            [row(1, "warning", [{ code: "w", message: "warn" }])],
            { confirm_warnings: true, promotion_note: "reviewed" }
        );
        assert.deepEqual(selection.promotableIds, [1n]);
        assert.equal(selection.skipped_warning_count, 0);
    });

    it("batch with 35 ready + 2 blocked selects 35 promotable ids", () => {
        const rows: PublishItemValidationRow[] = [];
        for (let i = 1; i <= 35; i += 1) {
            rows.push(row(i, "ready"));
        }
        rows.push(row(36, "blocked"), row(37, "blocked"));
        const selection = classifyPublishItemsForPromotion(rows);
        assert.equal(selection.promotableIds.length, 35);
        assert.equal(selection.skipped_blocked_count, 2);
        const finalize = computePromotionRunFinalize(
            {
                promoted_count: 35,
                failed_count: 0,
                skipped_blocked_count: 2,
                skipped_warning_count: 0,
                pending_after_count: 2,
                total_batch_items: 37,
                system_error: false,
            },
            { validation_outcome: "partial", previous_stored_status: "partial" }
        );
        assert.equal(finalize.stored_batch_status, "partially_promoted");
        assert.equal(finalize.promotion_result_status, "partially_promoted");
    });

    it("blocked item never appears in promotableIds", () => {
        const blocked = row(1, "blocked");
        assert.equal(classifyPublishItemsForPromotion([blocked]).promotableIds.length, 0);
        assert.match(publishItemPromotionBlockReason(blocked.validation_result) ?? "", /blocked/i);
    });
});

describe("computePromotionRunFinalize", () => {
    it("0 ready + 2 blocked => promotion_failed without promoted_at", () => {
        const f = computePromotionRunFinalize(
            {
                promoted_count: 0,
                failed_count: 0,
                skipped_blocked_count: 2,
                skipped_warning_count: 0,
                pending_after_count: 2,
                total_batch_items: 2,
                system_error: false,
            },
            { validation_outcome: "blocked", previous_stored_status: "blocked" }
        );
        assert.equal(f.stored_batch_status, "failed");
        assert.equal(f.promotion_status, "promotion_failed");
        assert.equal(f.set_promoted_at, false);
    });

    it("all items promoted => promoted", () => {
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
        assert.equal(f.set_promoted_at, true);
    });
});
