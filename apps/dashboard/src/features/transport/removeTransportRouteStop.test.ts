import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

process.env.NEXT_PUBLIC_API_BASE_URL = "http://api.test";

type FetchCall = {
    url: string | URL | Request;
    init?: RequestInit;
};

const storage = new Map<string, string>();

function installWindowStub() {
    const localStorage = {
        getItem(key: string) {
            return storage.has(key) ? storage.get(key)! : null;
        },
        setItem(key: string, value: string) {
            storage.set(key, value);
        },
        removeItem(key: string) {
            storage.delete(key);
        },
        clear() {
            storage.clear();
        },
    };

    (globalThis as { window?: unknown }).window = {
        localStorage,
        location: {
            pathname: "/dashboard/transport",
            href: "http://localhost/dashboard/transport",
            assign() {},
            replace() {},
        },
    };
}

describe("removeTransportRouteStop request body", () => {
    const calls: FetchCall[] = [];
    let originalFetch: typeof globalThis.fetch | undefined;

    beforeEach(() => {
        storage.clear();
        calls.length = 0;
        installWindowStub();
        storage.set("accessToken", "test-access-token");
        originalFetch = globalThis.fetch;
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url, init });
            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }) as typeof fetch;
    });

    afterEach(() => {
        if (originalFetch) {
            globalThis.fetch = originalFetch;
        }
        storage.clear();
    });

    it("sends body {} when reason is blank", async () => {
        const { removeTransportRouteStop } = await import("./api");
        await removeTransportRouteStop("42");

        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.init?.method, "DELETE");
        assert.equal(calls[0]?.init?.body, JSON.stringify({}));
        assert.match(String(calls[0]?.url), /\/transport\/route-stops\/42$/);
    });

    it("sends body { reason } when reason is provided", async () => {
        const { removeTransportRouteStop } = await import("./api");
        await removeTransportRouteStop("42", " duplicate stop ");

        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.init?.method, "DELETE");
        assert.equal(calls[0]?.init?.body, JSON.stringify({ reason: "duplicate stop" }));
    });

    it("preserves AbortSignal when provided", async () => {
        const { removeTransportRouteStop } = await import("./api");
        const controller = new AbortController();
        await removeTransportRouteStop("7", undefined, { signal: controller.signal });

        assert.equal(calls[0]?.init?.signal, controller.signal);
        assert.equal(calls[0]?.init?.body, JSON.stringify({}));
    });
});
