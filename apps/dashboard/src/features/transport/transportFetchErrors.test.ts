import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    formatTransportFetchError,
    getTransportFetchErrorDetail,
    isTransportNetworkError,
    REVIEW_READINESS_UNAVAILABLE_MESSAGE,
} from "./transportFetchErrors";

describe("transportFetchErrors", () => {
    it("detects browser failed-to-fetch network errors", () => {
        assert.equal(isTransportNetworkError(new TypeError("Failed to fetch")), true);
    });

    it("formats network errors with a calm readiness message", () => {
        const message = formatTransportFetchError(
            new TypeError("Failed to fetch"),
            "Failed to load review readiness.",
        );
        assert.equal(message, REVIEW_READINESS_UNAVAILABLE_MESSAGE);
        assert.doesNotMatch(message, /Failed to fetch/i);
    });

    it("keeps technical detail for development logs", () => {
        const detail = getTransportFetchErrorDetail(
            new TypeError("Failed to fetch"),
            "Failed to load review readiness.",
        );
        assert.match(detail, /Failed to fetch/i);
    });

    it("returns empty string for abort errors", () => {
        const aborted = new DOMException("Aborted", "AbortError");
        assert.equal(formatTransportFetchError(aborted, "fallback"), "");
    });
});
