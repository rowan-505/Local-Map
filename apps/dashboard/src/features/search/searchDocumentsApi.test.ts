import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSearchDocumentsRequest } from "./searchDocumentsApi";

describe("buildSearchDocumentsRequest", () => {
    it("builds the default no-filter request without empty filter params", () => {
        const [path, init] = buildSearchDocumentsRequest({
            q: "",
            entity_type: "",
            transport_mode: "",
            review_status: "",
            sort: "indexed_at",
            order: "desc",
            page: 1,
            pageSize: 25,
        });

        assert.equal(
            path,
            "/admin/search/documents?sort=indexed_at&order=desc&page=1&pageSize=25",
        );
        assert.equal(path.includes("review_status="), false);
        assert.equal(path.includes("language="), false);
        assert.equal(init.method, "GET");
    });

    it("serializes canonical entity type filters", () => {
        const [path] = buildSearchDocumentsRequest({ entity_type: "transport_stop" });

        assert.equal(path, "/admin/search/documents?entity_type=transport_stop");
    });

    it("serializes transport mode filters", () => {
        const [path] = buildSearchDocumentsRequest({ transport_mode: "bus" });

        assert.equal(path, "/admin/search/documents?transport_mode=bus");
    });

    it("trims and serializes review status filters", () => {
        const [path] = buildSearchDocumentsRequest({ review_status: " verified " });

        assert.equal(path, "/admin/search/documents?review_status=verified");
    });

    it("serializes sync state filters", () => {
        const [path] = buildSearchDocumentsRequest({ sync_state: "stale" });

        assert.equal(path, "/admin/search/documents?sync_state=stale");
    });

    it("serializes pagination params", () => {
        const [path] = buildSearchDocumentsRequest({ page: 3, pageSize: 50 });

        assert.equal(path, "/admin/search/documents?page=3&pageSize=50");
    });
});
