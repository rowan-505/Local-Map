/**
 * Dry-run swipe safety checks without a connected device.
 */

import assert from "node:assert/strict";

import { clearSwipeLog, getSwipeLog } from "./adb.js";
import { evaluateSwipeSafety } from "./ybs-navigation-safety.js";

function runCase(label: string, gesture: Parameters<typeof evaluateSwipeSafety>[0], screen: Parameters<typeof evaluateSwipeSafety>[1]["screen"]): void {
    const result = evaluateSwipeSafety(gesture, { screen, strictNoRouteListRefresh: true });
    console.log(
        `[dry-run] ${label}: screen=${screen} (${gesture.startX},${gesture.startY})->(${gesture.endX},${gesture.endY}) ` +
            `allowed=${result.allowed} reason=${result.reason}`,
    );
}

clearSwipeLog();

runCase(
    "route list downward finger (blocked)",
    { startX: 540, startY: 800, endX: 540, endY: 1450, durationMs: 380, purpose: "scrollUpRouteList" },
    "route_list",
);
assert.equal(
    evaluateSwipeSafety(
        { startX: 540, startY: 800, endX: 540, endY: 1450, durationMs: 380 },
        { screen: "route_list", strictNoRouteListRefresh: true },
    ).allowed,
    false,
);

runCase(
    "route list upward finger (allowed)",
    { startX: 540, startY: 1450, endX: 540, endY: 800, durationMs: 380, purpose: "scrollDownRouteList" },
    "route_list",
);
assert.equal(
    evaluateSwipeSafety(
        { startX: 540, startY: 1450, endX: 540, endY: 800, durationMs: 380 },
        { screen: "route_list", strictNoRouteListRefresh: true },
    ).allowed,
    true,
);

runCase(
    "route detail stop-list scroll up (allowed)",
    { startX: 540, startY: 300, endX: 540, endY: 900, durationMs: 500, purpose: "scrollUpStopListPage" },
    "route_detail",
);
assert.equal(
    evaluateSwipeSafety(
        { startX: 540, startY: 300, endX: 540, endY: 900, durationMs: 500 },
        { screen: "route_detail", strictNoRouteListRefresh: true },
    ).allowed,
    true,
);

console.log(`Swipe log entries: ${getSwipeLog().length}`);
console.log("Dry-run passed.");
