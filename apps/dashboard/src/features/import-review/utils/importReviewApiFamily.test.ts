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
    });

    it("keeps already-valid API families unchanged", () => {
        assert.equal(resolveImportReviewApiFamily("roads"), "roads");
        assert.equal(resolveImportReviewApiFamily("places"), "places");
        assert.equal(resolveImportReviewApiFamily("buildings"), "buildings");
        assert.equal(resolveImportReviewApiFamily("landuse"), "landuse");
        assert.equal(resolveImportReviewApiFamily("addresses"), "addresses");
        assert.equal(resolveImportReviewApiFamily("bus_stops"), "bus_stops");
    });
});
