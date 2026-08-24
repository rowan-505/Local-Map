import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectedStopFocusWindow } from "./reviewMapStopFocus.js";

const stops = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

describe("selectedStopFocusWindow", () => {
    it("returns the previous, selected, and next stop in the middle", () => {
        assert.deepEqual(selectedStopFocusWindow(stops, "c").map((stop) => stop.id), [
            "b",
            "c",
            "d",
        ]);
    });

    it("keeps three stops visible at the start and end of a route", () => {
        assert.deepEqual(selectedStopFocusWindow(stops, "a").map((stop) => stop.id), [
            "a",
            "b",
            "c",
        ]);
        assert.deepEqual(selectedStopFocusWindow(stops, "e").map((stop) => stop.id), [
            "c",
            "d",
            "e",
        ]);
    });

    it("returns an empty window when the occurrence no longer exists", () => {
        assert.deepEqual(selectedStopFocusWindow(stops, "missing"), []);
    });
});
