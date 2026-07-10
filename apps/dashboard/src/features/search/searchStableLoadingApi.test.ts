import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFailedSearchesRequest } from "./failedSearchesApi";
import { buildSearchAliasesRequest } from "./searchAliasesApi";
import { buildSearchAnalyticsRequest } from "./searchAnalyticsApi";

describe("search dashboard request builders", () => {
    it("omits empty alias filters and keeps pagination", () => {
        const [path] = buildSearchAliasesRequest({
            q: "",
            entity_type: "",
            language_code: "",
            alias_type: "",
            sort: "updated_at",
            order: "desc",
            page: 1,
            pageSize: 25,
        });

        assert.equal(
            path,
            "/admin/search/aliases?sort=updated_at&order=desc&page=1&pageSize=25",
        );
    });

    it("serializes alias boolean filters", () => {
        const [path] = buildSearchAliasesRequest({ is_active: false });

        assert.equal(path, "/admin/search/aliases?is_active=false");
    });

    it("serializes failed searches default unresolved filter", () => {
        const [path] = buildFailedSearchesRequest({
            resolved: false,
            sort: "occurrence_count",
            order: "desc",
            page: 1,
            pageSize: 25,
        });

        assert.equal(
            path,
            "/admin/search/failed-searches?resolved=false&sort=occurrence_count&order=desc&page=1&pageSize=25",
        );
    });

    it("omits empty failed-search filters", () => {
        const [path] = buildFailedSearchesRequest({ q: "", lang: "", last_seen_from: "" });

        assert.equal(path, "/admin/search/failed-searches");
    });

    it("serializes analytics custom range", () => {
        const [path] = buildSearchAnalyticsRequest({
            period: "custom",
            from: "2026-07-01T00:00:00.000Z",
            to: "2026-07-10T23:59:59.999Z",
        });

        assert.equal(
            path,
            "/admin/search/analytics?period=custom&from=2026-07-01T00%3A00%3A00.000Z&to=2026-07-10T23%3A59%3A59.999Z",
        );
    });
});
