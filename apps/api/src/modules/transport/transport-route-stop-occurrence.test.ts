import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NormalizedRouteResponse } from "../routing/routing.types.js";
import {
    extractOrderedRouteStopCoordinates,
    isCircularClosingRouteStop,
    mergeRouteLineStrings,
    routeThroughOrderedCoordinates,
} from "./transport-route-stop-occurrence.js";

describe("isCircularClosingRouteStop", () => {
    it("returns true when circular_closing_occurrence is set", () => {
        assert.equal(
            isCircularClosingRouteStop({ circular_closing_occurrence: true }),
            true,
        );
        assert.equal(
            isCircularClosingRouteStop({ circular_closing_occurrence: "true" }),
            true,
        );
    });

    it("returns false for normal rows", () => {
        assert.equal(isCircularClosingRouteStop(null), false);
        assert.equal(isCircularClosingRouteStop({}), false);
    });
});

describe("extractOrderedRouteStopCoordinates", () => {
    it("keeps every ordered occurrence without stop_id dedupe", () => {
        const coords = extractOrderedRouteStopCoordinates([
            { stop_sequence: 1, lng: 96.1, lat: 16.8 },
            { stop_sequence: 2, lng: 96.2, lat: 16.81 },
            { stop_sequence: 39, lng: 96.1, lat: 16.8 },
        ]);

        assert.equal(coords.length, 3);
        assert.deepEqual(coords[0], [96.1, 16.8]);
        assert.deepEqual(coords[2], [96.1, 16.8]);
    });
});

describe("mergeRouteLineStrings", () => {
    it("joins segments and drops duplicate vertices", () => {
        const merged = mergeRouteLineStrings([
            {
                type: "LineString",
                coordinates: [
                    [96.1, 16.8],
                    [96.15, 16.82],
                ],
            },
            {
                type: "LineString",
                coordinates: [
                    [96.15, 16.82],
                    [96.1, 16.8],
                ],
            },
        ]);

        assert.ok(merged);
        assert.equal(merged!.coordinates.length, 3);
        assert.deepEqual(merged!.coordinates[0], [96.1, 16.8]);
        assert.deepEqual(merged!.coordinates[2], [96.1, 16.8]);
    });
});

describe("routeThroughOrderedCoordinates", () => {
    it("routes each consecutive pair including the closing occurrence", async () => {
        const calls: Array<{ from: [number, number]; to: [number, number] }> = [];

        const result = await routeThroughOrderedCoordinates(
            [
                [96.1, 16.8],
                [96.2, 16.81],
                [96.1, 16.8],
            ],
            "car",
            async (request): Promise<NormalizedRouteResponse> => {
                calls.push({
                    from: [request.origin.lng, request.origin.lat],
                    to: [request.destination.lng, request.destination.lat],
                });
                return {
                    status: "ok",
                    routingEngine: "valhalla",
                    profile: "car",
                    summary: { distanceMeters: 1000, durationSeconds: 120, transferCount: 0 },
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [request.origin.lng, request.origin.lat],
                            [request.destination.lng, request.destination.lat],
                        ],
                    },
                    legs: [],
                    warnings: [],
                };
            },
        );

        assert.equal(calls.length, 2);
        assert.deepEqual(calls[0]!.to, [96.2, 16.81]);
        assert.deepEqual(calls[1]!.to, [96.1, 16.8]);
        assert.equal(result.geometry.coordinates.length, 3);
        assert.equal(result.distanceMeters, 2000);
    });

    it("keeps linear unique-stop routes unchanged (one segment per hop)", async () => {
        const result = await routeThroughOrderedCoordinates(
            [
                [96.1, 16.8],
                [96.2, 16.81],
                [96.3, 16.82],
            ],
            "car",
            async (request): Promise<NormalizedRouteResponse> => ({
                status: "ok",
                routingEngine: "valhalla",
                profile: "car",
                summary: { distanceMeters: 500, durationSeconds: 60, transferCount: 0 },
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [request.origin.lng, request.origin.lat],
                        [request.destination.lng, request.destination.lat],
                    ],
                },
                legs: [],
                warnings: [],
            }),
        );

        assert.equal(result.geometry.coordinates.length, 3);
        assert.equal(result.distanceMeters, 1000);
    });
});
