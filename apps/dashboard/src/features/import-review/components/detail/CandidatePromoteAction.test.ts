import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    logCreatePublishBatchResponseDev,
    resolveCreatedPublishBatchId,
} from "@/src/features/import-review/utils/createPublishBatchResponse.js";

describe("CandidatePromoteAction navigation guard", () => {
    it("does not navigate when batch id cannot be resolved", () => {
        const batchId = resolveCreatedPublishBatchId({
            message: "Created",
            batch: { batch_name: "x" },
        });
        assert.equal(batchId, null);
    });

    it("resolves top-level id for promotion route", () => {
        const batchId = resolveCreatedPublishBatchId({
            id: 123,
            public_id: "550e8400-e29b-41d4-a716-446655440000",
            review_batch_id: 2,
            mode: "selected",
            total_item_count: 1,
            count_by_family: { places: 1 },
        });
        assert.equal(batchId, "123");
        const href = `/dashboard/import-review/promotion/${batchId}?review_batch_id=2`;
        assert.match(href, /\/promotion\/123\?/);
    });

    it("dev log helper is safe when dev mode is off", () => {
        assert.doesNotThrow(() => {
            logCreatePublishBatchResponseDev("test", { mode: "selected" }, { id: 1 }, "1");
        });
    });
});
