import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyPublishItemsForPromotion } from "./import-review-promotion-execution.js";

describe("batch progress current_promotable_count semantics", () => {
    it("excludes failed publish items after a failed promotion run", () => {
        const readyRows = Array.from({ length: 35 }, (_, i) => ({
            publish_item_id: BigInt(i + 1),
            validation_result: {
                status: "ready",
                errors: [],
                warnings: [],
                issues: [],
            },
        }));
        const blocked = {
            publish_item_id: 99n,
            validation_result: {
                status: "blocked",
                errors: [{ code: "blocked", message: "blocked", severity: "error" as const }],
                warnings: [],
                issues: [],
            },
        };
        const selection = classifyPublishItemsForPromotion([...readyRows, blocked]);
        assert.equal(selection.promotableIds.length, 35);
        assert.equal(selection.skipped_blocked_count, 1);
    });

    it("returns zero promotable when no pending rows are supplied (failed items not listed)", () => {
        const selection = classifyPublishItemsForPromotion([]);
        assert.equal(selection.promotableIds.length, 0);
    });
});
