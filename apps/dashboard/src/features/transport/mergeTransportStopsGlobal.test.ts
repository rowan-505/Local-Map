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

describe("mergeTransportStopsGlobal request body", () => {
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
            return new Response(
                JSON.stringify({
                    canonicalStop: { publicId: "11111111-1111-4111-8111-111111111111" },
                    deletedStopId: "22222222-2222-4222-8222-222222222222",
                    referencesChanged: {},
                    affectedRouteCodes: [],
                    affectedVariantCodes: [],
                    counts: {},
                }),
                {
                    status: 200,
                    headers: { "content-type": "application/json" },
                },
            );
        }) as typeof fetch;
    });

    afterEach(() => {
        if (originalFetch) {
            globalThis.fetch = originalFetch;
        }
        storage.clear();
    });

    it("includes acknowledgeSameVariantOccurrences=true in the request body", async () => {
        const { mergeTransportStopsGlobal } = await import("./api");
        await mergeTransportStopsGlobal({
            canonicalStopId: "11111111-1111-4111-8111-111111111111",
            duplicateStopId: "22222222-2222-4222-8222-222222222222",
            currentStopId: "11111111-1111-4111-8111-111111111111",
            candidateStopId: "22222222-2222-4222-8222-222222222222",
            acknowledgeSameVariantOccurrences: true,
        });

        assert.equal(calls.length, 1);
        const body = JSON.parse(String(calls[0]?.init?.body));
        assert.equal(body.acknowledgeSameVariantOccurrences, true);
        assert.equal(body.canonicalStopId, "11111111-1111-4111-8111-111111111111");
        assert.equal(body.duplicateStopId, "22222222-2222-4222-8222-222222222222");
        assert.equal(body.currentStopId, "11111111-1111-4111-8111-111111111111");
        assert.equal(body.candidateStopId, "22222222-2222-4222-8222-222222222222");
    });

    it("includes acknowledgeSameVariantOccurrences=false when explicitly supplied", async () => {
        const { mergeTransportStopsGlobal } = await import("./api");
        await mergeTransportStopsGlobal({
            canonicalStopId: "11111111-1111-4111-8111-111111111111",
            duplicateStopId: "22222222-2222-4222-8222-222222222222",
            currentStopId: "11111111-1111-4111-8111-111111111111",
            candidateStopId: "22222222-2222-4222-8222-222222222222",
            acknowledgeSameVariantOccurrences: false,
        });

        const body = JSON.parse(String(calls[0]?.init?.body));
        assert.equal(body.acknowledgeSameVariantOccurrences, false);
    });
});
