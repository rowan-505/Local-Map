import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildFailedSearchAreaContextKey,
    buildFailedSearchDedupeKey,
    buildFailedSearchEntityTypesKey,
    buildFailedSearchLogPayload,
    normalizeFailedSearchQuery,
    shouldRecordFailedSearch,
} from "./failed-search-log.js";
import { resolvePublicSearchFilters } from "./public-search-filters.js";

describe("normalizeFailedSearchQuery", () => {
    it("lowercases, trims, and collapses whitespace", () => {
        assert.equal(normalizeFailedSearchQuery("  Yangon   Airport  "), "yangon airport");
    });
});

describe("buildFailedSearchAreaContextKey", () => {
    it("rounds coordinates to one decimal for coarse context", () => {
        assert.equal(buildFailedSearchAreaContextKey(16.84, 96.173), "16.8,96.2");
    });

    it("returns empty string when location is missing", () => {
        assert.equal(buildFailedSearchAreaContextKey(undefined, undefined), "");
        assert.equal(buildFailedSearchAreaContextKey(Number.NaN, 96.1), "");
    });
});

describe("buildFailedSearchEntityTypesKey", () => {
    it("uses sorted legacy types when provided", () => {
        const filters = resolvePublicSearchFilters({ category: "all" });
        assert.equal(
            buildFailedSearchEntityTypesKey(filters, ["transport_stop", "place"]),
            "place,transport_stop",
        );
    });

    it("falls back to all when no filter is active", () => {
        const filters = resolvePublicSearchFilters({ category: "all" });
        assert.equal(buildFailedSearchEntityTypesKey(filters), "all");
    });

    it("uses category-resolved entity types", () => {
        const filters = resolvePublicSearchFilters({ category: "places" });
        assert.equal(buildFailedSearchEntityTypesKey(filters), "place");
    });
});

describe("buildFailedSearchDedupeKey", () => {
    it("includes query, language, filters, and coarse area", () => {
        const key = buildFailedSearchDedupeKey({
            normalizedQuery: "rgn airport",
            lang: "en",
            category: "places",
            transportType: "all",
            transportMode: "all",
            entityTypesKey: "place",
            areaContextKey: "16.8,96.2",
        });
        assert.equal(key, "rgn airport|en|places|all|all|place|16.8,96.2");
    });
});

describe("buildFailedSearchLogPayload", () => {
    it("builds an aggregate-ready payload without precise coordinates", () => {
        const filters = resolvePublicSearchFilters({
            category: "transport",
            transportType: "routes",
            transportMode: "bus",
        });
        const payload = buildFailedSearchLogPayload({
            q: "  YBS 12 ",
            lang: "my",
            lat: 16.84,
            lng: 96.173,
            filters,
            resultCount: 0,
        });

        assert.equal(payload.normalizedQuery, "ybs 12");
        assert.equal(payload.category, "transport");
        assert.equal(payload.transportType, "routes");
        assert.equal(payload.transportMode, "bus");
        assert.equal(payload.areaContextKey, "16.8,96.2");
        assert.match(payload.dedupeKey, /^ybs 12\|my\|transport\|routes\|bus\|/);
        assert.equal(payload.resultCount, 0);
    });
});

describe("shouldRecordFailedSearch", () => {
    it("records zero-result first-page searches", () => {
        assert.equal(
            shouldRecordFailedSearch({
                normalizedQuery: "missing place",
                resultCount: 0,
                isPaginationContinuation: false,
                searchAllowed: true,
            }),
            true,
        );
    });

    it("skips pagination continuations", () => {
        assert.equal(
            shouldRecordFailedSearch({
                normalizedQuery: "missing place",
                resultCount: 0,
                isPaginationContinuation: true,
                searchAllowed: true,
            }),
            false,
        );
    });

    it("skips blocked or successful searches", () => {
        assert.equal(
            shouldRecordFailedSearch({
                normalizedQuery: "x",
                resultCount: 0,
                isPaginationContinuation: false,
                searchAllowed: false,
            }),
            false,
        );
        assert.equal(
            shouldRecordFailedSearch({
                normalizedQuery: "found",
                resultCount: 3,
                isPaginationContinuation: false,
                searchAllowed: true,
            }),
            false,
        );
    });

    it("skips too-short completed queries", () => {
        assert.equal(
            shouldRecordFailedSearch({
                normalizedQuery: "a",
                resultCount: 0,
                isPaginationContinuation: false,
                searchAllowed: true,
            }),
            false,
        );
    });
});
