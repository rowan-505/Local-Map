import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import { analyzeBulkSelection, bulkApproveBlockedReason } from "./bulkSelectionAnalysis.js";

function row(overrides: Partial<ImportReviewBuildingListItem> = {}): ImportReviewBuildingListItem {
    return {
        id: "1",
        match_status: "new_auto",
        auto_action: "insert_candidate",
        promotion_status: "pending",
        validation_errors: [],
        ...overrides,
    } as ImportReviewBuildingListItem;
}

describe("bulkApproveBlockedReason duplicate handling", () => {
    it("blocks duplicate_candidate without force approval", () => {
        const analysis = analyzeBulkSelection(
            [row({ id: "1", match_status: "duplicate_candidate" })],
            new Set(["1"])
        );
        const blocked = bulkApproveBlockedReason(analysis, false);
        assert.ok(blocked?.includes("duplicate"));
        assert.ok(!blocked?.includes("oneOf"));
    });

    it("allows duplicate_candidate when force approval enabled", () => {
        const analysis = analyzeBulkSelection(
            [row({ id: "2", match_status: "duplicate_candidate" })],
            new Set(["2"])
        );
        assert.equal(bulkApproveBlockedReason(analysis, true), null);
    });

    it("treats possible_duplicate match_status as duplicate for bulk approve", () => {
        const analysis = analyzeBulkSelection(
            [row({ id: "3", match_status: "possible_duplicate" })],
            new Set(["3"])
        );
        assert.equal(analysis.hasDuplicateCandidate, true);
        assert.ok(bulkApproveBlockedReason(analysis, false)?.includes("duplicate"));
    });
});
