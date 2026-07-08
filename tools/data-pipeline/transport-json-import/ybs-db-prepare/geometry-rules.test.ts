import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    TARGET_REVIEW_LINE_LENGTH_MAX_M,
    TARGET_REVIEW_LINE_LENGTH_MIN_M,
    applyDeterministicJitter,
    buildStraightLineReviewRoutePath,
    buildStraightLineReviewVariantLine,
    buildSyntheticVariantLine,
    generateSyntheticPlaceholderStops,
    haversineDistanceMeters,
    resolveStraightLineReviewStopGeometries,
    resolveVariantStopGeometries,
} from "./geometry-rules.js";

describe("straight_line_review placeholder geometry", () => {
    it("creates deterministic variant lines inside Yangon review bbox with 3-6 km length", () => {
        const outbound = buildStraightLineReviewVariantLine("YBS-2", "outbound");
        const inbound = buildStraightLineReviewVariantLine("YBS-2", "inbound");
        const repeat = buildStraightLineReviewVariantLine("YBS-2", "outbound");

        assert.deepEqual(outbound.start, repeat.start);
        assert.ok(outbound.length_m >= TARGET_REVIEW_LINE_LENGTH_MIN_M);
        assert.ok(outbound.length_m <= TARGET_REVIEW_LINE_LENGTH_MAX_M + 1);
        assert.ok(outbound.start.lng >= 96.05 && outbound.start.lng <= 96.25);
        assert.ok(outbound.start.lat >= 16.75 && outbound.start.lat <= 16.92);
        assert.notDeepEqual(outbound.start, inbound.start);
        assert.notDeepEqual(outbound.end, inbound.end);
    });

    it("builds a two-point straight route path, not a spider through stops", () => {
        const path = buildStraightLineReviewRoutePath("YBS-2", "outbound");
        assert.ok(path);
        assert.equal(path.geometry.coordinates.length, 2);
        assert.ok(path.line.length_m >= TARGET_REVIEW_LINE_LENGTH_MIN_M);
    });

    it("places all new stops evenly on the straight line", () => {
        const stops = [
            { sequence: 1, candidate_id: "a", geometry: null, geom_source: null },
            { sequence: 2, candidate_id: "b", geometry: null, geom_source: null },
            { sequence: 3, candidate_id: "c", geometry: null, geom_source: null },
        ];

        const result = resolveStraightLineReviewStopGeometries({
            stops,
            routeCode: "YBS-2",
            directionKey: "outbound",
        });

        assert.equal(result.resolved.size, 3);
        assert.equal(result.interpolated_geometry_count, 0);
        assert.equal(result.generated_stop_points_count, 3);
        assert.equal(result.reused_existing_stop_count, 0);

        const line = buildStraightLineReviewVariantLine("YBS-2", "outbound");
        const first = result.resolved.get("a:1")!.geometry;
        const last = result.resolved.get("c:3")!.geometry;
        assert.ok(haversineDistanceMeters(first, line.start) < 50);
        assert.ok(haversineDistanceMeters(last, line.end) < 50);
    });

    it("keeps reused existing stop geometry and does not move it", () => {
        const existingPoint = { lng: 96.18, lat: 16.81 };
        const stops = [
            {
                sequence: 1,
                candidate_id: "a",
                geometry: existingPoint,
                geom_source: "existing_supabase_stop",
            },
            { sequence: 2, candidate_id: "b", geometry: null, geom_source: null },
            { sequence: 3, candidate_id: "c", geometry: null, geom_source: null },
        ];

        const result = resolveStraightLineReviewStopGeometries({
            stops,
            routeCode: "YBS-2",
            directionKey: "outbound",
        });

        assert.equal(result.reused_existing_stop_count, 1);
        assert.equal(result.existing_reused_stops_not_moved_count, 1);
        assert.equal(result.generated_stop_points_count, 2);
        assert.deepEqual(result.resolved.get("a:1")!.geometry, existingPoint);
        assert.ok(result.resolved.get("a:1")!.review_geometry);
        assert.notDeepEqual(result.resolved.get("a:1")!.review_geometry, existingPoint);
    });

    it("does not build spider paths when legacy resolver mixed anchors", () => {
        const scatteredAnchors = [
            {
                sequence: 1,
                candidate_id: "a",
                geometry: { lng: 96.1, lat: 16.8 },
                geom_source: "existing_supabase_stop",
            },
            {
                sequence: 5,
                candidate_id: "e",
                geometry: { lng: 96.2, lat: 16.9 },
                geom_source: "existing_supabase_stop",
            },
            { sequence: 3, candidate_id: "c", geometry: null, geom_source: null },
        ];

        const legacy = resolveVariantStopGeometries({
            stops: scatteredAnchors,
            routeCode: "YBS-2",
            directionKey: "outbound",
        });
        const straight = resolveStraightLineReviewStopGeometries({
            stops: scatteredAnchors,
            routeCode: "YBS-2",
            directionKey: "outbound",
        });

        const legacyPathPoints = [...legacy.resolved.values()].map((row) => row.geometry);
        const legacySpan = haversineDistanceMeters(legacyPathPoints[0], legacyPathPoints.at(-1)!);

        const reviewPath = buildStraightLineReviewRoutePath("YBS-2", "outbound")!;
        assert.ok(reviewPath.line.length_m < legacySpan);
        assert.equal(straight.interpolated_geometry_count, 0);
    });
});

describe("synthetic placeholder geometry (legacy helpers)", () => {
    it("keeps buildSyntheticVariantLine compatible with straight-line review", () => {
        const outbound = buildSyntheticVariantLine("YBS-2", "outbound");
        const review = buildStraightLineReviewVariantLine("YBS-2", "outbound");
        assert.deepEqual(outbound.start, review.start);
        assert.deepEqual(outbound.end, review.end);
    });

    it("generates the same stop coordinates for the same input", () => {
        const stops = [
            { sequence: 1, candidate_id: "a", geometry: null, geom_source: null },
            { sequence: 2, candidate_id: "b", geometry: null, geom_source: null },
            { sequence: 3, candidate_id: "c", geometry: null, geom_source: null },
        ];

        const first = generateSyntheticPlaceholderStops(stops, "YBS-2", "outbound");
        const second = generateSyntheticPlaceholderStops(stops, "YBS-2", "outbound");

        assert.deepEqual(first, second);
        assert.equal(first.length, 3);
        assert.notDeepEqual(first[0].geometry, first[1].geometry);
    });

    it("applies deterministic jitter within 10 meters", () => {
        const base = { lng: 96.15, lat: 16.8 };
        const jittered = applyDeterministicJitter(base, "YBS-1", "outbound", 4);
        assert.notDeepEqual(jittered, base);
        assert.ok(haversineDistanceMeters(base, jittered) <= 10.5);
    });
});
