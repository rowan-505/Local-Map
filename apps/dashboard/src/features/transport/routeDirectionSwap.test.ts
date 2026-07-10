import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    canSwapRouteDirection,
    getRouteDirectionSwapPair,
} from "./routeDirectionSwap.js";
import type { TransportVariantSummary } from "./types.js";

function variant(
    overrides: Partial<TransportVariantSummary> & Pick<TransportVariantSummary, "public_id">,
): TransportVariantSummary {
    return {
        variant_code: "95-A",
        direction_name: "outbound",
        direction_id: 0,
        headsign: null,
        origin_name: null,
        destination_name: null,
        stop_count: 0,
        path_count: 0,
        path_status: "none",
        distance_m: null,
        estimated_duration_min: null,
        review_status: "needs_review",
        confidence_score: 60,
        is_active: true,
        ...overrides,
    };
}

describe("getRouteDirectionSwapPair", () => {
    it("returns outbound/inbound pair for two active variants", () => {
        const pair = getRouteDirectionSwapPair([
            variant({ public_id: "a", variant_code: "95-A", direction_id: 0 }),
            variant({
                public_id: "b",
                variant_code: "95-B",
                direction_id: 1,
                direction_name: "inbound",
            }),
        ]);
        assert.ok(pair);
        assert.equal(pair.outbound.public_id, "a");
        assert.equal(pair.inbound.public_id, "b");
        assert.equal(canSwapRouteDirection([pair.outbound, pair.inbound]), true);
    });

    it("returns null when variant count is not two", () => {
        assert.equal(
            getRouteDirectionSwapPair([
                variant({ public_id: "a", direction_id: 0 }),
            ]),
            null,
        );
    });

    it("returns null when directions are not outbound + inbound", () => {
        assert.equal(
            getRouteDirectionSwapPair([
                variant({ public_id: "a", direction_id: 0 }),
                variant({ public_id: "b", direction_id: 2, direction_name: "loop" }),
            ]),
            null,
        );
    });

    it("returns null when more than two active variants exist", () => {
        assert.equal(
            getRouteDirectionSwapPair([
                variant({ public_id: "a", direction_id: 0 }),
                variant({ public_id: "b", direction_id: 1, direction_name: "inbound" }),
                variant({ public_id: "c", direction_id: 0, variant_code: "95-C" }),
            ]),
            null,
        );
    });
});
