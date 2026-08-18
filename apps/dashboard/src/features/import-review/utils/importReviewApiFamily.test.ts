import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveImportReviewApiFamily } from "./importReviewApiFamily.js";

describe("resolveImportReviewApiFamily", () => {
    it("maps hyphenated dashboard slugs to API families", () => {
        assert.equal(resolveImportReviewApiFamily("bus-stops"), "bus_stops");
        assert.equal(resolveImportReviewApiFamily("admin-areas"), "admin_areas");
        assert.equal(resolveImportReviewApiFamily("water-lines"), "water_lines");
        assert.equal(resolveImportReviewApiFamily("water-polygons"), "water_polygons");
        assert.equal(resolveImportReviewApiFamily("routing-barriers"), "routing_barriers");
        assert.equal(resolveImportReviewApiFamily("bus-route-variants"), "bus_route_variants");
        assert.equal(resolveImportReviewApiFamily("bus-route-stops"), "bus_route_stops");
    });

    it("keeps already-valid API families unchanged", () => {
        assert.equal(resolveImportReviewApiFamily("roads"), "roads");
        assert.equal(resolveImportReviewApiFamily("places"), "places");
        assert.equal(resolveImportReviewApiFamily("buildings"), "buildings");
        assert.equal(resolveImportReviewApiFamily("land_areas"), "land_areas");
        assert.equal(resolveImportReviewApiFamily("addresses"), "addresses");
        assert.equal(resolveImportReviewApiFamily("bus_stops"), "bus_stops");
        assert.equal(resolveImportReviewApiFamily("bus_route_variants"), "bus_route_variants");
        assert.equal(resolveImportReviewApiFamily("bus_route_stops"), "bus_route_stops");
    });
});
