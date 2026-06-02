import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseEligibilityDetailsListFilters } from "./import-review-promotion-eligibility-details-filters.js";

describe("import-review promotion eligibility details filters", () => {
    it("parses search, reason_code, and sort", () => {
        const filters = parseEligibilityDetailsListFilters({
            search: "  way/1 ",
            reason_code: "GEOMETRY_INVALID",
            sort_by: "updated_at",
            sort_order: "desc",
        });
        assert.equal(filters.search, "way/1");
        assert.equal(filters.reasonCode, "GEOMETRY_INVALID");
        assert.equal(filters.sortBy, "updated_at");
        assert.equal(filters.sortOrder, "desc");
    });

    it("defaults sort to id asc", () => {
        const filters = parseEligibilityDetailsListFilters({});
        assert.equal(filters.sortBy, "id");
        assert.equal(filters.sortOrder, "asc");
        assert.equal(filters.search, undefined);
    });
});
