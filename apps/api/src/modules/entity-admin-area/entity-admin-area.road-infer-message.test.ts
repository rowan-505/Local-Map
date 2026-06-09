import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildRoadTownshipInferMessage,
    resolveRoadTownshipRecommendationMode,
} from "./entity-admin-area.road-infer-message.js";
import type { RoadTownshipRecommendationResult } from "./entity-admin-area.road-township-recommend.js";

function match(id: bigint, name: string, overlapM: number, overlapPct: number | null = null) {
    return {
        id,
        canonical_name: name,
        name_mm: null,
        name_en: name,
        admin_level_code: "township",
        overlap_m: overlapM,
        overlap_pct: overlapPct,
    };
}

describe("resolveRoadTownshipRecommendationMode", () => {
    it("returns multi_overlap when multiple intersecting townships exist", () => {
        const recommendation: RoadTownshipRecommendationResult = {
            recommended: match(1n, "A", 100, 0.6),
            matches: [match(1n, "A", 100, 0.6), match(2n, "B", 40, 0.24)],
            commonParent: null,
            fallback_reason: null,
            distance_m: null,
            nearest_unfiltered_distance_m: null,
            debugReason: null,
            road_length_m: 166,
            geometry_intersects: true,
        };
        assert.equal(resolveRoadTownshipRecommendationMode(recommendation), "multi_overlap");
    });

    it("returns nearest for nearest fallback", () => {
        const recommendation: RoadTownshipRecommendationResult = {
            recommended: match(9n, "Near", 0),
            matches: [match(9n, "Near", 0)],
            commonParent: null,
            fallback_reason: "nearest_township",
            distance_m: 850,
            nearest_unfiltered_distance_m: 850,
            debugReason: null,
            road_length_m: 100,
            geometry_intersects: false,
        };
        assert.equal(resolveRoadTownshipRecommendationMode(recommendation), "nearest");
    });
});

describe("buildRoadTownshipInferMessage", () => {
    it("includes debug reason for outside_all_townships", () => {
        const message = buildRoadTownshipInferMessage({
            recommendation: {
                recommended: null,
                matches: [],
                commonParent: null,
                fallback_reason: null,
                distance_m: null,
                nearest_unfiltered_distance_m: 4200,
                debugReason: "outside_all_townships",
                road_length_m: 100,
                geometry_intersects: false,
            },
            mode: null,
            current: { id: null, name: null, level_code: null, is_active: null },
            debugReason: "outside_all_townships",
        });
        assert.match(message, /outside_all_townships/);
        assert.match(message, /4\.2km/);
    });

    it("describes stored township mismatch with geometry recommendation", () => {
        const recommendation: RoadTownshipRecommendationResult = {
            recommended: match(99n, "Other Township", 80, 0.5),
            matches: [match(99n, "Other Township", 80, 0.5)],
            commonParent: null,
            fallback_reason: null,
            distance_m: null,
            nearest_unfiltered_distance_m: null,
            debugReason: null,
            road_length_m: 160,
            geometry_intersects: true,
        };
        const message = buildRoadTownshipInferMessage({
            recommendation,
            mode: "single_overlap",
            current: {
                id: "42",
                name: "Stored Township",
                level_code: "township",
                is_active: true,
            },
            debugReason: null,
        });
        assert.match(message, /does not match road geometry/i);
        assert.match(message, /Stored Township/);
        assert.match(message, /Other Township/);
    });

    it("describes multi-overlap with broader parent", () => {
        const recommendation: RoadTownshipRecommendationResult = {
            recommended: match(1n, "Kyauktan", 500, 0.7),
            matches: [match(1n, "Kyauktan", 500, 0.7), match(2n, "Other", 100, 0.14)],
            commonParent: {
                id: 99n,
                canonical_name: "Yangon District",
                admin_level_code: "district",
                name_mm: null,
                name_en: null,
            },
            fallback_reason: null,
            distance_m: null,
            nearest_unfiltered_distance_m: null,
            debugReason: null,
            road_length_m: 714,
            geometry_intersects: true,
        };
        const message = buildRoadTownshipInferMessage({
            recommendation,
            mode: "multi_overlap",
            current: { id: "3", name: "Ward 1", level_code: "ward", is_active: true },
            debugReason: null,
        });
        assert.match(message, /multiple townships/);
        assert.match(message, /Kyauktan/);
        assert.match(message, /Yangon District/);
    });
});
