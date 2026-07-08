import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scrollUpRouteList } from "./adb.js";
import {
    evaluateSwipeSafety,
    isDownwardFingerGesture,
    ROUTE_LIST_REFRESH_GESTURE_BLOCKED,
} from "./ybs-navigation-safety.js";

describe("ybs navigation safety", () => {
    it("blocks downward finger gesture on route list", () => {
        const gesture = {
            startX: 500,
            startY: 800,
            endX: 500,
            endY: 1450,
            durationMs: 380,
        };

        assert.equal(isDownwardFingerGesture(gesture), true);

        const result = evaluateSwipeSafety(gesture, { screen: "route_list", strictNoRouteListRefresh: true });
        assert.equal(result.allowed, false);
        assert.match(result.reason, /pull-to-refresh/i);
    });

    it("allows upward finger gesture on route list", () => {
        const gesture = {
            startX: 500,
            startY: 1450,
            endX: 500,
            endY: 800,
            durationMs: 380,
        };

        assert.equal(isDownwardFingerGesture(gesture), false);

        const result = evaluateSwipeSafety(gesture, { screen: "route_list", strictNoRouteListRefresh: true });
        assert.equal(result.allowed, true);
    });

    it("allows downward finger gesture on route detail stop list", () => {
        const gesture = {
            startX: 500,
            startY: 300,
            endX: 500,
            endY: 900,
            durationMs: 500,
        };

        const result = evaluateSwipeSafety(gesture, { screen: "route_detail", strictNoRouteListRefresh: true });
        assert.equal(result.allowed, true);
    });

    it("blocks downward finger gesture on unknown screen", () => {
        const gesture = {
            startX: 500,
            startY: 300,
            endX: 500,
            endY: 900,
            durationMs: 500,
        };

        const result = evaluateSwipeSafety(gesture, { screen: "unknown", strictNoRouteListRefresh: true });
        assert.equal(result.allowed, false);
        assert.match(result.reason, /route_detail/);
    });

    it("blocks downward finger gesture on stop detail screen", () => {
        const gesture = {
            startX: 500,
            startY: 300,
            endX: 500,
            endY: 900,
            durationMs: 500,
        };

        const result = evaluateSwipeSafety(gesture, { screen: "stop_detail", strictNoRouteListRefresh: true });
        assert.equal(result.allowed, false);
        assert.match(result.reason, /route_detail/);
    });

    it("blocks upward finger gesture on unknown screen when strict", () => {
        const gesture = {
            startX: 500,
            startY: 1450,
            endX: 500,
            endY: 800,
            durationMs: 380,
        };

        const result = evaluateSwipeSafety(gesture, { screen: "unknown", strictNoRouteListRefresh: true });
        assert.equal(result.allowed, false);
        assert.match(result.reason, /unknown screen/i);
    });

    it("blocks swipes while route list is loading", () => {
        const gesture = {
            startX: 500,
            startY: 1450,
            endX: 500,
            endY: 800,
            durationMs: 380,
        };

        const result = evaluateSwipeSafety(gesture, { screen: "loading", strictNoRouteListRefresh: true });
        assert.equal(result.allowed, false);
    });

    it("exports refresh block error code", () => {
        assert.equal(ROUTE_LIST_REFRESH_GESTURE_BLOCKED, "ROUTE_LIST_REFRESH_GESTURE_BLOCKED");
    });

    it("forbids scrollUpRouteList helper", () => {
        assert.throws(() => scrollUpRouteList("device"), /ROUTE_LIST_REFRESH_GESTURE_BLOCKED/);
    });
});
