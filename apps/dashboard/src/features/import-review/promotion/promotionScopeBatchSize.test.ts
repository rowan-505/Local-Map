import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    createPublishBatchButtonLabel,
    defaultPromotionScopeBatchSize,
    effectiveCreateBatchItemCount,
    projectedItemsForBatchSize,
    requiresLargeRoadBatchConfirmation,
    resolvePromotionScopeMaxItems,
} from "./promotionScopeBatchSize.js";

describe("promotionScopeBatchSize", () => {
    it("defaults to 20 when roads are selected", () => {
        assert.equal(defaultPromotionScopeBatchSize(["roads"]), 20);
        assert.equal(defaultPromotionScopeBatchSize(["places"]), "all");
    });

    it("resolves max_items only for numeric batch sizes", () => {
        assert.equal(resolvePromotionScopeMaxItems(20), 20);
        assert.equal(resolvePromotionScopeMaxItems("all"), undefined);
    });

    it("requires confirmation for all eligible roads batches", () => {
        assert.equal(
            requiresLargeRoadBatchConfirmation({ batchSize: "all", selectedFamilies: ["roads"] }),
            true
        );
        assert.equal(
            requiresLargeRoadBatchConfirmation({ batchSize: 20, selectedFamilies: ["roads"] }),
            false
        );
    });

    it("projects item count from batch size and family count", () => {
        assert.equal(
            projectedItemsForBatchSize({
                batchSize: 20,
                selectedFamilyCount: 1,
                readyNowTotal: 782,
            }),
            20
        );
        assert.equal(
            projectedItemsForBatchSize({
                batchSize: "all",
                selectedFamilyCount: 1,
                readyNowTotal: 782,
            }),
            782
        );
    });

    it("caps effective create count by ready now total", () => {
        assert.equal(
            effectiveCreateBatchItemCount({
                batchSize: 10,
                selectedFamilyCount: 1,
                readyNowTotal: 3,
            }),
            3
        );
    });

    it("labels create button with actual item count when capped", () => {
        assert.equal(
            createPublishBatchButtonLabel({
                isCreating: false,
                creatingLabel: "Creating…",
                batchSize: 10,
                selectedFamilyCount: 1,
                readyNowTotal: 3,
            }),
            "Create batch with 3 items"
        );
        assert.equal(
            createPublishBatchButtonLabel({
                isCreating: true,
                creatingLabel: "Creating…",
                batchSize: 10,
                selectedFamilyCount: 1,
                readyNowTotal: 3,
            }),
            "Creating…"
        );
    });
});
