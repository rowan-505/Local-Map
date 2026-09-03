import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { getPublicAppUrl, loadApiEnv, resetApiEnvCacheForTests } from "./env.js";

const ENV_KEYS = [
    "ROUTING_ENABLED",
    "ROUTING_DEFAULT_ENGINE",
    "VALHALLA_BASE_URL",
    "ROUTING_REQUEST_TIMEOUT_MS",
    "ROUTING_PUBLIC_PROFILES",
    "NODE_ENV",
    "PUBLIC_APP_URL",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_ENDPOINT",
    "R2_REGION",
    "R2_MEDIA_PRIVATE_BUCKET",
    "R2_MEDIA_PUBLIC_BUCKET",
    "R2_MEDIA_PUBLIC_BASE_URL",
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

function clearR2Env() {
    for (const key of ENV_KEYS) {
        if (key.startsWith("R2_")) {
            delete process.env[key];
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
        assert.equal(env.r2, null);
    });

    it("rejects unknown public profile", () => {
        resetApiEnvCacheForTests();
        process.env.ROUTING_PUBLIC_PROFILES = "walk,bus";
        assert.throws(() => loadApiEnv(), /Invalid ROUTING_PUBLIC_PROFILES/);
    });
});

describe("loadApiEnv public app url", () => {
    const previous = snapshotEnv();

    afterEach(() => {
        restoreEnv(previous);
        resetApiEnvCacheForTests();
    });

    it("falls back to the local web origin outside production", () => {
        resetApiEnvCacheForTests();
        delete process.env.NODE_ENV;
        delete process.env.PUBLIC_APP_URL;

        loadApiEnv();
        assert.equal(getPublicAppUrl(), "http://localhost:5173");
    });

    it("uses the configured value and trims trailing slashes", () => {
        resetApiEnvCacheForTests();
        process.env.NODE_ENV = "production";
        process.env.PUBLIC_APP_URL = "https://coremapmm.com/";

        loadApiEnv();
        assert.equal(getPublicAppUrl(), "https://coremapmm.com");
    });

    it("requires PUBLIC_APP_URL in production (no localhost fallback)", () => {
        resetApiEnvCacheForTests();
        process.env.NODE_ENV = "production";
        delete process.env.PUBLIC_APP_URL;

        assert.throws(() => loadApiEnv(), /PUBLIC_APP_URL is required in production/);
    });
});

describe("loadApiEnv R2 media", () => {
    const previous = snapshotEnv();

    afterEach(() => {
        restoreEnv(previous);
        resetApiEnvCacheForTests();
    });

    it("allows startup when R2 is unset", () => {
        resetApiEnvCacheForTests();
        clearR2Env();
        const env = loadApiEnv();
        assert.equal(env.r2, null);
    });

    it("rejects a partial R2 group", () => {
        resetApiEnvCacheForTests();
        clearR2Env();
        process.env.R2_ACCOUNT_ID = "example-account";
        assert.throws(() => loadApiEnv(), /Incomplete R2 media configuration/);
    });

    it("parses a complete R2 group without exposing extra fields", () => {
        resetApiEnvCacheForTests();
        clearR2Env();
        process.env.R2_ACCOUNT_ID = "example-account";
        process.env.R2_ACCESS_KEY_ID = "example-access";
        process.env.R2_SECRET_ACCESS_KEY = "example-secret";
        process.env.R2_ENDPOINT = "https://example.r2.cloudflarestorage.com/";
        process.env.R2_REGION = "auto";
        process.env.R2_MEDIA_PRIVATE_BUCKET = "coremap-media-private";
        process.env.R2_MEDIA_PUBLIC_BUCKET = "coremap-media-public";
        process.env.R2_MEDIA_PUBLIC_BASE_URL = "https://media.example.com/";

        const env = loadApiEnv();
        assert.equal(env.r2?.privateBucket, "coremap-media-private");
        assert.equal(env.r2?.endpoint, "https://example.r2.cloudflarestorage.com");
        assert.equal(env.r2?.publicBaseUrl, "https://media.example.com");
        assert.equal(env.r2?.region, "auto");
    });
});
