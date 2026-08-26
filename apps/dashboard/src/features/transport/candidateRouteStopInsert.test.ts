import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
    buildCandidateRouteStopInsertBody,
    candidateRouteStopInsertDisabled,
    findInsertedCandidateRouteStopId,
} from "./candidateRouteStopInsert";
import { buildInsertAfterContext, buildInsertAtStartContext } from "./routeStopInsertContext";
import { buildRouteStopMutationUpdate } from "./routeStopMutationHelpers";
import TransportStopContextCard from "./TransportStopContextCard";
import type {
    TransportNearbyStopCandidate,
    TransportOrderedStopLite,
    TransportRouteStopItem,
    TransportRouteStopMutationResult,
} from "./types";

function routeStop(id: string, sequence: number): TransportRouteStopItem {
    return {
        id,
        stop_sequence: sequence,
        pickup_type: 0,
        drop_off_type: 0,
        is_timing_point: false,
        distance_from_start_m: null,
        stop: {
            public_id: `stop-${id}`,
            name: `Stop ${id}`,
            name_mm: null,
            name_en: `Stop ${id}`,
            mode: "bus",
            stop_type: "stop",
            geometry: null,
        },
    };
}

function orderedStop(
    routeStopId: string,
    stopPublicId: string,
    sequence: number,
): TransportOrderedStopLite {
    return {
        route_stop_id: routeStopId,
        stop_public_id: stopPublicId,
        stop_sequence: sequence,
        display_name: `Stop ${stopPublicId}`,
        name_mm: null,
        name_en: `Stop ${stopPublicId}`,
        mode: "bus",
        stop_type: "stop",
        longitude: 96,
        latitude: 16,
        actual_longitude: null,
        actual_latitude: null,
        geometry_source: "stop_geom",
        pickup_type: 0,
        drop_off_type: 0,
        is_timing_point: false,
        review_status: "needs_review",
        source_time_text: null,
        source_time_type: null,
        travel_time_from_previous_seconds: null,
        waiting_time_seconds: null,
        arrival_offset_seconds: null,
        departure_offset_seconds: null,
        is_loop_closure: false,
    };
}

describe("candidate route-stop insertion", () => {
    it("builds native before and after requests around the selected route_stop occurrence", () => {
        assert.deepEqual(
            buildCandidateRouteStopInsertBody("candidate-stop", "route-stop-20", "before"),
            {
                stopPublicId: "candidate-stop",
                position: "before",
                anchorRouteStopId: "route-stop-20",
            },
        );
        assert.deepEqual(
            buildCandidateRouteStopInsertBody("candidate-stop", "route-stop-20", "after"),
            {
                stopPublicId: "candidate-stop",
                position: "after",
                anchorRouteStopId: "route-stop-20",
            },
        );
    });

    it("uses native before for the first route_stop occurrence", () => {
        const first = routeStop("route-stop-10", 1);
        assert.deepEqual(
            buildCandidateRouteStopInsertBody("candidate-stop", first.id, "before"),
            {
                stopPublicId: "candidate-stop",
                position: "before",
                anchorRouteStopId: "route-stop-10",
            },
        );
    });

    it("applies the server-returned gap-free order and identifies the new occurrence", () => {
        const previousStops = [routeStop("route-stop-10", 1), routeStop("route-stop-20", 2)];
        const result: TransportRouteStopMutationResult = {
            variant_public_id: "variant-1",
            ordered_stops: [
                orderedStop("route-stop-10", "stop-route-stop-10", 1),
                orderedStop("route-stop-new", "candidate-stop", 2),
                orderedStop("route-stop-20", "stop-route-stop-20", 3),
            ],
            route_stop_count: 3,
            has_verified_path: true,
            has_review_placeholder_path: false,
        };

        const update = buildRouteStopMutationUpdate(result, "variant-1", 2);
        assert.deepEqual(
            update?.orderedStops.map((stop) => [stop.id, stop.stop_sequence]),
            [
                ["route-stop-10", 1],
                ["route-stop-new", 2],
                ["route-stop-20", 3],
            ],
        );
        assert.equal(
            findInsertedCandidateRouteStopId(result, previousStops, "candidate-stop"),
            "route-stop-new",
        );
    });

    it("disables candidate insertion without an anchor or while a mutation is busy", () => {
        assert.equal(
            candidateRouteStopInsertDisabled({
                canWrite: true,
                busy: false,
                selectedVariantId: "variant-1",
                selectedRouteStopId: null,
            }),
            true,
        );
        assert.equal(
            candidateRouteStopInsertDisabled({
                canWrite: true,
                busy: true,
                selectedVariantId: "variant-1",
                selectedRouteStopId: "route-stop-10",
            }),
            true,
        );
    });

    it("keeps the existing + gap semantics unchanged", () => {
        const first = routeStop("route-stop-10", 1);
        const second = routeStop("route-stop-20", 2);
        assert.equal(buildInsertAtStartContext([first, second]).apiPosition, "start");
        assert.deepEqual(buildInsertAfterContext(first, second), {
            uiPosition: "between",
            apiPosition: "after",
            anchorRouteStopId: first.id,
            previousStop: { id: first.id, name: first.stop.name, stop_sequence: 1 },
            nextStop: { id: second.id, name: second.stop.name, stop_sequence: 2 },
            near: null,
        });
    });

    it("renders insert actions separately while preserving candidate merge actions", () => {
        const candidate: TransportNearbyStopCandidate = {
            id: "1",
            publicId: "candidate-stop",
            name: "Candidate",
            nameMy: null,
            nameEn: "Candidate",
            mode: "bus",
            stopType: "stop",
            reviewStatus: "needs_review",
            confidenceScore: null,
            lat: 16,
            lng: 96,
            distanceMeters: 10,
        };
        const markup = renderToStaticMarkup(
            createElement(TransportStopContextCard, {
                mode: "nearby_candidate_stop",
                candidate,
                candidateInsertActions: [
                    { label: "Add before #2", onClick() {}, disabled: true },
                    { label: "Add after #2", onClick() {}, disabled: true },
                ],
                candidateCheckRoutesAction: { label: "Check routes", onClick() {} },
                candidateKeepCurrentAction: { label: "Keep current stop", onClick() {} },
                candidateKeepCandidateAction: { label: "Keep candidate stop", onClick() {} },
                candidateCompareMergeAction: { label: "Compare & merge", onClick() {} },
            }),
        );

        assert.match(markup, /Add before #2/);
        assert.match(markup, /Add after #2/);
        assert.match(markup, /<button[^>]*disabled=""[^>]*>Add before #2<\/button>/);
        assert.match(markup, /<button[^>]*disabled=""[^>]*>Add after #2<\/button>/);
        assert.match(markup, /Check routes/);
        assert.match(markup, /Keep current stop/);
        assert.match(markup, /Keep candidate stop/);
        assert.match(markup, /Compare &amp; merge/);
    });
});
