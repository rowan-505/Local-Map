import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    compareUnifiedSearchSortKeys,
    publicSearchCursorAfterFromRow,
} from "./public-search-cursor.js";
import type { UnifiedSearchRow } from "./public-map.repo.js";
import {
    computeUnifiedSearchDistanceWeight,
    computeUnifiedSearchEntityTypeWeight,
    computeUnifiedSearchReviewQualityWeight,
    explainUnifiedSearchScore,
    isUnifiedSearchCandidateEligible,
    resolveFuzzySimilarityThreshold,
    sumUnifiedSearchScoreExplanation,
    UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS,
    UNIFIED_SEARCH_FUZZY_THRESHOLDS,
    UNIFIED_SEARCH_RANKING_WEIGHTS,
    UNIFIED_SEARCH_REVIEW_QUALITY_WEIGHTS,
} from "./public-search-ranking.js";

const W = UNIFIED_SEARCH_RANKING_WEIGHTS;

function score(
    qNorm: string,
    mode: "prefix" | "full",
    doc: Parameters<typeof explainUnifiedSearchScore>[2],
) {
    const explanation = explainUnifiedSearchScore(qNorm, mode, doc);
    assert.ok(explanation, "expected candidate to be eligible");
    return explanation;
}

describe("resolveFuzzySimilarityThreshold", () => {
    it("uses stricter thresholds for shorter queries", () => {
        assert.equal(resolveFuzzySimilarityThreshold("ky", "prefix"), 1);
        assert.equal(resolveFuzzySimilarityThreshold("kya", "full"), UNIFIED_SEARCH_FUZZY_THRESHOLDS.short);
        assert.equal(resolveFuzzySimilarityThreshold("kyauk", "full"), UNIFIED_SEARCH_FUZZY_THRESHOLDS.medium);
        assert.equal(resolveFuzzySimilarityThreshold("kyaukse", "full"), UNIFIED_SEARCH_FUZZY_THRESHOLDS.long);
    });
});

describe("explainUnifiedSearchScore", () => {
    it("explains an exact name match", () => {
        const explanation = score("yangon", "full", {
            displayName: "Yangon",
            importanceScore: 30,
            confidenceScore: 60,
            isVerified: true,
            entityType: "place",
        });

        assert.equal(explanation.codeMatch, 0);
        assert.equal(explanation.exactMatch, W.nameExact);
        assert.equal(explanation.prefixMatch, W.prefix);
        assert.equal(explanation.entityTypeWeight, UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.place);
        assert.equal(explanation.verificationWeight, W.verified);
        assert.equal(explanation.importanceWeight, 30 * W.importanceMultiplier);
        assert.equal(explanation.confidenceWeight, 60 * W.confidenceMultiplier);
        assert.equal(
            explanation.finalScore,
            sumUnifiedSearchScoreExplanation(explanation),
        );
    });

    it("rejects fuzzy-only matches below the similarity threshold", () => {
        const explanation = explainUnifiedSearchScore("kyauk", "full", {
            displayName: "Regional Office Near Kyauk",
            trigramText: "regional office near kyauk township",
            trigramSimilarity: 0.18,
            ftsMatches: false,
        });

        assert.equal(explanation, null);
        assert.equal(
            isUnifiedSearchCandidateEligible("kyauk", "full", {
                trigramSimilarity: 0.18,
            }),
            false,
        );
    });

    it("explains a fuzzy trigram match above the threshold", () => {
        const explanation = score("kyauk", "full", {
            displayName: "Regional Office Near Kyauk",
            trigramText: "regional office near kyauk township",
            trigramSimilarity: 0.42,
            ftsMatches: false,
            entityType: "transport_stop",
        });

        assert.equal(explanation.exactMatch, 0);
        assert.equal(explanation.prefixMatch, 0);
        assert.equal(explanation.trigram, 0.42 * W.trigramMultiplier);
        assert.equal(explanation.entityTypeWeight, UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.transport_stop);
    });

    it("explains a verified result verification boost", () => {
        const verified = score("market", "full", {
            displayName: "Central Market",
            trigramSimilarity: 0.5,
            isVerified: true,
            reviewStatus: "verified",
        });
        const unverified = score("market", "full", {
            displayName: "Central Market",
            trigramSimilarity: 0.5,
            isVerified: false,
            reviewStatus: "needs_review",
        });

        assert.equal(verified.verificationWeight, W.verified);
        assert.equal(unverified.verificationWeight, 0);
        assert.ok(verified.finalScore > unverified.finalScore);
    });

    it("applies a mild needs_review penalty", () => {
        const explanation = score("insein", "full", {
            displayName: "Insein",
            entityType: "transport_stop",
            reviewStatus: "needs_review",
            trigramSimilarity: 0.55,
            confidenceScore: 40,
            isVerified: false,
        });

        assert.equal(
            explanation.reviewQualityWeight,
            UNIFIED_SEARCH_REVIEW_QUALITY_WEIGHTS.needs_review,
        );
    });

    it("scales distance lower for weak fuzzy-only matches", () => {
        const strong = score("stop", "full", {
            displayName: "Stop",
            trigramSimilarity: 0.5,
            distanceMeters: 500,
        });
        const weak = score("stop", "full", {
            displayName: "Regional Office Near Stop",
            trigramSimilarity: 0.5,
            distanceMeters: 500,
        });

        assert.ok(strong.distanceWeight > weak.distanceWeight);
    });

    it("keeps distant exact matches discoverable with a small distance bonus", () => {
        const far = score("kyaukse", "full", {
            displayName: "Kyaukse",
            entityType: "admin_area",
            distanceMeters: 250_000,
        });

        assert.equal(far.exactMatch, W.nameExact);
        assert.ok(far.distanceWeight > 0);
        assert.ok(far.distanceWeight < 0.01);
        assert.ok(far.finalScore > W.nameExact);
    });

    it("drops fuzzy and FTS contributions in prefix mode", () => {
        const explanation = score("ya", "prefix", {
            displayName: "Yangon",
            trigramSimilarity: 0.9,
            ftsMatches: true,
            allTokensMatch: true,
        });

        assert.equal(explanation.fullText, 0);
        assert.equal(explanation.trigram, 0);
        assert.equal(explanation.multiToken, 0);
        assert.equal(explanation.exactMatch, 0);
        assert.equal(explanation.prefixMatch, W.prefix);
    });

    it("includes code exact match separately from name exact match", () => {
        const explanation = score("ybs-12", "full", {
            code: "YBS-12",
            displayName: "Route 12",
            entityType: "transport_route",
        });

        assert.equal(explanation.codeMatch, W.codeExact);
        assert.equal(explanation.exactMatch, 0);
    });

    it("finalScore equals the sum of all components", () => {
        const explanation = score("lashio muse", "full", {
            displayName: "Lashio - Muse",
            trigramSimilarity: 0.35,
            ftsMatches: true,
            allTokensMatch: true,
            importanceScore: 12,
            confidenceScore: 55,
            isVerified: true,
            distanceMeters: 8_000,
            entityType: "transport_route",
            reviewStatus: "reviewed",
        });

        assert.equal(
            explanation.finalScore,
            explanation.codeMatch +
                explanation.exactMatch +
                explanation.aliasExactMatch +
                explanation.prefixMatch +
                explanation.fullText +
                explanation.trigram +
                explanation.multiToken +
                explanation.entityTypeWeight +
                explanation.reviewQualityWeight +
                explanation.verificationWeight +
                explanation.importanceWeight +
                explanation.confidenceWeight +
                explanation.distanceWeight,
        );
    });
});

describe("conservative ranking scenarios", () => {
    it("ranks kyaukse district above an ordinary fuzzy stop", () => {
        const district = score("kyaukse", "full", {
            displayName: "Kyaukse Township",
            entityType: "admin_area",
            trigramSimilarity: 0.45,
            importanceScore: 20,
            isVerified: true,
        });
        const fuzzyStop = score("kyaukse", "full", {
            displayName: "Rural Stop Near Kyaukse Road",
            entityType: "transport_stop",
            trigramSimilarity: 0.28,
            reviewStatus: "needs_review",
        });

        assert.ok(district.finalScore > fuzzyStop.finalScore);
    });

    it("ranks an exact stop query by exact text, not only entity weight", () => {
        const exactStop = score("insein", "full", {
            displayName: "Insein",
            entityType: "transport_stop",
            trigramSimilarity: 0.7,
            reviewStatus: "reviewed",
        });
        const fuzzyPlace = score("insein", "full", {
            displayName: "Near Insein Junction",
            entityType: "place",
            trigramSimilarity: 0.32,
            importanceScore: 40,
        });

        assert.ok(exactStop.exactMatch === W.nameExact);
        assert.ok(exactStop.finalScore > fuzzyPlace.finalScore);
    });

    it("ranks an exact route code above a fuzzy route-name match", () => {
        const exactCode = score("ybs-36", "full", {
            code: "YBS-36",
            displayName: "Downtown Loop",
            entityType: "transport_route",
            trigramSimilarity: 0.2,
        });
        const fuzzyName = score("ybs-36", "full", {
            displayName: "YBS 36 Downtown",
            entityType: "transport_route",
            trigramSimilarity: 0.31,
        });

        assert.ok(exactCode.finalScore > fuzzyName.finalScore);
    });

    it("prefers a nearby strong match over a distant weak fuzzy match", () => {
        const nearbyStrong = score("market", "full", {
            displayName: "Market",
            entityType: "place",
            trigramSimilarity: 0.55,
            distanceMeters: 800,
        });
        const distantWeak = score("market", "full", {
            displayName: "Old Market Road Corner",
            entityType: "transport_stop",
            trigramSimilarity: 0.27,
            distanceMeters: 180_000,
        });

        assert.ok(nearbyStrong.finalScore > distantWeak.finalScore);
    });

    it("prefers verified over needs_review for similar text", () => {
        const verified = score("sule", "full", {
            displayName: "Sule",
            entityType: "transport_stop",
            trigramSimilarity: 0.5,
            reviewStatus: "verified",
            isVerified: true,
        });
        const unreviewed = score("sule", "full", {
            displayName: "Sule",
            entityType: "transport_stop",
            trigramSimilarity: 0.5,
            reviewStatus: "needs_review",
            isVerified: false,
        });

        assert.ok(verified.finalScore > unreviewed.finalScore);
    });

    it("uses a stricter threshold for short queries", () => {
        assert.equal(
            isUnifiedSearchCandidateEligible("ky", "full", { trigramSimilarity: 0.3 }),
            false,
        );
        assert.equal(
            isUnifiedSearchCandidateEligible("ky", "full", { trigramSimilarity: 0.4 }),
            true,
        );
    });

    it("keeps Myanmar multi-token queries eligible without fuzzy similarity", () => {
        const explanation = score("အင်းစိန် ဘုရင့်နောင်", "full", {
            displayName: "ဘုရင့်နောင်လမ်း",
            trigramSimilarity: 0.1,
            allTokensMatch: true,
            entityType: "street_group",
        });

        assert.equal(explanation.multiToken, W.multiToken);
        assert.ok(explanation.finalScore >= W.multiToken + UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.street_group);
    });

    it("keeps pagination stable across equal scores via tie-breakers", () => {
        const rowA = publicSearchCursorAfterFromRow({
            score: 150,
            importance_score: 10,
            display_name: "Alpha",
            entity_type: "place",
            entity_id: "10",
        } as UnifiedSearchRow);
        const rowB = publicSearchCursorAfterFromRow({
            score: 150,
            importance_score: 10,
            display_name: "Beta",
            entity_type: "place",
            entity_id: "11",
        } as UnifiedSearchRow);

        assert.ok(compareUnifiedSearchSortKeys(rowA, rowB) < 0);
        assert.ok(compareUnifiedSearchSortKeys(rowB, rowA) > 0);
    });
});

describe("entity and review helpers", () => {
    it("weights stations above ordinary stops", () => {
        assert.ok(
            computeUnifiedSearchEntityTypeWeight("transport_stop", "station") >
                computeUnifiedSearchEntityTypeWeight("transport_stop", "stop"),
        );
    });

    it("penalizes imported_unreviewed rows if they appear", () => {
        assert.equal(
            computeUnifiedSearchReviewQualityWeight({
                reviewStatus: "imported_unreviewed",
            }),
            UNIFIED_SEARCH_REVIEW_QUALITY_WEIGHTS.imported_unreviewed,
        );
    });
});

describe("computeUnifiedSearchDistanceWeight", () => {
    it("returns 0 without a reference distance", () => {
        assert.equal(computeUnifiedSearchDistanceWeight(null, true), 0);
        assert.equal(computeUnifiedSearchDistanceWeight(undefined, false), 0);
    });

    it("uses the same decay constants as SQL ranking", () => {
        assert.equal(computeUnifiedSearchDistanceWeight(0, true), W.distanceMax);
        const at5km = computeUnifiedSearchDistanceWeight(5_000, true);
        assert.ok(Math.abs(at5km - W.distanceMax * Math.exp(-1)) < 0.001);
    });

    it("reduces weak-text distance contribution", () => {
        const strong = computeUnifiedSearchDistanceWeight(1_000, true);
        const weak = computeUnifiedSearchDistanceWeight(1_000, false);
        assert.ok(weak < strong);
        assert.ok(Math.abs(weak - strong * W.distanceWeakTextMultiplier) < 0.001);
    });
});

describe("old vs new ranking examples", () => {
    it("documents representative score shifts", () => {
        const doc = {
            displayName: "Kyaukse Township",
            entityType: "admin_area",
            trigramSimilarity: 0.45,
            importanceScore: 20,
            isVerified: true,
            distanceMeters: 120_000,
        };

        const oldStyle = {
            prefixMatch: W.prefix,
            trigram: 0.45 * W.trigramMultiplier,
            verificationWeight: W.verified,
            importanceWeight: 20 * W.importanceMultiplier,
            distanceWeight: computeUnifiedSearchDistanceWeight(120_000, true),
            entityTypeWeight: 0,
            reviewQualityWeight: 0,
        };
        const oldTotal =
            oldStyle.prefixMatch +
            oldStyle.trigram +
            oldStyle.verificationWeight +
            oldStyle.importanceWeight +
            oldStyle.distanceWeight;

        const updated = score("kyaukse", "full", doc);

        assert.equal(updated.entityTypeWeight, UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.admin_area);
        assert.equal(updated.reviewQualityWeight, UNIFIED_SEARCH_REVIEW_QUALITY_WEIGHTS.verifiedPlaceFallback);
        assert.ok(updated.finalScore > oldTotal);
    });
});
