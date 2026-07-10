import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildRouteStopMutationUpdate,
    isValidOrderedStopsMutationResponse,
    pruneStopMoveDrafts,
    resolveSelectedRouteStopIdAfterMutation,
} from "./routeStopMutationHelpers";
import type { TransportRouteStopItem } from "./types";

function stop(id: string, sequence: number): TransportRouteStopItem {
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

describe("routeStopMutationHelpers", () => {
    it("builds ordered stops and count delta from mutation response", () => {
        const update = buildRouteStopMutationUpdate(
            {
                variant_public_id: "variant-1",
                ordered_stops: [
                    {
                        route_stop_id: "10",
                        stop_public_id: "aaa",
                        stop_sequence: 1,
                        display_name: "A",
                        name_mm: null,
                        name_en: "A",
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
                    },
                ],
                route_stop_count: 1,
                has_verified_path: false,
                has_review_placeholder_path: false,
            },
            "variant-1",
            0,
        );

        assert.ok(update);
        assert.equal(update?.orderedStops.length, 1);
        assert.equal(update?.stopCountDelta, 1);
    });

    it("preserves selection when route_stop still exists", () => {
        const ordered = [stop("10", 1), stop("11", 2)];
        assert.equal(
            resolveSelectedRouteStopIdAfterMutation("10", ordered),
            "10",
        );
        assert.equal(resolveSelectedRouteStopIdAfterMutation("99", ordered), null);
    });

    it("prunes drafts for removed route stops only", () => {
        const ordered = [stop("10", 1)];
        const next = pruneStopMoveDrafts(
            { "10": { lng: 96, lat: 16 }, "11": { lng: 96.1, lat: 16.1 } },
            ordered,
        );
        assert.deepEqual(next, { "10": { lng: 96, lat: 16 } });
    });

    it("accepts a valid ordered_stops mutation response", () => {
        assert.equal(
            isValidOrderedStopsMutationResponse(
                [
                    {
                        route_stop_id: "10",
                        stop_public_id: "a",
                        stop_sequence: 1,
                        display_name: "A",
                        name_mm: null,
                        name_en: "A",
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
                    },
                ],
                1,
            ),
            true,
        );
    });

    it("rejects duplicate route_stop ids and sequence gaps", () => {
        const base = {
            stop_public_id: "a",
            display_name: "A",
            name_mm: null,
            name_en: "A",
            mode: "bus",
            stop_type: "stop",
            longitude: 96,
            latitude: 16,
            actual_longitude: null,
            actual_latitude: null,
            geometry_source: "stop_geom" as const,
            pickup_type: 0,
            drop_off_type: 0,
            is_timing_point: false,
            review_status: "needs_review" as const,
            source_time_text: null,
            source_time_type: null,
            travel_time_from_previous_seconds: null,
            waiting_time_seconds: null,
            arrival_offset_seconds: null,
            departure_offset_seconds: null,
            is_loop_closure: false,
        };
        assert.equal(
            isValidOrderedStopsMutationResponse(
                [
                    { ...base, route_stop_id: "10", stop_sequence: 1 },
                    { ...base, route_stop_id: "10", stop_sequence: 2 },
                ],
                2,
            ),
            false,
        );
        assert.equal(
            isValidOrderedStopsMutationResponse(
                [{ ...base, route_stop_id: "10", stop_sequence: 2 }],
                1,
            ),
            false,
        );
    });
});
