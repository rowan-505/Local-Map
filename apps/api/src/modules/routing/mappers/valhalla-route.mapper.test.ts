import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeValhallaPolyline } from "./valhalla-polyline.js";
import { mapProfileToValhallaCosting, resolveValhallaCosting } from "./profile-to-valhalla-costing.js";
import { buildValhallaRouteRequest, mapValhallaRouteResponse } from "./valhalla-route.mapper.js";

describe("valhalla route mapper", () => {
    it("maps profiles to Valhalla costing modes", () => {
        assert.equal(mapProfileToValhallaCosting("walk"), "pedestrian");
        assert.equal(mapProfileToValhallaCosting("car"), "auto");
        assert.equal(resolveValhallaCosting("motorcycle").costing, "motorcycle");
    });

    it("builds Valhalla request with lon (not lng) and kilometers", () => {
        const { payload } = buildValhallaRouteRequest({
            origin: { lat: 1, lng: 2 },
            destination: { lat: 3, lng: 4 },
            profile: "car",
        });
        assert.deepEqual(payload.locations, [
            { lat: 1, lon: 2 },
            { lat: 3, lon: 4 },
        ]);
        assert.equal(payload.costing, "auto");
        assert.equal(payload.directions_options?.units, "kilometers");
        assert.equal(payload.shape_format, "geojson");
    });

    it("maps a successful Valhalla trip to normalized response with maneuvers", () => {
        const response = mapValhallaRouteResponse(
            {
                trip: {
                    status: 0,
                    summary: { length: 2.5, time: 300 },
                    shape: {
                        type: "LineString",
                        coordinates: [
                            [96.1, 16.8],
                            [96.2, 16.9],
                        ],
                    },
                    legs: [
                        {
                            summary: { length: 2.5, time: 300 },
                            shape: {
                                type: "LineString",
                                coordinates: [
                                    [96.1, 16.8],
                                    [96.2, 16.9],
                                ],
                            },
                            maneuvers: [
                                { instruction: "Drive west.", length: 2.5, time: 300 },
                            ],
                        },
                    ],
                },
            },
            {
                origin: { lat: 16.8, lng: 96.1 },
                destination: { lat: 16.9, lng: 96.2 },
                profile: "car",
            }
        );

        assert.equal(response.status, "ok");
        assert.equal(response.routingEngine, "valhalla");
        assert.equal(response.summary.distanceMeters, 2500);
        assert.equal(response.summary.durationSeconds, 300);
        assert.equal(response.geometry?.type, "LineString");
        assert.equal(response.legs[0]?.instructions?.[0], "Drive west.");
    });

    it("returns no_route for Valhalla path-not-found error codes", () => {
        const response = mapValhallaRouteResponse(
            { error: "No path could be found", error_code: 442 },
            {
                origin: { lat: 1, lng: 2 },
                destination: { lat: 3, lng: 4 },
                profile: "walk",
            }
        );
        assert.equal(response.status, "no_route");
        assert.equal(response.geometry, null);
    });

    it("decodes encoded polyline shapes when geojson is absent", () => {
        const coords = decodeValhallaPolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
        assert.ok(coords.length >= 2);

        const response = mapValhallaRouteResponse(
            {
                trip: {
                    status: 0,
                    summary: { length: 1, time: 60 },
                    shape: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
                    legs: [],
                },
            },
            {
                origin: { lat: 38.5, lng: -120.2 },
                destination: { lat: 40.7, lng: -120.95 },
                profile: "walk",
            }
        );

        assert.equal(response.status, "ok");
        assert.ok(response.geometry && response.geometry.coordinates.length >= 2);
        assert.ok(response.warnings.some((w) => w.includes("polyline")));
    });
});
