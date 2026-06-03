import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveCreatedPublishBatchId } from "./createPublishBatchResponse.js";

describe("resolveCreatedPublishBatchId", () => {
    it("reads top-level numeric id for navigation", () => {
        assert.equal(
            resolveCreatedPublishBatchId({
                id: 123,
                public_id: "550e8400-e29b-41d4-a716-446655440000",
                review_batch_id: 2,
                mode: "selected",
                total_item_count: 1,
                count_by_family: { places: 1 },
            }),
            "123"
        );
    });

    it("ignores publish_batch_id and nested batch.id when top-level id is missing", () => {
        assert.equal(
            resolveCreatedPublishBatchId({
                publish_batch_id: "42",
                batch: { id: "42", public_id: "pb_42" },
            }),
            null
        );
    });

    it("returns null when id is not numeric", () => {
        assert.equal(resolveCreatedPublishBatchId({ id: "pb_42", message: "ok" }), null);
        assert.equal(resolveCreatedPublishBatchId({ message: "ok", batch: {} }), null);
    });
});
