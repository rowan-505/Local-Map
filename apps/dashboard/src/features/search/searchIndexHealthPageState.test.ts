import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    phaseAtSearchIndexHealthLoadStart,
    resolveSearchIndexHealthLoadPhase,
    shouldShowSearchIndexHealthContent,
    shouldShowSearchIndexHealthSkeleton,
} from "./searchIndexHealthPageState.js";

describe("searchIndexHealthPageState", () => {
    it("enters refreshing phase when reloading with existing data", () => {
        assert.equal(phaseAtSearchIndexHealthLoadStart(true, true), "refreshing");
        assert.equal(phaseAtSearchIndexHealthLoadStart(false, false), "initial");
    });

    it("uses error phase when first load fails", () => {
        assert.equal(
            resolveSearchIndexHealthLoadPhase({
                hasData: false,
                isRefresh: false,
                success: false,
            }),
            "error",
        );
    });

    it("keeps loaded data visible when refresh fails", () => {
        assert.equal(
            resolveSearchIndexHealthLoadPhase({
                hasData: true,
                isRefresh: true,
                success: false,
            }),
            "loaded",
        );
    });

    it("shows skeleton only on first load", () => {
        assert.equal(shouldShowSearchIndexHealthSkeleton("initial", false), true);
        assert.equal(shouldShowSearchIndexHealthSkeleton("refreshing", true), false);
        assert.equal(shouldShowSearchIndexHealthSkeleton("loaded", true), false);
    });

    it("shows content after first successful load, including during refresh", () => {
        assert.equal(shouldShowSearchIndexHealthContent("initial", false), false);
        assert.equal(shouldShowSearchIndexHealthContent("refreshing", true), true);
        assert.equal(shouldShowSearchIndexHealthContent("loaded", true), true);
    });
});
