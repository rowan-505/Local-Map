import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    REVIEW_MAP_NEARBY_SEARCH_DEBOUNCE_MS,
    createDebouncedNearbySearchScheduler,
    shouldSearchNearbyImmediately,
} from "./reviewMapNearbySearchSchedule";

describe("shouldSearchNearbyImmediately", () => {
    it("is immediate for saved center", () => {
        assert.equal(shouldSearchNearbyImmediately("saved"), true);
    });

    it("is debounced for map-click", () => {
        assert.equal(shouldSearchNearbyImmediately("map-click"), false);
    });

    it("forceImmediate bypasses source", () => {
        assert.equal(
            shouldSearchNearbyImmediately("map-click", { forceImmediate: true }),
            true,
        );
    });
});

describe("createDebouncedNearbySearchScheduler", () => {
    it("rapid movements produce one final request", () => {
        const pending: Array<{ fn: () => void; ms: number }> = [];
        const scheduler = createDebouncedNearbySearchScheduler({
            debounceMs: REVIEW_MAP_NEARBY_SEARCH_DEBOUNCE_MS,
            setTimeoutFn: (fn, ms) => {
                pending.push({ fn, ms });
                return pending.length as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimeoutFn: () => {
                pending.length = 0;
            },
        });

        let runs = 0;
        scheduler.schedule({ immediate: false }, () => {
            runs += 1;
        });
        scheduler.schedule({ immediate: false }, () => {
            runs += 1;
        });
        scheduler.schedule({ immediate: false }, () => {
            runs += 1;
        });

        assert.equal(runs, 0);
        assert.equal(pending.length, 1);
        assert.equal(pending[0]?.ms, 300);
        pending[0]?.fn();
        assert.equal(runs, 1);
    });

    it("stale timer callback is ignored after generation bump", () => {
        let captured: (() => void) | null = null;
        const scheduler = createDebouncedNearbySearchScheduler({
            setTimeoutFn: (fn) => {
                captured = fn;
                return 1 as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimeoutFn: () => {
                // Timer id cleared; keep captured to simulate a late fire.
            },
        });

        let runs = 0;
        scheduler.schedule({ immediate: false }, () => {
            runs += 1;
        });
        assert.ok(captured !== null);
        const staleTimer = captured as () => void;
        scheduler.bumpGeneration();
        staleTimer();
        assert.equal(runs, 0);
    });

    it("immediate explicit request bypasses debounce", () => {
        const pending: Array<() => void> = [];
        const scheduler = createDebouncedNearbySearchScheduler({
            setTimeoutFn: (fn) => {
                pending.push(fn);
                return 1 as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimeoutFn: () => {
                pending.length = 0;
            },
        });

        let runs = 0;
        scheduler.schedule({ immediate: true }, () => {
            runs += 1;
        });
        assert.equal(runs, 1);
        assert.equal(pending.length, 0);
    });
});
