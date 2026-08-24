import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTransportAdminSearch } from "./transport-admin-search.js";

describe("buildTransportAdminSearch", () => {
    it("normalizes Myanmar route digits", () => {
        const result = buildTransportAdminSearch("၂၀");
        assert.equal(result?.exact, "20");
        assert.equal(result?.numericCode, "20");
        assert.equal(result?.originalContainsLike, "%၂၀%");
        assert.equal(result?.myanmarContainsLike, "%၂၀%");
    });

    it("normalizes separators for route-code matching", () => {
        const result = buildTransportAdminSearch(" YBS  20 ");
        assert.equal(result?.exact, "ybs 20");
        assert.equal(result?.compactCode, "ybs20");
        assert.equal(result?.myanmarContainsLike, "%ybs ၂၀%");
        assert.equal(result?.prefixLike, "ybs 20%");
    });

    it("escapes LIKE metacharacters", () => {
        const result = buildTransportAdminSearch("A_100%");
        assert.equal(result?.containsLike, "%a\\_100\\%%");
    });

    it("returns null for blank input", () => {
        assert.equal(buildTransportAdminSearch("  "), null);
        assert.equal(buildTransportAdminSearch(undefined), null);
    });
});
