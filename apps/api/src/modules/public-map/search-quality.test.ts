import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnifiedSearchRow } from "./public-map.repo.js";
import { buildPublicSearchPage } from "./public-map.service.js";
import {
    decodePublicSearchCursor,
    isUnifiedSearchRowAfterCursor,
    normalizePublicSearchCursorContext,
    publicSearchCursorAfterFromRow,
} from "./public-search-cursor.js";
import { resolvePublicSearchFilters } from "./public-search-filters.js";
import { resolvePublicSearchDisplayName } from "./public-search-language.js";
import { GOLDEN_SEARCH_QUERY_SCENARIOS } from "./search-quality-golden-queries.js";
import {
    assertGoldenSearchScenario,
    assertNoDuplicateGoldenResultIds,
    rankGoldenSearchCandidates,
} from "./search-quality-golden.js";

function makeUnifiedRow(overrides: Partial<UnifiedSearchRow> = {}): UnifiedSearchRow {
    return {
        entity_type: "place",
        entity_id: "1",
        public_id: "11111111-1111-1111-1111-111111111111",
        display_name: "Alpha",
        subtitle: null,
        primary_name_my: null,
        primary_name_en: "Alpha",
        primary_name_und: null,
        matched_name: null,
        geometry_type: "POINT",
        lng: 96.1,
        lat: 16.8,
        min_lng: null,
        min_lat: null,
        max_lng: null,
        max_lat: null,
        has_geometry: true,
        category_code: null,
        category_name_my: null,
        category_name_en: null,
        admin_area_name_my: null,
        admin_area_name_en: null,
        score: 100,
        importance_score: 10,
        is_verified: false,
        confidence_score: 0,
        boundary_confidence_score: 0,
        address_parts: null,
        ...overrides,
    };
}

describe("golden public search queries", () => {
    for (const scenario of GOLDEN_SEARCH_QUERY_SCENARIOS) {
        it(scenario.name, () => {
            assertGoldenSearchScenario(scenario);
        });
    }
});

describe("golden search cross-cutting behavior", () => {
    it("excludes inactive ghost rows from ranked results", () => {
        const results = rankGoldenSearchCandidates("yangon", [
            {
                id: "live",
                entityType: "admin_area",
                entityId: "1",
                displayName: "Yangon Region",
                doc: {
                    displayName: "Yangon Region",
                    entityType: "admin_area",
                    trigramSimilarity: 0.5,
                },
            },
            {
                id: "ghost",
                entityType: "transport_stop",
                entityId: "2",
                displayName: "Ghost Stop",
                excludedFromResults: true,
                doc: {
                    displayName: "Ghost Stop",
                    entityType: "transport_stop",
                    trigramSimilarity: 0.99,
                },
            },
        ]);

        assert.equal(results.some((row) => row.id === "ghost"), false);
    });

    it("does not return duplicate entity ids in ranked output", () => {
        const results = rankGoldenSearchCandidates("market", [
            {
                id: "a",
                entityType: "place",
                entityId: "10",
                displayName: "Market",
                doc: { displayName: "Market", trigramSimilarity: 0.5 },
            },
            {
                id: "b",
                entityType: "place",
                entityId: "10",
                displayName: "Market Duplicate",
                doc: { displayName: "Market Duplicate", trigramSimilarity: 0.49 },
            },
        ]);

        assertNoDuplicateGoldenResultIds(results);
    });

    it("applies transport route filter chips", () => {
        const filters = resolvePublicSearchFilters({
            category: "transport",
            transportType: "routes",
        });
        const results = rankGoldenSearchCandidates(
            "ybs",
            [
                {
                    id: "route",
                    entityType: "transport_route",
                    entityId: "1",
                    displayName: "YBS 36",
                    transportMode: "bus",
                    doc: {
                        displayName: "YBS 36",
                        entityType: "transport_route",
                        trigramSimilarity: 0.4,
                    },
                },
                {
                    id: "stop",
                    entityType: "transport_stop",
                    entityId: "2",
                    displayName: "YBS Stop",
                    stopType: "stop",
                    doc: {
                        displayName: "YBS Stop",
                        entityType: "transport_stop",
                        trigramSimilarity: 0.45,
                    },
                },
            ],
            { filters },
        );

        assert.deepEqual(results.map((row) => row.id), ["route"]);
    });

    it("prefers myanmar display label when lang=my", () => {
        const label = resolvePublicSearchDisplayName("my", {
            displayName: "Fallback",
            primaryNameMy: "ရန်ကုန်",
            primaryNameEn: "Yangon",
        });
        assert.equal(label, "ရန်ကုန်");
    });

    it("prefers english display label when lang=en", () => {
        const label = resolvePublicSearchDisplayName("en", {
            displayName: "Fallback",
            primaryNameMy: "ရန်ကုန်",
            primaryNameEn: "Yangon",
        });
        assert.equal(label, "Yangon");
    });

    it("keeps pagination stable across equal scores", () => {
        const ctx = normalizePublicSearchCursorContext({
            q: "alpha",
            mode: "full",
            types: ["place"],
            lang: "en",
        });
        const rows = [
            makeUnifiedRow({
                entity_id: "10",
                display_name: "Alpha",
                score: 120,
                importance_score: 8,
            }),
            makeUnifiedRow({
                entity_id: "11",
                display_name: "Beta",
                score: 120,
                importance_score: 8,
            }),
            makeUnifiedRow({
                entity_id: "12",
                display_name: "Gamma",
                score: 110,
                importance_score: 8,
            }),
        ];

        const first = buildPublicSearchPage(rows, 2, ctx);
        assert.equal(first.items.length, 2);
        assert.ok(first.nextCursor);

        const decoded = decodePublicSearchCursor(first.nextCursor!);
        const remaining = rows.filter((row) =>
            isUnifiedSearchRowAfterCursor(publicSearchCursorAfterFromRow(row), decoded.after),
        );
        const second = buildPublicSearchPage(remaining, 2, ctx);

        assert.equal((second.items[0] as { entityId: string }).entityId, "12");
        assert.equal((first.items[1] as { entityId: string }).entityId, "11");
    });
});
