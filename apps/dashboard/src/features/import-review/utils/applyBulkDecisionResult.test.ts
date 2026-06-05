import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewBulkDecisionResponse } from "@/src/lib/api";

import {
    applyBulkDecisionResult,
    formatBulkDuplicateApprovalError,
    isBulkDuplicateApprovalError,
    removeUpdatedIdsFromSelection,
} from "./applyBulkDecisionResult.js";

function mockResponse(
    overrides: Partial<ImportReviewBulkDecisionResponse> = {}
): ImportReviewBulkDecisionResponse {
    return {
        source_snapshot_version: "v1",
        review_batch_id: "2",
        source_snapshot_id_local: "1",
        success: true,
        updated_count: 1,
        skipped_count: 0,
        skipped_reasons: [],
        updated_ids: [1],
        dry_run: false,
        ...overrides,
    };
}

describe("applyBulkDecisionResult", () => {
    it("clears only updated IDs and refetches on success", () => {
        let refreshed = false;
        let selection = new Set(["1", "2", "3"]);
        const setSelectedIds = (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
            selection = typeof updater === "function" ? updater(selection) : updater;
        };

        const { outcome, message } = applyBulkDecisionResult({
            dryRun: false,
            usedSelectionIds: true,
            response: mockResponse({ updated_count: 2, updated_ids: [1, 3] }),
            selectedIds: selection,
            setSelectedIds,
            onListRefresh: () => {
                refreshed = true;
            },
        });

        assert.equal(outcome, "updated");
        assert.equal(refreshed, true);
        assert.deepEqual([...selection], ["2"]);
        assert.match(message, /Updated 2 candidate/);
    });

    it("keeps selection and shows warning when updated_count is 0", () => {
        let refreshed = false;
        const selection = new Set(["10", "11"]);
        const setSelectedIds = () => {
            throw new Error("selection should not change");
        };

        const { outcome, message } = applyBulkDecisionResult({
            dryRun: false,
            usedSelectionIds: true,
            response: mockResponse({
                success: false,
                updated_count: 0,
                updated_ids: [],
                skipped_count: 2,
                skipped_reasons: [{ reason: "ineligible_bulk_approval", count: 2 }],
            }),
            selectedIds: selection,
            setSelectedIds,
            onListRefresh: () => {
                refreshed = true;
            },
        });

        assert.equal(outcome, "no_update");
        assert.equal(refreshed, false);
        assert.match(message, /No rows were updated/);
        assert.match(message, /ineligible_bulk_approval/);
    });

    it("does not clear selection for filter-based apply", () => {
        let refreshed = false;
        let selection = new Set(["5"]);
        const setSelectedIds = (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
            selection = typeof updater === "function" ? updater(selection) : updater;
        };

        applyBulkDecisionResult({
            dryRun: false,
            usedSelectionIds: false,
            response: mockResponse({ updated_count: 4, updated_ids: [9, 10] }),
            selectedIds: selection,
            setSelectedIds,
            onListRefresh: () => {
                refreshed = true;
            },
        });

        assert.equal(refreshed, true);
        assert.deepEqual([...selection], ["5"]);
    });

    it("returns preview message without mutating selection", () => {
        const selection = new Set(["1"]);
        const setSelectedIds = () => {
            throw new Error("selection should not change");
        };

        const { outcome, message } = applyBulkDecisionResult({
            dryRun: true,
            usedSelectionIds: true,
            response: mockResponse({ dry_run: true, updated_count: 3, skipped_count: 1 }),
            selectedIds: selection,
            setSelectedIds,
            onListRefresh: () => {
                throw new Error("should not refresh on preview");
            },
        });

        assert.equal(outcome, "preview");
        assert.match(message, /Preview: would update 3/);
    });
});

describe("removeUpdatedIdsFromSelection", () => {
    it("removes only matching numeric ids as strings", () => {
        const next = removeUpdatedIdsFromSelection(new Set(["1", "2", "10"]), [1, 10]);
        assert.deepEqual([...next], ["2"]);
    });
});

describe("bulk duplicate approval errors", () => {
    it("detects duplicate approval message", () => {
        assert.equal(
            isBulkDuplicateApprovalError(new Error("Duplicate candidates require force approval.")),
            true
        );
    });

    it("formats duplicate approval error", () => {
        assert.equal(
            formatBulkDuplicateApprovalError(
                new Error("Duplicate candidates require force approval."),
                "fallback"
            ),
            "Duplicate candidates require force approval."
        );
    });
});
