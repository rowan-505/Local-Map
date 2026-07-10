import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSearchIndexHealthReport, normalizeSearchIndexHealthRow } from "./search-index-health.js";
import {
    clearSearchIndexHealthCache,
    getCachedSearchIndexHealthReport,
    peekSearchIndexHealthCache,
    SEARCH_INDEX_HEALTH_CACHE_TTL_MS,
} from "./search-index-health-cache.js";

function sampleReport() {
    const finishedAt = new Date("2026-07-10T00:00:00.000Z");
    return buildSearchIndexHealthReport(
        [
            normalizeSearchIndexHealthRow({
                entity_family: "places",
                search_entity_type: "place",
                canonical_count: 1n,
                indexed_count: 1n,
                missing_count: 0n,
                ghost_count: 0n,
                stale_count: 0n,
                latest_indexed_at: finishedAt,
                latest_source_updated_at: finishedAt,
            }),
        ],
        {
            latest: {
                id: 1n,
                status: "completed",
                started_at: finishedAt,
                finished_at: finishedAt,
                entity_counts: { place: 1 },
            },
            lastSuccessful: {
                id: 1n,
                status: "completed",
                started_at: finishedAt,
                finished_at: finishedAt,
                entity_counts: { place: 1 },
            },
        },
        { now: new Date("2026-07-10T12:00:00.000Z") },
    );
}

describe("search index health cache", () => {
    it("returns cached report within TTL without re-running loader", async () => {
        clearSearchIndexHealthCache();
        let loads = 0;
        const loader = async () => {
            loads += 1;
            return sampleReport();
        };

        const first = await getCachedSearchIndexHealthReport(loader, { now: 1_000 });
        const second = await getCachedSearchIndexHealthReport(loader, {
            now: 1_000 + SEARCH_INDEX_HEALTH_CACHE_TTL_MS - 1,
        });

        assert.equal(loads, 1);
        assert.equal(first.overall_severity, second.overall_severity);
        assert.ok(peekSearchIndexHealthCache(1_000 + 1_000));
    });

    it("re-runs loader after TTL expires", async () => {
        clearSearchIndexHealthCache();
        let loads = 0;
        const loader = async () => {
            loads += 1;
            return sampleReport();
        };

        await getCachedSearchIndexHealthReport(loader, { now: 5_000 });
        await getCachedSearchIndexHealthReport(loader, {
            now: 5_000 + SEARCH_INDEX_HEALTH_CACHE_TTL_MS + 1,
        });

        assert.equal(loads, 2);
    });

    it("refresh bypasses cached value", async () => {
        clearSearchIndexHealthCache();
        let loads = 0;
        const loader = async () => {
            loads += 1;
            return sampleReport();
        };

        await getCachedSearchIndexHealthReport(loader, { now: 9_000 });
        await getCachedSearchIndexHealthReport(loader, { now: 9_500, refresh: true });

        assert.equal(loads, 2);
    });

    it("does not cache loader failures", async () => {
        clearSearchIndexHealthCache();
        let loads = 0;
        const loader = async () => {
            loads += 1;
            if (loads === 1) {
                throw new Error("db timeout");
            }
            return sampleReport();
        };

        await assert.rejects(() => getCachedSearchIndexHealthReport(loader));
        const recovered = await getCachedSearchIndexHealthReport(loader);
        assert.equal(loads, 2);
        assert.equal(recovered.overall_severity, "healthy");
    });
});
