import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { loadApiEnv, resetApiEnvCacheForTests } from "./env.js";

const ENV_KEYS = [
    "ROUTING_ENABLED",
    "ROUTING_DEFAULT_ENGINE",
    "VALHALLA_BASE_URL",
    "ROUTING_REQUEST_TIMEOUT_MS",
    "ROUTING_PUBLIC_PROFILES",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
    const snap: Record<string, string | undefined> = {};
    for (const key of ENV_KEYS) {
        snap[key] = process.env[key];
    }
    return snap;
}

function restoreEnv(snap: Record<string, string | undefined>) {
    for (const key of ENV_KEYS) {
        const value = snap[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
}

describe("loadApiEnv routing", () => {
    const previous = snapshotEnv();

    afterEach(() => {
        restoreEnv(previous);
        resetApiEnvCacheForTests();
    });

    it("defaults routing to disabled with local Valhalla URL", () => {
        resetApiEnvCacheForTests();
        for (const key of ENV_KEYS) {
            delete process.env[key];
        }

        const env = loadApiEnv();
        assert.equal(env.routing.enabled, false);
        assert.equal(env.routing.valhallaBaseUrl, "http://localhost:8002");
        assert.equal(env.routing.requestTimeoutMs, 8000);
        assert.deepEqual(env.routing.publicProfiles, ["walk", "car", "motorcycle"]);
    });

    it("rejects unknown public profile", () => {
        resetApiEnvCacheForTests();
        process.env.ROUTING_PUBLIC_PROFILES = "walk,bus";
        assert.throws(() => loadApiEnv(), /Invalid ROUTING_PUBLIC_PROFILES/);
    });
});
