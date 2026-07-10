import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    resolveSearchAnalyticsRange,
    searchAnalyticsQuerySchema,
} from "./search-analytics-admin.schema.js";
import { SearchAnalyticsAdminService } from "./search-analytics-admin.service.js";

describe("searchAnalyticsQuerySchema", () => {
    it("accepts preset periods", () => {
        assert.equal(searchAnalyticsQuerySchema.safeParse({ period: "7d" }).success, true);
        assert.equal(searchAnalyticsQuerySchema.safeParse({ period: "today" }).success, true);
    });

    it("requires from/to for custom period", () => {
        assert.equal(searchAnalyticsQuerySchema.safeParse({ period: "custom" }).success, false);
        assert.equal(
            searchAnalyticsQuerySchema.safeParse({
                period: "custom",
                from: "2026-07-01T00:00:00.000Z",
                to: "2026-07-10T00:00:00.000Z",
            }).success,
            true,
        );
    });
});

describe("resolveSearchAnalyticsRange", () => {
    it("uses hourly buckets for today", () => {
        const range = resolveSearchAnalyticsRange({ period: "today" });
        assert.equal(range.timeseriesBucket, "hour");
        assert.ok(range.to.getTime() >= range.from.getTime());
        assert.ok(range.previousTo.getTime() === range.from.getTime());
    });
});

describe("SearchAnalyticsAdminService", () => {
    it("computes summary rates from aggregated rows", async () => {
        class MockRepo {
            async getSummary() {
                return {
                    total_searches: 100,
                    zero_result_count: 20,
                    latency_p50_ms: 45,
                    latency_p95_ms: 180,
                    searches_with_click: 35,
                };
            }
            async getTimeseries() {
                return [
                    {
                        bucket: new Date("2026-07-09T00:00:00.000Z"),
                        searches: 50,
                        zero_result_count: 10,
                        latency_p50_ms: 40,
                        latency_p95_ms: 150,
                        click_count: 20,
                    },
                ];
            }
            async getTopSearches() {
                return [
                    {
                        normalized_query: "yangon",
                        search_count: 30,
                        zero_result_count: 2,
                        click_count: 12,
                    },
                ];
            }
            async getTopFailedSearches() {
                return [
                    {
                        normalized_query: "missing",
                        search_count: 8,
                        zero_result_count: 8,
                        click_count: 0,
                    },
                ];
            }
            async getTrendingQueries() {
                return [
                    {
                        normalized_query: "mandalay",
                        current_count: 12,
                        previous_count: 4,
                        growth: 8,
                    },
                ];
            }
            async getTopClickedEntities() {
                return [
                    {
                        entity_type: "place",
                        entity_id: 101n,
                        click_count: 9,
                        display_name: "Yangon International Airport",
                    },
                ];
            }
            async getSearchesByLanguage() {
                return [{ key: "my", count: 60 }, { key: "en", count: 40 }];
            }
            async getSearchesByCategory() {
                return [{ key: "places", count: 70 }, { key: "transport", count: 30 }];
            }
        }

        const service = new SearchAnalyticsAdminService(new MockRepo() as never);
        const result = await service.getDashboard({ period: "7d" });

        assert.equal(result.summary.total_searches, 100);
        assert.equal(result.summary.zero_result_rate, 20);
        assert.equal(result.summary.click_through_rate, 35);
        assert.equal(result.summary.no_click_rate, 65);
        assert.equal(result.top_searches[0]?.normalized_query, "yangon");
        assert.equal(result.top_clicked_entities[0]?.entity_id, "101");
        assert.equal(result.by_language[0]?.key, "my");
    });
});
