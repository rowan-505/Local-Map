import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSearchDocumentsTableState } from "./searchDocumentsPageState";
import type { SearchDocumentList } from "./types";

const emptyData: SearchDocumentList = {
    items: [],
    total: 0,
    page: 1,
    pageSize: 25,
    sort: "indexed_at",
    order: "desc",
};

describe("getSearchDocumentsTableState", () => {
    it("keeps API errors out of the empty state", () => {
        assert.equal(
            getSearchDocumentsTableState({
                loading: false,
                error: "Request failed",
                data: null,
            }),
            "error",
        );
    });

    it("treats null data without an error as idle, not empty", () => {
        assert.equal(
            getSearchDocumentsTableState({ loading: false, error: "", data: null }),
            "idle",
        );
    });

    it("returns empty only for a loaded empty response", () => {
        assert.equal(
            getSearchDocumentsTableState({ loading: false, error: "", data: emptyData }),
            "empty",
        );
    });
});
