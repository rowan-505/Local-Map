import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    legacyIsOnewayFromTravelDirection,
    normalizeStreetTravelDirection,
    resolveStreetTravelDirectionWrite,
} from "./streets-direction.js";

describe("street travel-direction compatibility", () => {
    it("normalizes client-facing both to the existing NULL storage convention", () => {
        assert.equal(normalizeStreetTravelDirection("both"), null);
    });

    it("derives the legacy boolean without making it authoritative", () => {
        assert.equal(legacyIsOnewayFromTravelDirection("forward"), true);
        assert.equal(legacyIsOnewayFromTravelDirection("reverse"), true);
        assert.equal(legacyIsOnewayFromTravelDirection("reversible"), false);
        assert.equal(legacyIsOnewayFromTravelDirection("alternating"), false);
        assert.equal(legacyIsOnewayFromTravelDirection("unknown"), false);
        assert.equal(legacyIsOnewayFromTravelDirection(null), false);
    });

    it("prefers travel_direction over a conflicting legacy input", () => {
        assert.equal(
            resolveStreetTravelDirectionWrite({ travel_direction: "reverse", is_oneway: false }),
            "reverse",
        );
    });

    it("maps legacy writes to forward or bidirectional", () => {
        assert.equal(resolveStreetTravelDirectionWrite({ is_oneway: true }), "forward");
        assert.equal(resolveStreetTravelDirectionWrite({ is_oneway: false }), null);
    });
});
