import assert from "node:assert/strict";
import test from "node:test";

import { FieldService } from "./field.service.js";
import type { FieldRepository } from "./field.repo.js";
import { snapshotRevisionFromParts, type FieldRevisionParts } from "./field-revision.js";

const parts: FieldRevisionParts = {
    routeCount: 1,
    variantCount: 2,
    stopCount: 2,
    routeStopCount: 4,
    pathCount: 2,
    routeStopSequenceSum: 10,
    maxRouteStopId: 40,
    maxUpdatedAtMs: 1_700_000_000_000,
};

function repoStub(overrides: Partial<FieldRepository> = {}): FieldRepository {
    return {
        loadRevisionParts: async () => parts,
        loadSnapshot: async () => {
            throw new Error("loadSnapshot should not run");
        },
        ...overrides,
    } as FieldRepository;
}

test("matching client revision skips the geometry snapshot load", async () => {
    let snapshotLoads = 0;
    const service = new FieldService(
        repoStub({
            async loadSnapshot() {
                snapshotLoads += 1;
                return { routes: [], variants: [], stops: [], routeStops: [], routePaths: [] };
            },
        })
    );
    const revision = snapshotRevisionFromParts(parts);
    const result = await service.bootstrap(revision);
    assert.deepEqual(result, { snapshotRevision: revision, unchanged: true });
    assert.equal(snapshotLoads, 0);
});

test("missing or stale revision returns the compact dataset", async () => {
    const routeId = "11111111-1111-4111-8111-111111111111";
    const variantId = "22222222-2222-4222-8222-222222222222";
    const stopId = "33333333-3333-4333-8333-333333333333";
    const service = new FieldService(
        repoStub({
            async loadSnapshot() {
                return {
                    routes: [
                        {
                            public_id: routeId,
                            route_code: "YBS-13",
                            name_my: "၁၃",
                            name_en: "13",
                        },
                    ],
                    variants: [
                        {
                            public_id: variantId,
                            route_public_id: routeId,
                            route_code: "YBS-13",
                            direction_id: 0,
                            origin_name: "A",
                            destination_name: "B",
                        },
                    ],
                    stops: [
                        {
                            public_id: stopId,
                            stop_code: "S1",
                            name_my: null,
                            name_en: "Stop",
                            lat: 16.8,
                            lng: 96.15,
                        },
                    ],
                    routeStops: [
                        {
                            variant_public_id: variantId,
                            stop_public_id: stopId,
                            stop_sequence: 1,
                        },
                    ],
                    routePaths: [
                        {
                            variant_public_id: variantId,
                            geometry: {
                                type: "LineString",
                                coordinates: [
                                    [96.15, 16.78],
                                    [96.16, 16.79],
                                ],
                            },
                        },
                    ],
                };
            },
        })
    );

    const result = await service.bootstrap("v1-stale");
    assert.equal(result.unchanged, false);
    if (result.unchanged) {
        return;
    }
    assert.equal(result.routes[0]?.routeCode, "YBS-13");
    assert.equal(result.variants[0]?.variantCode, "D0");
    assert.equal(result.routeStops[0]?.stopSequence, 1);
    assert.equal(result.routePaths[0]?.geometry.type, "LineString");
});
