import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

process.env.NEXT_PUBLIC_API_BASE_URL = "http://api.test";

type FetchCall = { url: string | URL | Request; init?: RequestInit };
const storage = new Map<string, string>();
const calls: FetchCall[] = [];

function installWindowStub() {
    (globalThis as { window?: unknown }).window = {
        localStorage: {
            getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
            clear: () => storage.clear(),
        },
        location: {
            pathname: "/dashboard/transport",
            href: "http://localhost/dashboard/transport",
            assign() {},
            replace() {},
        },
    };
}

describe("dashboard transport review regression — client contracts", () => {
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
        if (originalFetch) globalThis.fetch = originalFetch;
        storage.clear();
    });

    it("10. mergeTransportStopsGlobal forwards acknowledgeSameVariantOccurrences", async () => {
        const { mergeTransportStopsGlobal } = await import("../api");
        await mergeTransportStopsGlobal({
            canonicalStopId: "11111111-1111-4111-8111-111111111111",
            duplicateStopId: "22222222-2222-4222-8222-222222222222",
            currentStopId: "11111111-1111-4111-8111-111111111111",
            candidateStopId: "22222222-2222-4222-8222-222222222222",
            acknowledgeSameVariantOccurrences: true,
            fieldSources: { name: "current" },
            reason: "dedupe",
        });
        const body = JSON.parse(String(calls[0]?.init?.body));
        assert.equal(body.acknowledgeSameVariantOccurrences, true);
        assert.equal(body.fieldSources.name, "current");
        assert.equal(body.reason, "dedupe");
    });

    it("removeTransportRouteStop always sends JSON body {}", async () => {
        const { removeTransportRouteStop } = await import("../api");
        await removeTransportRouteStop("42");
        assert.equal(calls[0]?.init?.body, JSON.stringify({}));
        assert.match(String(calls[0]?.url), /\/transport\/route-stops\/42$/);
    });

    it("archiveTransportStop always sends JSON body {}", async () => {
        const { archiveTransportStop } = await import("../api");
        await archiveTransportStop("11111111-1111-4111-8111-111111111111");
        assert.equal(calls[0]?.init?.body, JSON.stringify({}));
    });

    it("terminal conflict disables merge submit helper", async () => {
        const { canSubmitTransportStopMerge } = await import("../reviewMapMergeCompare");
        assert.equal(
            canSubmitTransportStopMerge({
                previewLoaded: true,
                previewError: false,
                mergeAllowed: false,
                terminalConflictExists: true,
                sameVariantConflictCount: 0,
                acknowledgedSameVariantOccurrences: true,
            }),
            false,
        );
    });
});
