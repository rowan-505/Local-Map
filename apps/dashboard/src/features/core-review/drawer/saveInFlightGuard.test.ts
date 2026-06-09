import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tryAcquireInFlightRef } from "./saveInFlightGuard.js";

describe("tryAcquireInFlightRef", () => {
    it("acquires on first call and blocks until released", () => {
        const ref = { current: false };

        assert.equal(tryAcquireInFlightRef(ref), true);
        assert.equal(ref.current, true);
        assert.equal(tryAcquireInFlightRef(ref), false);
        assert.equal(ref.current, true);

        ref.current = false;

        assert.equal(tryAcquireInFlightRef(ref), true);
        assert.equal(ref.current, true);
    });

    it("simulates double-click: only one acquire succeeds before release", () => {
        const ref = { current: false };
        const acquired: boolean[] = [];

        acquired.push(tryAcquireInFlightRef(ref));
        acquired.push(tryAcquireInFlightRef(ref));

        assert.deepEqual(acquired, [true, false]);
    });
});
