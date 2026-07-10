import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isSearchIndexRunFailed,
    isSearchIndexRunInProgress,
    isSearchIndexRunSuccessful,
    SEARCH_INDEX_RUN_STATUS,
} from "./search-index-run-status.js";

describe("search index run status interpretation", () => {
    it("treats completed as successful", () => {
        assert.equal(isSearchIndexRunSuccessful(SEARCH_INDEX_RUN_STATUS.COMPLETED), true);
        assert.equal(isSearchIndexRunSuccessful("completed"), true);
    });

    it("does not treat failed or legacy success as successful", () => {
        assert.equal(isSearchIndexRunSuccessful(SEARCH_INDEX_RUN_STATUS.FAILED), false);
        assert.equal(isSearchIndexRunSuccessful("failed"), false);
        assert.equal(isSearchIndexRunSuccessful("success"), false);
        assert.equal(isSearchIndexRunSuccessful(null), false);
        assert.equal(isSearchIndexRunSuccessful(undefined), false);
    });

    it("treats failed as failed terminal status", () => {
        assert.equal(isSearchIndexRunFailed(SEARCH_INDEX_RUN_STATUS.FAILED), true);
        assert.equal(isSearchIndexRunFailed(SEARCH_INDEX_RUN_STATUS.COMPLETED), false);
        assert.equal(isSearchIndexRunFailed(SEARCH_INDEX_RUN_STATUS.RUNNING), false);
    });

    it("treats running and pending as in progress", () => {
        assert.equal(isSearchIndexRunInProgress(SEARCH_INDEX_RUN_STATUS.RUNNING), true);
        assert.equal(isSearchIndexRunInProgress(SEARCH_INDEX_RUN_STATUS.PENDING), true);
        assert.equal(isSearchIndexRunInProgress(SEARCH_INDEX_RUN_STATUS.COMPLETED), false);
        assert.equal(isSearchIndexRunInProgress(SEARCH_INDEX_RUN_STATUS.FAILED), false);
    });
});
