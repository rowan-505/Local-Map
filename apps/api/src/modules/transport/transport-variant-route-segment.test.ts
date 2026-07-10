import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    findStopOccurrencesOnVariant,
    selectBestForwardOccurrencePair,
    sliceStopsBetweenOccurrencePair,
    type VariantStopOccurrence,
} from "./transport-variant-route-segment.js";

function occ(
    routeStopId: number,
    stopId: number,
    stopSequence: number,
): VariantStopOccurrence {
    return {
        route_stop_id: routeStopId,
        stop_id: stopId,
        stop_sequence: stopSequence,
    };
}

/** Linear YBS-style variant: unique stop_id per sequence. */
const linearStops: VariantStopOccurrence[] = [
    occ(1, 100, 1),
    occ(2, 101, 2),
    occ(3, 102, 3),
    occ(4, 103, 4),
    occ(5, 104, 5),
];

/** Circular train: Yangon Central (stop_id 1) at seq 1 and 39. */
const circularStops: VariantStopOccurrence[] = [
    ...Array.from({ length: 38 }, (_, index) => {
        const sequence = index + 1;
        return occ(sequence, sequence === 1 ? 1 : sequence + 10, sequence);
    }),
    occ(39, 1, 39),
];

describe("findStopOccurrencesOnVariant", () => {
    it("returns every matching occurrence in sequence order", () => {
        const rows = findStopOccurrencesOnVariant(circularStops, 1);
        assert.deepEqual(
            rows.map((row) => row.stop_sequence),
            [1, 39],
        );
    });
});

describe("selectBestForwardOccurrencePair", () => {
    it("keeps linear route behavior unchanged", () => {
        const pair = selectBestForwardOccurrencePair(linearStops, 101, 104);
        assert.ok(pair);
        assert.equal(pair.origin.stop_sequence, 2);
        assert.equal(pair.destination.stop_sequence, 5);
        assert.equal(pair.forward_sequence_span, 3);
    });

    it("picks Yangon Central closing occurrence for seq 37 → Yangon Central", () => {
        const pair = selectBestForwardOccurrencePair(circularStops, 47, 1);
        assert.ok(pair);
        assert.equal(pair.origin.stop_sequence, 37);
        assert.equal(pair.destination.stop_sequence, 39);
        assert.equal(pair.forward_sequence_span, 2);
    });

    it("does not wrap from late sequence to the opening occurrence", () => {
        const pair = selectBestForwardOccurrencePair(circularStops, 47, 1);
        assert.notEqual(pair?.destination.stop_sequence, 1);
    });

    it("rejects backward pairs on linear routes", () => {
        const pair = selectBestForwardOccurrencePair(linearStops, 104, 101);
        assert.equal(pair, null);
    });

    it("allows same stop_id at two occurrences when destination is forward", () => {
        const pair = selectBestForwardOccurrencePair(circularStops, 1, 1);
        assert.ok(pair);
        assert.equal(pair.origin.stop_sequence, 1);
        assert.equal(pair.destination.stop_sequence, 39);
    });

    it("chooses the smallest forward span when multiple valid pairs exist", () => {
        const stops: VariantStopOccurrence[] = [
            occ(1, 10, 1),
            occ(2, 20, 5),
            occ(3, 10, 8),
            occ(4, 20, 12),
            occ(5, 10, 20),
        ];
        const pair = selectBestForwardOccurrencePair(stops, 10, 20);
        assert.ok(pair);
        assert.equal(pair.origin.stop_sequence, 8);
        assert.equal(pair.destination.stop_sequence, 12);
        assert.equal(pair.forward_sequence_span, 4);
    });
});

describe("sliceStopsBetweenOccurrencePair", () => {
    it("returns inclusive forward segment for circular closing leg", () => {
        const pair = selectBestForwardOccurrencePair(circularStops, 47, 1);
        assert.ok(pair);
        const segment = sliceStopsBetweenOccurrencePair(circularStops, pair);
        assert.deepEqual(
            segment.map((row) => row.stop_sequence),
            [37, 38, 39],
        );
    });

    it("returns inclusive forward segment for linear routes", () => {
        const pair = selectBestForwardOccurrencePair(linearStops, 101, 103);
        assert.ok(pair);
        const segment = sliceStopsBetweenOccurrencePair(linearStops, pair);
        assert.deepEqual(
            segment.map((row) => row.stop_sequence),
            [2, 3, 4],
        );
    });
});
