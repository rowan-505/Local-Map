import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildPromotionChunkStageDetails,
    buildPromotionPipelineProgressUpdate,
} from "./import-review-promotion-promote-runner-progress.js";

describe("buildPromotionPipelineProgressUpdate", () => {
    it("reaches 100 percent when all items processed", () => {
        const update = buildPromotionPipelineProgressUpdate({
            processed: 35,
            total: 35,
            currentFamily: "places",
            promotedCount: 35,
            failedCount: 0,
            skippedCount: 0,
        });
        assert.equal(update.percent, 100);
        assert.match(update.message, /35/);
        assert.equal(update.currentFamily, "places");
        assert.equal(update.promotedCount, 35);
    });

    it("includes promoted, failed, and skipped counts in stage details", () => {
        const details = buildPromotionChunkStageDetails({
            family: "places",
            processed: 10,
            total: 35,
            promoted_count: 8,
            failed_count: 1,
            skipped_count: 1,
            percent: 28.57,
            chunkIndex: 0,
            chunkSize: 100,
        });
        assert.equal(details.current_family, "places");
        assert.equal(details.promoted_count, 8);
        assert.equal(details.failed_count, 1);
        assert.equal(details.skipped_count, 1);
        assert.equal(details.percent, 28.57);
    });
});
