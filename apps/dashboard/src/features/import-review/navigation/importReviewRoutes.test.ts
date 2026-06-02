import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    getImportReviewEntitySlugFromPathname,
    isImportReviewCandidatesRoute,
    isImportReviewOverviewPathname,
} from "./importReviewRoutes.js";

describe("importReviewRoutes", () => {
    it("detects overview vs entity paths", () => {
        assert.equal(isImportReviewOverviewPathname("/dashboard/import-review"), true);
        assert.equal(isImportReviewOverviewPathname("/dashboard/import-review/"), true);
        assert.equal(getImportReviewEntitySlugFromPathname("/dashboard/import-review/buildings"), "buildings");
        assert.equal(getImportReviewEntitySlugFromPathname("/dashboard/import-review/promotion"), null);
    });

    it("detects roads candidate route on import-review only", () => {
        assert.equal(isImportReviewCandidatesRoute("/dashboard/import-review/roads", "roads"), true);
        assert.equal(isImportReviewCandidatesRoute("/data-review/roads", "roads"), false);
        assert.equal(isImportReviewCandidatesRoute("/dashboard/import-review", "roads"), false);
    });
});
