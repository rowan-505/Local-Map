import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    publishBatchLifecycleErrorFromValidation,
    PUBLISH_BATCH_NOT_BATCHED_LIFECYCLE_MESSAGE,
} from "./publishBatchLifecycleErrors";

describe("publishBatchLifecycleErrors", () => {
    it("maps not_batched to lifecycle repair message", () => {
        assert.equal(
            publishBatchLifecycleErrorFromValidation(
                "not_batched",
                "Candidate must be promotion_status=batched before validation."
            ),
            PUBLISH_BATCH_NOT_BATCHED_LIFECYCLE_MESSAGE
        );
    });

    it("passes through other validation messages", () => {
        assert.equal(
            publishBatchLifecycleErrorFromValidation("missing_road_class", "Road class is required."),
            "Road class is required."
        );
    });
});
