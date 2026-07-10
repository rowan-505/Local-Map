import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSearchOverviewSchema } from "./search-overview.openapi.js";
import type { SearchOverviewCounts, SearchOverviewRepository } from "./search-overview.repo.js";
import { SearchOverviewService } from "./search-overview.service.js";

class MockSearchOverviewRepository {
    constructor(private readonly counts: SearchOverviewCounts) {}

    async getCounts(): Promise<SearchOverviewCounts> {
        return this.counts;
    }
}

function createService(counts: SearchOverviewCounts, severity: "healthy" | "warning" | "critical") {
    return new SearchOverviewService(
        new MockSearchOverviewRepository(counts) as unknown as SearchOverviewRepository,
        {} as never,
        async () => ({ overall_severity: severity }),
    );
}

describe("SearchOverviewService", () => {
    it("returns valid zero-alias overview counts", async () => {
        const result = await createService(
            {
                total_search_documents: 0,
                total_aliases: 0,
                active_aliases: 0,
                unresolved_failed_searches: 0,
                today_searches: 0,
            },
            "healthy",
        ).getOverview();

        assert.deepEqual(result, {
            total_search_documents: 0,
            total_aliases: 0,
            active_aliases: 0,
            unresolved_failed_searches: 0,
            today_searches: 0,
            overall_index_health_severity: "healthy",
        });
    });

    it("returns alias, failed-search, analytics, and health summary counts", async () => {
        const result = await createService(
            {
                total_search_documents: 28977,
                total_aliases: 12,
                active_aliases: 9,
                unresolved_failed_searches: 3,
                today_searches: 44,
            },
            "critical",
        ).getOverview();

        assert.equal(result.total_search_documents, 28977);
        assert.equal(result.total_aliases, 12);
        assert.equal(result.active_aliases, 9);
        assert.equal(result.unresolved_failed_searches, 3);
        assert.equal(result.today_searches, 44);
        assert.equal(result.overall_index_health_severity, "critical");
    });
});

describe("getSearchOverviewSchema", () => {
    it("documents the lightweight overview response contract", () => {
        const response = getSearchOverviewSchema.response[200];
        assert.deepEqual(response.required, [
            "total_search_documents",
            "total_aliases",
            "active_aliases",
            "unresolved_failed_searches",
            "today_searches",
            "overall_index_health_severity",
        ]);
        assert.equal(response.additionalProperties, false);
    });
});
