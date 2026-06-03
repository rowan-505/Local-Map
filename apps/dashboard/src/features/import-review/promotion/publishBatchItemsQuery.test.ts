import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildPublishBatchFailedItemsQuery,
    IMPORT_REVIEW_PUBLISH_BATCH_FAILED_ITEMS_LIMIT,
} from "./publishBatchItemsQuery";

describe("buildPublishBatchFailedItemsQuery", () => {
    it("uses publish_status failed within API max limit", () => {
        const q = buildPublishBatchFailedItemsQuery();
        assert.equal(q.publish_status, "failed");
        assert.equal(q.status, undefined);
        assert.equal(q.limit, IMPORT_REVIEW_PUBLISH_BATCH_FAILED_ITEMS_LIMIT);
        assert.equal(q.limit, 200);
        assert.equal(q.offset, 0);
    });
});
