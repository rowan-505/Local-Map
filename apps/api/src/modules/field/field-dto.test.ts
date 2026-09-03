import assert from "node:assert/strict";
import test from "node:test";

import {
    asLineString,
    sortRouteStops,
    toFieldRoutePath,
    toFieldRouteStop,
    toFieldStop,
    toFieldVariant,
} from "./field-dto.js";

test("field variants use D0/D1 labels from canonical YBS identity", () => {
    const d0 = toFieldVariant({
        public_id: "11111111-1111-4111-8111-111111111111",
        route_public_id: "22222222-2222-4222-8222-222222222222",
        route_code: "YBS-13",
        direction_id: 0,
        origin_name: "A",
        destination_name: "B",
    });
    const d1 = toFieldVariant({
        public_id: "33333333-3333-4333-8333-333333333333",
        route_public_id: "22222222-2222-4222-8222-222222222222",
        route_code: "YBS-13",
        direction_id: 1,
        origin_name: "B",
        destination_name: "A",
    });

    assert.equal(d0?.variantCode, "D0");
    assert.equal(d0?.directionId, 0);
    assert.equal(d1?.variantCode, "D1");
    assert.equal(d1?.directionId, 1);
    assert.equal(
        toFieldVariant({
            public_id: "44444444-4444-4444-8444-444444444444",
            route_public_id: "22222222-2222-4222-8222-222222222222",
            route_code: "YBS-13",
            direction_id: 2,
            origin_name: null,
            destination_name: null,
        }),
        null
    );
});

test("routeStops keep occurrence sequence as the occurrence key", () => {
    const variant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const stopA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const stopB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const mapped = [
        toFieldRouteStop({ variant_public_id: variant, stop_public_id: stopA, stop_sequence: 1 }),
        toFieldRouteStop({ variant_public_id: variant, stop_public_id: stopA, stop_sequence: 4 }),
        toFieldRouteStop({ variant_public_id: variant, stop_public_id: stopB, stop_sequence: 2 }),
        toFieldRouteStop({ variant_public_id: variant, stop_public_id: stopA, stop_sequence: 0 }),
    ].filter((row): row is NonNullable<typeof row> => row !== null);

    assert.deepEqual(
        sortRouteStops(mapped).map((row) => [row.stopPublicId, row.stopSequence]),
        [
            [stopA, 1],
            [stopB, 2],
            [stopA, 4],
        ]
    );
});

test("route path geometry is GeoJSON LineString", () => {
    const path = toFieldRoutePath({
        variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        geometry: {
            type: "LineString",
            coordinates: [
                [96.15, 16.78],
                [96.16, 16.79],
            ],
        },
    });
    assert.equal(path?.geometry.type, "LineString");
    assert.equal(path?.geometry.coordinates.length, 2);
    assert.equal(asLineString({ type: "Point", coordinates: [96, 16] }), null);
});

test("stops require finite lat/lng", () => {
    const ok = toFieldStop({
        public_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        stop_code: "S1",
        name_my: "မြန်မာ",
        name_en: "Stop",
        lat: 16.8,
        lng: 96.15,
    });
    assert.equal(ok?.lat, 16.8);
    assert.equal(
        toFieldStop({
            public_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            stop_code: null,
            name_my: null,
            name_en: null,
            lat: Number.NaN,
            lng: 96,
        }),
        null
    );
});
