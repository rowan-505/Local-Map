import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSearchListPageState } from "./searchListPageState";

describe("getSearchListPageState", () => {
    it("keeps API errors out of the empty state", () => {
        assert.equal(
            getSearchListPageState({ loading: false, error: "Boom", data: null, items: [] }),
            "error",
        );
    });

    it("returns empty only after data has loaded with no rows", () => {
        assert.equal(
            getSearchListPageState({ loading: false, error: "", data: { total: 0 }, items: [] }),
            "empty",
        );
    });

    it("returns ready when loaded rows exist", () => {
        assert.equal(
            getSearchListPageState({ loading: false, error: "", data: { total: 1 }, items: [1] }),
            "ready",
        );
    });
});
