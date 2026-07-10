import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    resolvePlaceholderStopGeometryFromSequence,
    resolvePlaceholderStopGeometry,
    type RouteStopGeometryPoint,
} from "./transport-stop-placeholder-geometry.js";

function row(
    id: string,
    sequence: number,
    longitude: number,
    latitude: number
): RouteStopGeometryPoint {
    return {
        route_stop_id: id,
        stop_sequence: sequence,
        longitude,
        latitude,
    };
}

describe("resolvePlaceholderStopGeometryFromSequence", () => {
    const rows = [row("1", 1, 96.0, 16.0), row("2", 2, 96.2, 16.2), row("3", 3, 96.4, 16.4)];

    it("copies the first stop at start", () => {
        const result = resolvePlaceholderStopGeometryFromSequence(rows, "start");
        assert.deepEqual(result, { longitude: 96.0, latitude: 16.0 });
    });

    it("copies the last stop at end", () => {
        const result = resolvePlaceholderStopGeometryFromSequence(rows, "end");
        assert.deepEqual(result, { longitude: 96.4, latitude: 16.4 });
    });

    it("uses the midpoint between neighbours for after", () => {
        const result = resolvePlaceholderStopGeometryFromSequence(rows, "after", "2");
        assert.deepEqual(result, { longitude: 96.3, latitude: 16.3 });
    });

    it("uses the midpoint between neighbours for before", () => {
        const result = resolvePlaceholderStopGeometryFromSequence(rows, "before", "2");
        assert.deepEqual(result, { longitude: 96.1, latitude: 16.1 });
    });

    it("copies the anchor when inserting after the last stop", () => {
        const result = resolvePlaceholderStopGeometryFromSequence(rows, "after", "3");
        assert.deepEqual(result, { longitude: 96.4, latitude: 16.4 });
    });

    it("returns null for an empty variant", () => {
        assert.equal(resolvePlaceholderStopGeometryFromSequence([], "start"), null);
    });
});

describe("resolvePlaceholderStopGeometry", () => {
    it("uses review map center when the variant sequence has no geometry", () => {
        const result = resolvePlaceholderStopGeometry([], "start", undefined, {
            longitude: 96.15,
            latitude: 16.78,
        });
        assert.deepEqual(result, {
            geometry: { longitude: 96.15, latitude: 16.78 },
            source: "review_map_center",
        });
    });

    it("prefers sequence geometry over the map fallback", () => {
        const rows = [row("1", 1, 96.0, 16.0)];
        const result = resolvePlaceholderStopGeometry(rows, "start", undefined, {
            longitude: 99,
            latitude: 19,
        });
        assert.equal(result?.source, "route_sequence");
        assert.deepEqual(result?.geometry, { longitude: 96.0, latitude: 16.0 });
    });
});
