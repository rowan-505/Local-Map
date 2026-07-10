import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSearchOverviewRequest, SEARCH_OVERVIEW_PATH } from "./searchOverviewApi";

describe("searchOverviewApi", () => {
    it("builds the single dashboard overview request", () => {
        const [path, init] = buildSearchOverviewRequest();

        assert.equal(path, SEARCH_OVERVIEW_PATH);
        assert.equal(path, "/admin/search/overview");
        assert.equal(init.method, "GET");
    });

    it("preserves abort signal for dashboard fetch cancellation", () => {
        const controller = new AbortController();
        const [, init] = buildSearchOverviewRequest({ signal: controller.signal });

        assert.equal(init.signal, controller.signal);
    });
});
