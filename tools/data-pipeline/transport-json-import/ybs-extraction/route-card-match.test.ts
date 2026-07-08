import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isConfidentRouteCardMatch,
    MIN_ROUTE_CARD_MATCH_SCORE,
    type RouteCardMatchResult,
} from "./route-card-match.js";

function makeMatch(score: number, breakdown: RouteCardMatchResult["breakdown"]): RouteCardMatchResult {
    return {
        row: {
            route_display_code: "APS",
            route_number: null,
            route_title_my: null,
            route_title_en: null,
            operator_name: null,
            fare_text: null,
            fare_min: null,
            fare_max: null,
            app_total_stop_count: null,
            extraction_status: "pending",
            raw_card_text: [],
            card_bounds: null,
            badge_is_truncated: false,
        },
        score,
        breakdown,
    };
}

describe("route-card-match confidence", () => {
    it("accepts exact badge match at min score (APS case)", () => {
        const match = makeMatch(48, {
            display_code: 40,
            title: 0,
            operator: 0,
            raw_text: 8,
        });

        assert.equal(isConfidentRouteCardMatch(match, MIN_ROUTE_CARD_MATCH_SCORE), true);
    });

    it("accepts high score matches", () => {
        const match = makeMatch(100, {
            display_code: 40,
            title: 30,
            operator: 15,
            raw_text: 15,
        });

        assert.equal(isConfidentRouteCardMatch(match, MIN_ROUTE_CARD_MATCH_SCORE), true);
    });

    it("rejects weak truncated-badge-only matches", () => {
        const match = makeMatch(40, {
            display_code: 18,
            title: 10,
            operator: 12,
            raw_text: 0,
        });

        assert.equal(isConfidentRouteCardMatch(match, MIN_ROUTE_CARD_MATCH_SCORE), false);
    });
});
