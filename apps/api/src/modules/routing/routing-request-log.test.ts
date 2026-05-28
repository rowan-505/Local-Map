import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    RoutingEngineTimeoutError,
    RoutingProfileDisabledError,
} from "./routing.errors.js";
import {
    buildRouteRequestResponseSummary,
    buildRouteRequestStartSummary,
    mapApiRouteStatusToDbStatus,
    mapThrownErrorToDbStatus,
    toRouteRequestLogCompletion,
    toRouteRequestLogFailure,
} from "./routing-request-log.js";
import type { NormalizedRouteResponse } from "./routing.types.js";

describe("routing-request-log", () => {
    it("buildRouteRequestStartSummary captures request options", () => {
        const summary = buildRouteRequestStartSummary(
            {
                origin: { lat: 16.8, lng: 96.15 },
                destination: { lat: 16.81, lng: 96.16 },
                profile: "walk",
                allowedModes: ["walk"],
                excludedModes: ["car"],
                serviceClasses: ["local_bus"],
                preference: "fastest",
            },
            "2026-05-27T00:00:00.000Z"
        );

        assert.equal(summary.requestStatus, "running");
        assert.equal(summary.requestedAt, "2026-05-27T00:00:00.000Z");
        assert.deepEqual(summary.allowedModes, ["walk"]);
        assert.deepEqual(summary.excludedModes, ["car"]);
        assert.deepEqual(summary.serviceClasses, ["local_bus"]);
        assert.equal(summary.preference, "fastest");
    });

    it("maps API route statuses to DB status", () => {
        assert.equal(mapApiRouteStatusToDbStatus("ok"), "success");
        assert.equal(mapApiRouteStatusToDbStatus("no_route"), "success");
        assert.equal(mapApiRouteStatusToDbStatus("error"), "error");
    });

    it("maps thrown errors to DB status", () => {
        assert.equal(
            mapThrownErrorToDbStatus(new RoutingEngineTimeoutError("valhalla")),
            "timeout"
        );
        assert.equal(
            mapThrownErrorToDbStatus(new RoutingProfileDisabledError("multimodal")),
            "rejected"
        );
        assert.equal(mapThrownErrorToDbStatus(new Error("boom")), "error");
    });

    it("toRouteRequestLogCompletion stores summary metrics", () => {
        const response: NormalizedRouteResponse = {
            status: "ok",
            routingEngine: "valhalla",
            profile: "walk",
            summary: {
                distanceMeters: 1200,
                durationSeconds: 900,
                transferCount: 0,
            },
            geometry: null,
            legs: [],
            warnings: [],
            debug: { buildCode: "myanmar-2026-01" },
        };

        const completion = toRouteRequestLogCompletion(response, 42, { buildCode: "myanmar-2026-01" });
        assert.equal(completion.status, "success");
        assert.equal(completion.distanceM, 1200);
        assert.equal(completion.durationS, 900);
        assert.equal(completion.durationMs, 42);
        assert.equal(completion.requestSummaryPatch.requestStatus, "completed");
        assert.equal(
            (completion.responseSummary as { routeStatus: string }).routeStatus,
            "ok"
        );
        assert.equal(
            (completion.responseSummary as { buildCode: string }).buildCode,
            "myanmar-2026-01"
        );
    });

    it("buildRouteRequestResponseSummary records no_route without geometry", () => {
        const response: NormalizedRouteResponse = {
            status: "no_route",
            routingEngine: "valhalla",
            profile: "car",
            summary: { distanceMeters: 0, durationSeconds: 0, transferCount: 0 },
            geometry: null,
            legs: [],
            warnings: ["No route found"],
        };

        const summary = buildRouteRequestResponseSummary(response);
        assert.equal(summary.routeStatus, "no_route");
        assert.equal(summary.hasGeometry, false);
        assert.equal(summary.warningCount, 1);
    });

    it("toRouteRequestLogFailure captures error fields", () => {
        const completion = toRouteRequestLogFailure(
            new RoutingProfileDisabledError("multimodal"),
            100,
            { engine: "valhalla", buildCode: "b1" }
        );

        assert.equal(completion.status, "rejected");
        assert.equal(completion.errorCode, "ROUTING_PROFILE_DISABLED");
        assert.equal(completion.durationMs, 100);
        assert.equal((completion.responseSummary as { routeStatus: string }).routeStatus, "error");
    });
});
