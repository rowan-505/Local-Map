import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    resolveSearchAnalyticsRange,
    searchAnalyticsQuerySchema,
} from "./search-analytics-admin.schema.js";
import {
    formatClickedEntityLabel,
    roundAnalyticsRate,
    toAnalyticsEntityIdString,
} from "./search-analytics-admin.serialization.js";
import {
    SearchAnalyticsAdminService,
    serializeClickedEntities,
    type SearchAnalyticsDashboardDto,
} from "./search-analytics-admin.service.js";

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

describe("search analytics serialization", () => {
    it("converts bigint entity ids to strings", () => {
        assert.equal(toAnalyticsEntityIdString(101n), "101");
        assert.equal(toAnalyticsEntityIdString(null), "");
    });

    it("formats fallback labels when display name is missing", () => {
        assert.equal(
            formatClickedEntityLabel("street_group", "42", null),
            "Street group #42",
        );
        assert.equal(
            formatClickedEntityLabel("place", "7", "  "),
            "Place #7",
        );
    });

    it("returns zero rates when denominator is zero", () => {
        assert.equal(roundAnalyticsRate(5, 0), 0);
    });

    it("serializes clicked entities with stable DTO fields", () => {
        const rows = serializeClickedEntities([
            {
                entity_type: "admin_area",
                entity_id: 9001n,
                click_count: 4,
                display_name: "Kyauktan",
            },
            {
                entity_type: "street_group",
                entity_id: 55n,
                click_count: 2,
                display_name: null,
            },
        ]);

        assert.equal(rows.length, 2);
        assert.equal(rows[0]?.entity_id, "9001");
        assert.equal(rows[0]?.display_name, "Kyauktan");
        assert.equal(rows[0]?.label, "Kyauktan");
        assert.equal(rows[0]?.click_count, 4);
        assert.equal(rows[1]?.entity_id, "55");
        assert.equal(rows[1]?.display_name, null);
        assert.equal(rows[1]?.label, "Street group #55");
    });

    it("drops clicked entities without a valid entity id", () => {
        const rows = serializeClickedEntities([
            {
                entity_type: "place",
                entity_id: null as unknown as bigint,
                click_count: 1,
                display_name: null,
            },
        ]);
        assert.deepEqual(rows, []);
    });
});

function assertDashboardDtoShape(result: SearchAnalyticsDashboardDto) {
    assert.ok(result.range.from);
    assert.ok(result.range.to);
    assert.equal(typeof result.summary.total_searches, "number");
    assert.ok(result.summary.latency_p50_ms === null || typeof result.summary.latency_p50_ms === "number");
    assert.ok(Array.isArray(result.top_clicked_entities));
    for (const row of result.top_clicked_entities) {
        assert.equal(typeof row.entity_type, "string");
        assert.equal(typeof row.entity_id, "string");
        assert.ok(row.entity_id.length > 0);
        assert.ok(row.display_name === null || typeof row.display_name === "string");
        assert.equal(typeof row.click_count, "number");
        assert.equal(typeof row.label, "string");
        assert.ok(row.label.length > 0);
    }
    for (const row of result.top_searches) {
        assert.equal(typeof row.normalized_query, "string");
        assert.equal(typeof row.search_count, "number");
    }
    for (const row of result.by_language) {
        assert.equal(typeof row.key, "string");
        assert.equal(typeof row.count, "number");
    }
}

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
        assert.equal(result.top_clicked_entities[0]?.label, "Yangon International Airport");
        assert.equal(result.by_language[0]?.key, "my");
        assertDashboardDtoShape(result);
    });

    it("returns empty analytics with null latency percentiles", async () => {
        class EmptyRepo {
            async getSummary() {
                return {
                    total_searches: 0,
                    zero_result_count: 0,
                    latency_p50_ms: null,
                    latency_p95_ms: null,
                    searches_with_click: 0,
                };
            }
            async getTimeseries() {
                return [];
            }
            async getTopSearches() {
                return [];
            }
            async getTopFailedSearches() {
                return [];
            }
            async getTrendingQueries() {
                return [];
            }
            async getTopClickedEntities() {
                return [];
            }
            async getSearchesByLanguage() {
                return [];
            }
            async getSearchesByCategory() {
                return [];
            }
        }

        const service = new SearchAnalyticsAdminService(new EmptyRepo() as never);
        const result = await service.getDashboard({ period: "7d" });

        assert.equal(result.summary.total_searches, 0);
        assert.equal(result.summary.zero_result_rate, 0);
        assert.equal(result.summary.click_through_rate, 0);
        assert.equal(result.summary.latency_p50_ms, null);
        assert.equal(result.summary.latency_p95_ms, null);
        assert.deepEqual(result.top_clicked_entities, []);
        assertDashboardDtoShape(result);
    });

    it("handles deleted entities with missing display names", async () => {
        class DeletedEntityRepo {
            async getSummary() {
                return {
                    total_searches: 10,
                    zero_result_count: 0,
                    latency_p50_ms: 30,
                    latency_p95_ms: 90,
                    searches_with_click: 3,
                };
            }
            async getTimeseries() {
                return [];
            }
            async getTopSearches() {
                return [];
            }
            async getTopFailedSearches() {
                return [];
            }
            async getTrendingQueries() {
                return [];
            }
            async getTopClickedEntities() {
                return [
                    {
                        entity_type: "place",
                        entity_id: 99999n,
                        click_count: 1,
                        display_name: null,
                    },
                ];
            }
            async getSearchesByLanguage() {
                return [];
            }
            async getSearchesByCategory() {
                return [];
            }
        }

        const service = new SearchAnalyticsAdminService(new DeletedEntityRepo() as never);
        const result = await service.getDashboard({ period: "7d" });

        assert.equal(result.top_clicked_entities[0]?.entity_id, "99999");
        assert.equal(result.top_clicked_entities[0]?.display_name, null);
        assert.equal(result.top_clicked_entities[0]?.label, "Place #99999");
        assert.equal(result.top_clicked_entities[0]?.click_count, 1);
    });
});
