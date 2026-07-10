import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    serializePublicSearchHit,
    serializeUnifiedSearchResult,
} from "../public-map/public-map.service.js";
import type { UnifiedSearchRow } from "../public-map/public-map.repo.js";
import {
    explainUnifiedSearchScore,
    UNIFIED_SEARCH_RANKING_WEIGHTS,
} from "../public-map/public-search-ranking.js";
import { SEARCH_ALIAS_TYPES } from "./search-aliases.types.js";

const W = UNIFIED_SEARCH_RANKING_WEIGHTS;

function airportRow(overrides: Partial<UnifiedSearchRow> = {}): UnifiedSearchRow {
    return {
        entity_type: "place",
        entity_id: "101",
        public_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        display_name: "Yangon International Airport",
        subtitle: "Airport",
        primary_name_my: "ရန်ကြည်ပြည်ဆိုင်ရာလေဆိပ်",
        primary_name_en: "Yangon International Airport",
        primary_name_und: null,
        matched_name: "RGN",
        geometry_type: "POINT",
        lng: 96.1332,
        lat: 16.9073,
        min_lng: 96.12,
        min_lat: 16.89,
        max_lng: 96.15,
        max_lat: 16.92,
        has_geometry: true,
        category_code: "airport",
        category_name_my: "လေဆိပ်",
        category_name_en: "Airport",
        admin_area_name_my: "မင်္ဂလာဒုံ",
        admin_area_name_en: "Mingaladon",
        score: 180,
        importance_score: 85,
        is_verified: true,
        confidence_score: 90,
        boundary_confidence_score: 0,
        address_parts: null,
        ...overrides,
    };
}

describe("SEARCH_ALIAS_TYPES", () => {
    it("lists the migration 131 alias_type values", () => {
        assert.deepEqual(SEARCH_ALIAS_TYPES, [
            "common_name",
            "abbreviation",
            "alternative_spelling",
            "old_name",
            "transliteration",
            "local_name",
            "search_correction",
        ]);
    });
});

describe("search alias display vs match", () => {
    it("keeps canonical displayName when matched_name is an alias abbreviation", () => {
        const result = serializeUnifiedSearchResult(airportRow());
        assert.equal(result.displayName, "Yangon International Airport");
        assert.equal(result.matchedName, "RGN");
        assert.equal(result.primaryNameEn, "Yangon International Airport");
    });

    it("resolves Myanmar displayName from primary names, not matched alias", () => {
        const hit = serializePublicSearchHit(
            airportRow({ matched_name: "ရန်ကုန်လေဆိပ်" }),
            "my",
        );
        assert.equal(hit.displayName, "ရန်ကြည်ပြည်ဆိုင်ရာလေဆိပ်");
        assert.notEqual(hit.displayName, "ရန်ကုန်လေဆိပ်");
    });

    it("shows English canonical display when lang=en even if alias matched", () => {
        const hit = serializePublicSearchHit(
            airportRow({ matched_name: "Mingaladon Airport" }),
            "en",
        );
        assert.equal(hit.displayName, "Yangon International Airport");
    });
});

describe("search alias ranking", () => {
    it("scores alias exact matches below primary name exact", () => {
        const aliasOnly = explainUnifiedSearchScore("rgn", "full", {
            displayName: "Yangon International Airport",
            primaryNameEn: "Yangon International Airport",
            aliasExactMatch: true,
            entityType: "place",
            importanceScore: 85,
            confidenceScore: 90,
            isVerified: true,
        });
        const nameExact = explainUnifiedSearchScore("yangon international airport", "full", {
            displayName: "Yangon International Airport",
            entityType: "place",
            importanceScore: 85,
            confidenceScore: 90,
            isVerified: true,
        });

        assert.ok(aliasOnly);
        assert.ok(nameExact);
        assert.equal(aliasOnly.aliasExactMatch, W.aliasExact);
        assert.equal(aliasOnly.exactMatch, 0);
        assert.equal(nameExact.exactMatch, W.nameExact);
        assert.ok(nameExact.finalScore > aliasOnly.finalScore);
    });

    it("treats folded alias text in trigram_text as a strong match path", () => {
        const explanation = explainUnifiedSearchScore("mingaladon airport", "full", {
            displayName: "Yangon International Airport",
            trigramText:
                "yangon international airport mingaladon airport yangon airport rgn",
            trigramSimilarity: 0.55,
            ftsMatches: true,
            entityType: "place",
        });

        assert.ok(explanation);
        assert.equal(explanation.exactMatch, 0);
        assert.ok(explanation.fullText > 0 || explanation.trigram > 0);
    });
});
