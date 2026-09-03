import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isSearchOverlayReviewAllowed,
    searchOverlayActiveCondition,
    SEARCH_OVERLAY_REJECTED_STATUS,
} from "./transport-search-overlay-visibility.js";

describe("search overlay visibility", () => {
    it("allows unreviewed and reviewed statuses", () => {
        assert.equal(isSearchOverlayReviewAllowed("imported_unreviewed"), true);
        assert.equal(isSearchOverlayReviewAllowed("needs_review"), true);
        assert.equal(isSearchOverlayReviewAllowed("reviewed"), true);
        assert.equal(isSearchOverlayReviewAllowed("verified"), true);
    });

    it("hides rejected rows", () => {
        assert.equal(isSearchOverlayReviewAllowed("rejected"), false);
        assert.equal(isSearchOverlayReviewAllowed("Rejected"), false);
        assert.equal(SEARCH_OVERLAY_REJECTED_STATUS, "rejected");
    });

    it("builds a search-overlay SQL condition without public-release review gates", () => {
        const sql = searchOverlayActiveCondition("rp");
        assert.match(sql, /rp\.is_active = true/);
        assert.match(sql, /rp\.deleted_at IS NULL/);
        assert.match(sql, /review_status IS DISTINCT FROM 'rejected'/);
        assert.doesNotMatch(sql, /reviewed/);
        assert.doesNotMatch(sql, /verified/);
    });
});
