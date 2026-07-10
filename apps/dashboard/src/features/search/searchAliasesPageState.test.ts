import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    SEARCH_ALIASES_FILTERED_EMPTY_LABEL,
    SEARCH_ALIASES_TRUE_EMPTY_LABEL,
    getSearchAliasesTableState,
    hasSearchAliasListFilters,
    readSearchAliasUrlFilters,
} from "./searchAliasesPageState";

const EMPTY_FILTERS = {
    q: "",
    entity_type: "",
    language_code: "",
    alias_type: "",
    is_active: "" as const,
};

describe("searchAliasesPageState", () => {
    it("detects active list filters", () => {
        assert.equal(hasSearchAliasListFilters(EMPTY_FILTERS, ""), false);
        assert.equal(
            hasSearchAliasListFilters({ ...EMPTY_FILTERS, entity_type: "place" }, ""),
            true,
        );
        assert.equal(hasSearchAliasListFilters(EMPTY_FILTERS, "42"), true);
        assert.equal(
            hasSearchAliasListFilters({ ...EMPTY_FILTERS, is_active: "true" }, ""),
            true,
        );
    });

    it("separates true empty from filtered empty", () => {
        assert.equal(
            getSearchAliasesTableState({
                loading: false,
                error: "",
                data: { items: [], total: 0 },
                hasFilters: false,
            }),
            "true-empty",
        );
        assert.equal(
            getSearchAliasesTableState({
                loading: false,
                error: "",
                data: { items: [], total: 0 },
                hasFilters: true,
            }),
            "filtered-empty",
        );
    });

    it("keeps errors out of empty states", () => {
        assert.equal(
            getSearchAliasesTableState({
                loading: false,
                error: "Boom",
                data: null,
                hasFilters: false,
            }),
            "error",
        );
    });

    it("reads entity filters from URL params", () => {
        assert.deepEqual(
            readSearchAliasUrlFilters({
                get: (name) =>
                    name === "entity_type" ? "place" : name === "entity_id" ? "id-12" : null,
            }),
            { entity_type: "place", entity_id: "12" },
        );
        assert.deepEqual(
            readSearchAliasUrlFilters({ get: () => null }),
            { entity_type: "", entity_id: "" },
        );
    });

    it("uses stable empty-state copy", () => {
        assert.equal(
            SEARCH_ALIASES_TRUE_EMPTY_LABEL,
            "No search aliases have been created yet.",
        );
        assert.equal(
            SEARCH_ALIASES_FILTERED_EMPTY_LABEL,
            "No aliases match the current filters.",
        );
    });
});
