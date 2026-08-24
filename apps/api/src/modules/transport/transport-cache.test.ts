import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { clearTransportCache, getTransportCached } from "./transport-cache.js";

afterEach(() => clearTransportCache());

describe("getTransportCached", () => {
    it("coalesces concurrent misses for the same key", async () => {
        let loads = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const loader = async () => {
            loads += 1;
            await gate;
            return { ok: true };
        };

        const first = getTransportCached("same", 1_000, loader);
        const second = getTransportCached("same", 1_000, loader);
        release();

        assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
        assert.equal(loads, 1);
    });

    it("does not cache loader failures", async () => {
        let loads = 0;
        const loader = async () => {
            loads += 1;
            if (loads === 1) throw new Error("temporary");
            return "ok";
        };

        await assert.rejects(getTransportCached("error", 1_000, loader), /temporary/);
        assert.equal(await getTransportCached("error", 1_000, loader), "ok");
        assert.equal(loads, 2);
    });

    it("does not repopulate stale data after a clear during an in-flight load", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let loads = 0;
        const first = getTransportCached("clear", 1_000, async () => {
            loads += 1;
            await gate;
            return "old";
        });
        clearTransportCache();
        release();
        assert.equal(await first, "old");

        assert.equal(
            await getTransportCached("clear", 1_000, async () => {
                loads += 1;
                return "new";
            }),
            "new",
        );
        assert.equal(loads, 2);
    });
});
