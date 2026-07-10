import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildSearchRequestAnalyticsPayload,
    clampSearchResultClickRank,
    clampTimeToClickMs,
    isSearchAnalyticsCorrelationId,
    normalizeSearchAnalyticsSessionKey,
    shouldRecordSearchRequestAnalytics,
} from "./search-analytics.js";
import { resolvePublicSearchFilters } from "./public-search-filters.js";

describe("normalizeSearchAnalyticsSessionKey", () => {
    it("trims and accepts short anonymous ids", () => {
        assert.equal(normalizeSearchAnalyticsSessionKey("  anon-123  "), "anon-123");
    });

    it("rejects empty or oversized values", () => {
        assert.equal(normalizeSearchAnalyticsSessionKey(""), null);
        assert.equal(normalizeSearchAnalyticsSessionKey("x".repeat(129)), null);
    });
});

describe("shouldRecordSearchRequestAnalytics", () => {
    it("records first-page meaningful searches", () => {
        assert.equal(
            shouldRecordSearchRequestAnalytics({
                normalizedQuery: "yangon airport",
                isPaginationContinuation: false,
                searchAllowed: true,
            }),
            true,
        );
    });

    it("skips pagination and blocked queries", () => {
        assert.equal(
            shouldRecordSearchRequestAnalytics({
                normalizedQuery: "yangon",
                isPaginationContinuation: true,
                searchAllowed: true,
            }),
            false,
        );
        assert.equal(
            shouldRecordSearchRequestAnalytics({
                normalizedQuery: "a",
                isPaginationContinuation: false,
                searchAllowed: true,
            }),
            false,
        );
    });
});

describe("buildSearchRequestAnalyticsPayload", () => {
    it("builds compact request telemetry without location", () => {
        const filters = resolvePublicSearchFilters({
            category: "transport",
            transportType: "routes",
            transportMode: "bus",
        });
        const payload = buildSearchRequestAnalyticsPayload(
            {
                q: "  YBS 12 ",
                lang: "my",
                filters,
                resultCount: 4,
                latencyMs: 42.8,
                sessionKey: "anon-1",
                isPaginationContinuation: false,
                searchAllowed: true,
            },
            "11111111-1111-4111-8111-111111111111",
        );

        assert.equal(payload.correlationId, "11111111-1111-4111-8111-111111111111");
        assert.equal(payload.normalizedQuery, "ybs 12");
        assert.equal(payload.category, "transport");
        assert.equal(payload.transportMode, "bus");
        assert.equal(payload.resultCount, 4);
        assert.equal(payload.latencyMs, 43);
        assert.equal(payload.sessionKey, "anon-1");
    });
});

describe("click helpers", () => {
    it("validates correlation ids", () => {
        assert.equal(isSearchAnalyticsCorrelationId("11111111-1111-4111-8111-111111111111"), true);
        assert.equal(isSearchAnalyticsCorrelationId("not-a-uuid"), false);
    });

    it("clamps rank and time_to_click", () => {
        assert.equal(clampSearchResultClickRank(0), 1);
        assert.equal(clampSearchResultClickRank(999), 100);
        assert.equal(clampTimeToClickMs(-5), null);
        assert.equal(clampTimeToClickMs(1_800_000), 1_800_000);
        assert.equal(clampTimeToClickMs(9_999_999), 1_800_000);
    });
});
