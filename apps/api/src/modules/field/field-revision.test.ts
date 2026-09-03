import assert from "node:assert/strict";
import test from "node:test";

import { snapshotRevisionFromParts, type FieldRevisionParts } from "./field-revision.js";

const base: FieldRevisionParts = {
    routeCount: 140,
    variantCount: 280,
    stopCount: 4000,
    routeStopCount: 18000,
    pathCount: 280,
    routeStopSequenceSum: 900000,
    maxRouteStopId: 120000,
    maxUpdatedAtMs: 1_720_000_000_000,
};

test("revision fingerprint is stable for the same parts", () => {
    assert.equal(snapshotRevisionFromParts(base), snapshotRevisionFromParts({ ...base }));
    assert.match(snapshotRevisionFromParts(base), /^v1-[0-9a-f]{32}$/);
});

test("revision fingerprint changes when counts or timestamps change", () => {
    const same = snapshotRevisionFromParts(base);
    assert.notEqual(snapshotRevisionFromParts({ ...base, routeCount: 141 }), same);
    assert.notEqual(snapshotRevisionFromParts({ ...base, maxUpdatedAtMs: base.maxUpdatedAtMs + 1 }), same);
    assert.notEqual(snapshotRevisionFromParts({ ...base, routeStopSequenceSum: base.routeStopSequenceSum + 1 }), same);
});
