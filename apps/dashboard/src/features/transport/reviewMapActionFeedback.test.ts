import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    formatReviewMapStopActionError,
    formatTransportStopMergeErrorOverlay,
} from "./reviewMapActionFeedback.js";

describe("formatReviewMapStopActionError", () => {
    it("maps route-usage conflicts to friendly copy", () => {
        const message = formatReviewMapStopActionError(
            new Error("409: Stop is still used by routes. Remove it from all routes first."),
        );
        assert.match(message, /still used on routes/i);
    });

    it("maps network failures to friendly copy", () => {
        const message = formatReviewMapStopActionError(new TypeError("Failed to fetch"));
        assert.match(message, /could not reach the api/i);
    });
});

describe("formatTransportStopMergeErrorOverlay", () => {
    it("maps same-variant acknowledgment requirement and includes not-applied note", () => {
        const message = formatTransportStopMergeErrorOverlay(
            new Error(
                "Both stops occur in the same variant. After merge, that physical stop will appear multiple times in the sequence.",
            ),
        );
        assert.match(message, /multiple times in the same variant sequence/i);
        assert.match(message, /not applied/i);
    });

    it("maps legacy variant conflict copy and includes not-applied note", () => {
        const message = formatTransportStopMergeErrorOverlay(
            new Error("Cannot merge stops that both appear on the same route variant."),
        );
        assert.match(message, /same route variant/i);
        assert.match(message, /not applied/i);
    });

    it("does not expose raw database errors", () => {
        const message = formatTransportStopMergeErrorOverlay(
            new Error('duplicate key value violates unique constraint "stops_pkey"'),
        );
        assert.equal(message.includes("stops_pkey"), false);
        assert.match(message, /could not be completed/i);
    });
});
