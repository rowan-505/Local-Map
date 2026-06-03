import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPublishBatchFailedItemsQuery } from "./publishBatchItemsQuery";
import {
    shouldShowFailedItemsFetchError,
    shouldShowFailedItemsTable,
    shouldShowMissingStoredDetailsMessage,
} from "./publishBatchFailedPanelState";

/**
 * Panel UI is client-only; these tests lock query contract and display-state rules
 * that previously caused 400s and empty-state bounce.
 */
describe("ImportReviewPromotionFailedItemsPanel fetch contract", () => {
    it("does not send limit above API max (avoids 400)", () => {
        const q = buildPublishBatchFailedItemsQuery();
        assert.ok((q.limit ?? 0) <= 200);
        assert.equal(q.publish_status, "failed");
    });

    it("uses publish_status not unsupported status-only alias for failed panel", () => {
        const q = buildPublishBatchFailedItemsQuery();
        assert.equal(q.publish_status, "failed");
        assert.equal(q.status, undefined);
    });
});

describe("failed panel empty vs error display rules", () => {
    it("shows missing-stored message only when loaded with zero rows but failedCount > 0", () => {
        assert.equal(shouldShowMissingStoredDetailsMessage("loaded", 0, 35), true);
    });

    it("does not show missing-stored message on fetch error", () => {
        assert.equal(shouldShowMissingStoredDetailsMessage("error", 0, 35), false);
    });

    it("does not treat fetch error as empty success (no table bounce)", () => {
        assert.equal(shouldShowFailedItemsTable("error", 10), false);
        assert.equal(shouldShowFailedItemsFetchError("error", "Bad Request"), true);
    });
});
