import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PromotionFamilyItemCounts } from "./import-review-promotion-promote-api.js";
import {
    promotePublishItemsByFamilyChunks,
    recordPromotionItemOutcome,
} from "./import-review-promotion-promote-chunk-executor.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";

function result(
    id: number,
    outcome: PromoteItemResult["outcome"],
    targetId: bigint | null = outcome === "failed" ? null : 100n
): PromoteItemResult {
    return {
        publish_item_id: BigInt(id),
        outcome,
        target_id: targetId,
        error_message: outcome === "failed" ? "err" : null,
        before_data: null,
        after_data: null,
    };
}

describe("recordPromotionItemOutcome", () => {
    it("counts insert as promoted success", () => {
        const counters = {
            inserted: 0,
            updated: 0,
            success: 0,
            failed: 0,
            skipped: 0,
            verificationMetadataApplied: 0,
            verificationMetadataSkippedAlreadyVerified: 0,
        };
        const familyCounts: PromotionFamilyItemCounts = {
            success: 0,
            failed: 0,
            skipped: 0,
            inserted: 0,
            updated: 0,
        };
        recordPromotionItemOutcome({
            result: result(1, "inserted"),
            hasItemRow: true,
            counters,
            familyCounts,
            promotedFamilies: new Set(),
            entityFamily: "places",
        });
        assert.equal(counters.success, 1);
        assert.equal(counters.inserted, 1);
        assert.equal(counters.failed, 0);
    });
});

describe("promotePublishItemsByFamilyChunks", () => {
    it("promotes one place and reports chunk progress at 100%", async () => {
        const chunkEvents: Array<{ globalProcessed: number; globalTotal: number }> = [];
        const { familySuccess, familyFailed } = await promotePublishItemsByFamilyChunks({
            family: "places",
            publishItemIds: [1n],
            globalProcessedOffset: 0,
            globalTotal: 1,
            assertNotCancelled: async () => {},
            hasItemRow: () => true,
            promoteItem: async () => result(1, "inserted", 42n),
            recordOutcome: () => {},
            onChunkComplete: async (event) => {
                chunkEvents.push({
                    globalProcessed: event.globalProcessed,
                    globalTotal: event.globalTotal,
                });
            },
        });
        assert.equal(familySuccess, 1);
        assert.equal(familyFailed, 0);
        assert.deepEqual(chunkEvents, [{ globalProcessed: 1, globalTotal: 1 }]);
    });

    it("continues after a failed item in a chunk", async () => {
        let call = 0;
        const outcomes: PromoteItemResult["outcome"][] = [];
        await promotePublishItemsByFamilyChunks({
            family: "places",
            publishItemIds: [1n, 2n, 3n],
            globalProcessedOffset: 0,
            globalTotal: 3,
            assertNotCancelled: async () => {},
            hasItemRow: () => true,
            promoteItem: async (id) => {
                call += 1;
                if (id === 2n) {
                    return result(2, "failed");
                }
                return result(Number(id), "inserted");
            },
            recordOutcome: (r) => {
                outcomes.push(r.outcome);
            },
            onChunkComplete: async () => {},
        });
        assert.deepEqual(outcomes, ["inserted", "failed", "inserted"]);
        assert.equal(call, 3);
    });
});
