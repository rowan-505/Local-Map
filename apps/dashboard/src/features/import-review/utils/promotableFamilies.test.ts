import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isHighRiskPromotableFamily,
    isImportReviewPromotableApiFamily,
    promotionFamilyFromApiFamily,
} from "./promotableFamilies.js";

describe("promotableFamilies", () => {
    it("treats places as promotable", () => {
        assert.equal(isImportReviewPromotableApiFamily("places"), true);
        assert.equal(promotionFamilyFromApiFamily("places"), "places");
    });

    it("excludes bus_stops", () => {
        assert.equal(isImportReviewPromotableApiFamily("bus_stops"), false);
    });

    it("flags roads as high risk", () => {
        assert.equal(isHighRiskPromotableFamily("roads"), true);
        assert.equal(isHighRiskPromotableFamily("places"), false);
    });
});
