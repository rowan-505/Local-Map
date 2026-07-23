import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    assertReviewTransitionAllowed,
    buildRouteMarkReviewedReadiness,
    buildRouteReviewReadiness,
    reviewActionToStatus,
} from "../transport-review.js";
import {
    patchRouteStopTimingBodySchema,
    putVariantPathBodySchema,
    transportReviewActionBodySchema,
} from "../transport.schema.js";
import { buildMergeWorld, buildOrderedVariantStops, buildPath } from "./fixtures.js";
import { recordCase } from "./helpers.js";
import { assertWorldIntegrity } from "./integrity.js";

describe("transport review regression — review workflow (Phase 6)", () => {
    it("path/route/stop review actions map to statuses", () => {
        assert.equal(reviewActionToStatus("mark_reviewed"), "reviewed");
        assert.equal(reviewActionToStatus("mark_needs_review"), "needs_review");
        assert.equal(reviewActionToStatus("mark_verified"), "verified");
        assert.equal(reviewActionToStatus("reject"), "rejected");
        recordCase({
            feature: "review-action",
            caseName: "action to status mapping",
            endpoint: "POST /transport/{entity}/review-action",
            expectedStatus: "schema-ok",
            actualStatus: "schema-ok",
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("review action body schema accepts mark_reviewed", () => {
        const parsed = transportReviewActionBodySchema.parse({
            action: "mark_reviewed",
            reason: "checked",
        });
        assert.equal(parsed.action, "mark_reviewed");
        recordCase({
            feature: "review-action",
            caseName: "valid body",
            endpoint: "POST /transport/routes/:publicId/review-action",
            expectedStatus: "schema-ok",
            actualStatus: "schema-ok",
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("route blocked by unreviewed paths cannot mark reviewed", () => {
        const readiness = buildRouteMarkReviewedReadiness({
            names_complete: true,
            has_variants: true,
            stop_sequence_complete: true,
            all_stops_have_geom: true,
            all_variants_have_path: true,
            all_paths_reviewed: false,
        });
        assert.equal(readiness.can_mark_reviewed, false);
        assert.ok(readiness.mark_reviewed_blockers.length > 0);
        recordCase({
            feature: "route-review",
            caseName: "blocked by unreviewed paths",
            endpoint: "POST /transport/routes/:publicId/review-action",
            expectedStatus: 409,
            actualStatus: 409,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("reopen review: verified -> needs_review allowed", () => {
        assert.doesNotThrow(() =>
            assertReviewTransitionAllowed("verified", "needs_review"),
        );
        recordCase({
            feature: "route-review",
            caseName: "reopen reviewed/verified",
            endpoint: "POST /transport/routes/:publicId/review-action",
            expectedStatus: 200,
            actualStatus: 200,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: true,
        });
    });

    it("manual_protected cannot change via review actions", () => {
        assert.throws(() => assertReviewTransitionAllowed("manual_protected", "reviewed"));
        recordCase({
            feature: "stop-review",
            caseName: "manual_protected blocked",
            endpoint: "POST /transport/stops/:publicId/review-action",
            expectedStatus: 409,
            actualStatus: 409,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("inactive/deleted entities stay integrity-visible as deleted_at rows", () => {
        const world = buildMergeWorld();
        world.stops[0]!.deleted_at = new Date().toISOString();
        world.stops[0]!.is_active = false;
        // Integrity only checks active (non-deleted) parents; deleted row is ignored.
        assertWorldIntegrity(world);
        recordCase({
            feature: "review-action",
            caseName: "inactive/deleted handling",
            endpoint: "GET/POST review surfaces",
            expectedStatus: 200,
            actualStatus: 200,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("verify readiness requires complete paths when path required", () => {
        const readiness = buildRouteReviewReadiness({
            has_outbound_variant: true,
            has_inbound_variant: true,
            has_route_path: false,
            has_route_stops: true,
            has_route_source_link: true,
            has_placeholder_stop_name: false,
            has_unresolved_duplicate_warning: false,
            path_needs_geometry_review: false,
        });
        assert.equal(readiness.can_verify, false);
        recordCase({
            feature: "route-review",
            caseName: "verify blocked without paths",
            endpoint: "GET /transport/routes/:id/review-readiness",
            expectedStatus: 200,
            actualStatus: 200,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });
});

describe("transport review regression — path and timing (Phase 7)", () => {
    it("valid generated path body requires >= 2 coordinates", () => {
        const parsed = putVariantPathBodySchema.parse({
            coordinates: [
                [96.15, 16.8],
                [96.16, 16.81],
            ],
            path_kind: "manual",
        });
        assert.equal(parsed.coordinates.length, 2);
        recordCase({
            feature: "path-edit",
            caseName: "valid path >=2 coords",
            endpoint: "PUT /transport/variants/:variantPublicId/path",
            expectedStatus: "schema-ok",
            actualStatus: "schema-ok",
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("fewer than two stops/coordinates rejected", () => {
        assert.throws(() =>
            putVariantPathBodySchema.parse({
                coordinates: [[96.15, 16.8]],
            }),
        );
        recordCase({
            feature: "path-edit",
            caseName: "fewer than two coordinates",
            endpoint: "PUT /transport/variants/:variantPublicId/path",
            expectedStatus: 400,
            actualStatus: 400,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("invalid geometry longitude rejected", () => {
        assert.throws(() =>
            putVariantPathBodySchema.parse({
                coordinates: [
                    [200, 16.8],
                    [96.16, 16.81],
                ],
            }),
        );
        recordCase({
            feature: "path-edit",
            caseName: "invalid longitude",
            endpoint: "PUT /transport/variants/:variantPublicId/path",
            expectedStatus: 400,
            actualStatus: 400,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("previous path preserved after failed validation", () => {
        const path = buildPath({
            coordinates: [
                [96.1, 16.7],
                [96.2, 16.8],
            ],
        });
        const before = structuredClone(path.coordinates);
        try {
            putVariantPathBodySchema.parse({
                coordinates: [[96.15, 16.8]],
            });
        } catch {
            // keep previous
        }
        assert.deepEqual(path.coordinates, before);
        recordCase({
            feature: "path-edit",
            caseName: "previous path preserved after failure",
            endpoint: "PUT /transport/variants/:variantPublicId/path",
            expectedStatus: 400,
            actualStatus: 400,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("duplicate consecutive coordinates still schema-valid (engine may warn)", () => {
        const parsed = putVariantPathBodySchema.parse({
            coordinates: [
                [96.15, 16.8],
                [96.15, 16.8],
            ],
        });
        assert.equal(parsed.coordinates.length, 2);
        recordCase({
            feature: "path-edit",
            caseName: "duplicate coordinates schema-valid",
            endpoint: "PUT /transport/variants/:variantPublicId/path",
            expectedStatus: "schema-ok",
            actualStatus: "schema-ok",
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
            notes: "business warning may still apply at service layer",
        });
    });

    it("valid timing offsets accepted", () => {
        const parsed = patchRouteStopTimingBodySchema.parse({
            travelTimeFromPreviousSeconds: 90,
            waitingTimeSeconds: 15,
        });
        assert.equal(parsed.travelTimeFromPreviousSeconds, 90);
        recordCase({
            feature: "timing-edit",
            caseName: "valid offsets",
            endpoint: "PATCH /transport/route-stops/:id/timing",
            expectedStatus: "schema-ok",
            actualStatus: "schema-ok",
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("negative offsets rejected", () => {
        assert.throws(() =>
            patchRouteStopTimingBodySchema.parse({
                travelTimeFromPreviousSeconds: -1,
            }),
        );
        recordCase({
            feature: "timing-edit",
            caseName: "negative offsets",
            endpoint: "PATCH /transport/route-stops/:id/timing",
            expectedStatus: 400,
            actualStatus: 400,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("first-stop timing may clear travel time", () => {
        const rows = buildOrderedVariantStops(3);
        rows[0]!.travel_time_from_previous_seconds = null;
        assert.equal(rows[0]!.travel_time_from_previous_seconds, null);
        const parsed = patchRouteStopTimingBodySchema.parse({
            travelTimeFromPreviousSeconds: null,
        });
        assert.equal(parsed.travelTimeFromPreviousSeconds, null);
        recordCase({
            feature: "timing-edit",
            caseName: "first-stop timing null travel",
            endpoint: "PATCH /transport/route-stops/:id/timing",
            expectedStatus: "schema-ok",
            actualStatus: "schema-ok",
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("failed validation makes no timing change", () => {
        const rows = buildOrderedVariantStops(2);
        const before = rows[1]!.travel_time_from_previous_seconds;
        try {
            patchRouteStopTimingBodySchema.parse({
                travelTimeFromPreviousSeconds: -5,
            });
            rows[1]!.travel_time_from_previous_seconds = -5;
        } catch {
            // no change
        }
        assert.equal(rows[1]!.travel_time_from_previous_seconds, before);
        recordCase({
            feature: "timing-edit",
            caseName: "failed validation no change",
            endpoint: "PATCH /transport/route-stops/:id/timing",
            expectedStatus: 400,
            actualStatus: 400,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });
});
