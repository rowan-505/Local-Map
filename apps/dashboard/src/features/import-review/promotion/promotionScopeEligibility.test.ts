import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildCreatePublishBatchFamilies,
    shouldAutoRetryPromotionScopeEligibility,
    shouldFetchPromotionScopeEligibility,
} from "./promotionScopeEligibility.js";

describe("promotionScopeEligibility", () => {
    it("does not fetch eligibility when no family is selected", () => {
        assert.equal(shouldFetchPromotionScopeEligibility([]), false);
        assert.equal(shouldFetchPromotionScopeEligibility([""].filter(Boolean)), false);
    });

    it("fetches eligibility when at least one family is selected", () => {
        assert.equal(shouldFetchPromotionScopeEligibility(["places"]), true);
        assert.equal(shouldFetchPromotionScopeEligibility(["roads", "places"]), true);
    });

    it("stops automatic retry after an eligibility error", () => {
        assert.equal(shouldAutoRetryPromotionScopeEligibility(true), false);
        assert.equal(shouldAutoRetryPromotionScopeEligibility(false), true);
    });

    it("create batch sends only selected families", () => {
        assert.deepEqual(buildCreatePublishBatchFamilies(["roads", "places"]), ["roads", "places"]);
        assert.deepEqual(buildCreatePublishBatchFamilies([]), []);
    });
});
