import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasStopMergeDirectionUsageMismatch } from "./stopMergeDirectionWarning.js";

describe("hasStopMergeDirectionUsageMismatch", () => {
    it("warns on inbound-only vs outbound-only usage", () => {
        assert.equal(
            hasStopMergeDirectionUsageMismatch(
                {
                    inboundCount: 2,
                    outboundCount: 0,
                    clockwiseCount: 0,
                    anticlockwiseCount: 0,
                },
                {
                    inboundCount: 0,
                    outboundCount: 1,
                    clockwiseCount: 0,
                    anticlockwiseCount: 0,
                },
            ),
            true,
        );
    });

    it("does not warn when both stops share outbound usage", () => {
        assert.equal(
            hasStopMergeDirectionUsageMismatch(
                {
                    inboundCount: 0,
                    outboundCount: 1,
                    clockwiseCount: 0,
                    anticlockwiseCount: 0,
                },
                {
                    inboundCount: 0,
                    outboundCount: 2,
                    clockwiseCount: 0,
                    anticlockwiseCount: 0,
                },
            ),
            false,
        );
    });
});
