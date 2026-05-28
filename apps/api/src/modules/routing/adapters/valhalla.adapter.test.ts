import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    RoutingEngineTimeoutError,
    RoutingEngineUnavailableError,
} from "../routing.errors.js";
import { createValhallaRoutingEngineAdapter } from "./valhalla.adapter.js";

const sampleRequest = {
    origin: { lat: 16.8661, lng: 96.1951 },
    destination: { lat: 16.8409, lng: 96.1735 },
    profile: "car" as const,
};

describe("ValhallaRoutingEngineAdapter", () => {
    it("maps successful /route JSON to normalized response", async () => {
        const adapter = createValhallaRoutingEngineAdapter({
            baseUrl: "http://valhalla.test",
            timeoutMs: 5000,
            fetchImpl: async (input, init) => {
                assert.equal(String(input), "http://valhalla.test/route");
                assert.equal(init?.method, "POST");
                return new Response(
                    JSON.stringify({
                        trip: {
                            status: 0,
                            summary: { length: 3.2, time: 420 },
                            shape: {
                                type: "LineString",
                                coordinates: [
                                    [96.1951, 16.8661],
                                    [96.1735, 16.8409],
                                ],
                            },
                            legs: [
                                {
                                    summary: { length: 3.2, time: 420 },
                                    maneuvers: [{ instruction: "Head southeast." }],
                                },
                            ],
                        },
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } }
                );
            },
        });

        const result = await adapter.route(sampleRequest);
        assert.equal(result.status, "ok");
        assert.equal(result.routingEngine, "valhalla");
        assert.equal(result.profile, "car");
        assert.equal(result.summary.distanceMeters, 3200);
        assert.equal(result.summary.durationSeconds, 420);
    });

    it("throws 503 when Valhalla is unreachable", async () => {
        const adapter = createValhallaRoutingEngineAdapter({
            baseUrl: "http://valhalla.test",
            fetchImpl: async () => {
                const error = new Error("fetch failed");
                (error as NodeJS.ErrnoException).code = "ECONNREFUSED";
                throw error;
            },
        });

        await assert.rejects(() => adapter.route(sampleRequest), RoutingEngineUnavailableError);
    });

    it("throws 504 on timeout", async () => {
        const adapter = createValhallaRoutingEngineAdapter({
            baseUrl: "http://valhalla.test",
            fetchImpl: async () => {
                const error = new Error("The operation was aborted");
                error.name = "TimeoutError";
                throw error;
            },
        });

        await assert.rejects(() => adapter.route(sampleRequest), RoutingEngineTimeoutError);
    });
});
