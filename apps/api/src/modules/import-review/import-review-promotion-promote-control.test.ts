import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isPromotionHeartbeatStale,
    isPromotionHeartbeatStalled,
} from "./import-review-promotion-promote-progress.js";

describe("promotion heartbeat thresholds", () => {
    it("detects stale and stalled promotion heartbeats", () => {
        const now = Date.parse("2026-06-03T12:00:00Z");
        const fresh = new Date("2026-06-03T11:59:00Z");
        const stalled = new Date("2026-06-03T11:57:00Z");
        const stale = new Date("2026-06-03T11:54:00Z");
        assert.equal(isPromotionHeartbeatStalled(fresh, now), false);
        assert.equal(isPromotionHeartbeatStalled(stalled, now), true);
        assert.equal(isPromotionHeartbeatStale(stale, now), true);
        assert.equal(isPromotionHeartbeatStale(null, now), true);
    });
});
