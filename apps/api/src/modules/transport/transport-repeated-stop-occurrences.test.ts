import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NormalizedRouteResponse } from "../routing/routing.types.js";
import { assertSameVariantMergeAcknowledged } from "./stopMergeSameVariant.js";
import {
    appendRouteStopOccurrence,
    extractOrderedRouteStopCoordinates,
    isGapFreeUniqueStopSequences,
    removeRouteStopOccurrence,
    repointRouteStopOccurrences,
    routeThroughOrderedCoordinates,
    type OrderedRouteStopCoordinate,
    type RouteStopOccurrenceRow,
} from "./transport-route-stop-occurrence.js";
import { buildRouteSearchCandidates } from "./transport-route-search.js";
import type {
    RouteSearchCandidateVariantRow,
    RouteSearchVariantStopRow,
} from "./transport-public.repo.js";
import {
    findStopOccurrencesOnVariant,
    selectBestForwardOccurrencePair,
    sliceStopsBetweenOccurrencePair,
    type VariantStopOccurrence,
} from "./transport-variant-route-segment.js";

const YANGON_CENTRAL_STOP_ID = 1;
const YANGON_CENTRAL_COORD: [number, number] = [96.1561, 16.7808];

function occ(
    routeStopId: number,
    stopId: number,
    stopSequence: number,
    lng = 96.15 + stopSequence * 0.001,
    lat = 16.78 + stopSequence * 0.0001,
): RouteStopOccurrenceRow & OrderedRouteStopCoordinate {
    return {
        route_stop_id: routeStopId,
        stop_id: stopId,
        stop_sequence: stopSequence,
        lng,
        lat,
    };
}

/** Circular train: Yangon Central at seq 1 and 39; 39 total occurrences. */
function circularTrainOccurrences(): Array<RouteStopOccurrenceRow & OrderedRouteStopCoordinate> {
    const rows: Array<RouteStopOccurrenceRow & OrderedRouteStopCoordinate> = [];
    for (let sequence = 1; sequence <= 39; sequence++) {
        const stopId = sequence === 1 || sequence === 39 ? YANGON_CENTRAL_STOP_ID : sequence + 10;
        const coord = sequence === 1 || sequence === 39 ? YANGON_CENTRAL_COORD : undefined;
        rows.push(
            occ(
                100 + sequence - 1,
                stopId,
                sequence,
                coord?.[0],
                coord?.[1],
            ),
        );
    }
    return rows;
}

/** Normal YBS bus: unique stop_id per sequence. */
const linearBusOccurrences: VariantStopOccurrence[] = [
    occ(1, 100, 1),
    occ(2, 101, 2),
    occ(3, 102, 3),
    occ(4, 103, 4),
    occ(5, 104, 5),
];

/** Linear train: unique station per sequence (no closing revisit). */
const linearTrainOccurrences: VariantStopOccurrence[] = [
    occ(1, 201, 1),
    occ(2, 202, 2),
    occ(3, 203, 3),
    occ(4, 204, 4),
    occ(5, 205, 5),
];

function searchVariantRow(): RouteSearchCandidateVariantRow {
    return {
        variant_id: 20n,
        variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        variant_code: "TRAIN-141-UP",
        direction_name: "Up",
        route_id: 10n,
        route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        route_code: "TRAIN-141",
        public_name: "Yangon Circular",
        origin_name: "Yangon Central",
        destination_name: "Yangon Central",
    };
}

function searchStopRow(stopSequence: number, stopId: bigint): RouteSearchVariantStopRow {
    return {
        route_variant_id: 20n,
        route_stop_id: BigInt(100 + stopSequence - 1),
        stop_id: stopId,
        stop_public_id: `00000000-0000-4000-8000-${String(stopSequence).padStart(12, "0")}`,
        stop_sequence: stopSequence,
        name_mm: `MM ${stopSequence}`,
        name_en: `EN ${stopSequence}`,
    };
}

describe("repeated physical stops — occurrence model", () => {
    describe("1. circular train: Yangon Central at seq 1 and seq 39 is accepted", () => {
        it("allows repeated stop_id when sequences stay gap-free and unique", () => {
            const rows = circularTrainOccurrences();
            assert.equal(isGapFreeUniqueStopSequences(rows), true);
            assert.deepEqual(
                findStopOccurrencesOnVariant(rows, YANGON_CENTRAL_STOP_ID).map((row) => row.stop_sequence),
                [1, 39],
            );
        });
    });

    describe("2. duplicate stop_sequence on one variant is rejected", () => {
        it("fails gap-free unique sequence validation", () => {
            const rows = [
                occ(1, YANGON_CENTRAL_STOP_ID, 1),
                occ(2, 12, 5),
                occ(3, YANGON_CENTRAL_STOP_ID, 5),
            ];
            assert.equal(isGapFreeUniqueStopSequences(rows), false);
        });
    });

    describe("3. remove occurrence: delete route_stop seq 39, seq 1 remains", () => {
        it("removes only the closing occurrence and keeps the opening row", () => {
            const before = circularTrainOccurrences();
            const after = removeRouteStopOccurrence(before, 138);

            assert.equal(after.length, 38);
            assert.equal(isGapFreeUniqueStopSequences(after), true);
            assert.ok(after.some((row) => row.stop_sequence === 1 && row.stop_id === YANGON_CENTRAL_STOP_ID));
            assert.equal(
                after.filter((row) => row.stop_id === YANGON_CENTRAL_STOP_ID).length,
                1,
            );
            assert.equal(after.some((row) => compareRouteStopId(row.route_stop_id, 138)), false);
        });
    });

    describe("4. reinsert closing occurrence: same stop_id allowed", () => {
        it("appends another Yangon Central occurrence at the end", () => {
            const withoutClosing = removeRouteStopOccurrence(circularTrainOccurrences(), 138);
            const after = appendRouteStopOccurrence(withoutClosing, {
                route_stop_id: 200,
                stop_id: YANGON_CENTRAL_STOP_ID,
                stop_sequence: 0,
                lng: YANGON_CENTRAL_COORD[0],
                lat: YANGON_CENTRAL_COORD[1],
            });

            assert.equal(after.length, 39);
            assert.equal(isGapFreeUniqueStopSequences(after), true);
            assert.deepEqual(
                findStopOccurrencesOnVariant(after, YANGON_CENTRAL_STOP_ID).map((row) => row.stop_sequence),
                [1, 39],
            );
        });
    });

    describe("5. routing: origin seq 37 → Yangon Central chooses seq 39", () => {
        it("picks the forward closing occurrence, not seq 1", () => {
            const rows = circularTrainOccurrences();
            const pair = selectBestForwardOccurrencePair(rows, 47, YANGON_CENTRAL_STOP_ID);
            assert.ok(pair);
            assert.equal(pair.origin.stop_sequence, 37);
            assert.equal(pair.destination.stop_sequence, 39);
            assert.notEqual(pair.destination.stop_sequence, 1);
        });

        it("builds route search segment 37 → 38 → 39", () => {
            const variants = [searchVariantRow()];
            const stops = circularTrainOccurrences().map((row) =>
                searchStopRow(row.stop_sequence, BigInt(row.stop_id as number)),
            );

            const candidates = buildRouteSearchCandidates(variants, stops, 47n, BigInt(YANGON_CENTRAL_STOP_ID));
            assert.equal(candidates.length, 1);
            assert.deepEqual(
                candidates[0]?.stops.map((stop) => stop.stop_sequence),
                [37, 38, 39],
            );
            assert.equal(candidates[0]?.destination_stop_sequence, 39);
        });
    });

    describe("6. path generation: ordered occurrences include final closure", () => {
        it("keeps every coordinate including the closing revisit", async () => {
            const rows = circularTrainOccurrences();
            const coordinates = extractOrderedRouteStopCoordinates(rows);
            assert.equal(coordinates.length, 39);
            assert.deepEqual(coordinates[0], YANGON_CENTRAL_COORD);
            assert.deepEqual(coordinates[38], YANGON_CENTRAL_COORD);

            const calls: number[] = [];
            await routeThroughOrderedCoordinates(coordinates, "car", async (request): Promise<NormalizedRouteResponse> => {
                calls.push(request.origin.lat);
                return {
                    status: "ok",
                    routingEngine: "valhalla",
                    profile: "car",
                    summary: { distanceMeters: 100, durationSeconds: 10, transferCount: 0 },
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [request.origin.lng, request.origin.lat],
                            [request.destination.lng, request.destination.lat],
                        ],
                    },
                    legs: [],
                    warnings: [],
                };
            });

            assert.equal(calls.length, 38, "routes each consecutive pair including closure");
        });
    });

    describe("7. merge: repoint duplicate stop B to canonical A preserves both sequences", () => {
        it("results in two occurrences of A without deleting a row", () => {
            const stopA = 10;
            const stopB = 20;
            const before: RouteStopOccurrenceRow[] = [
                occ(1, stopA, 1),
                occ(2, 12, 2),
                occ(3, stopB, 39, YANGON_CENTRAL_COORD[0], YANGON_CENTRAL_COORD[1]),
            ];

            assert.doesNotThrow(() => assertSameVariantMergeAcknowledged(1, true));

            const after = repointRouteStopOccurrences(before, stopB, stopA);
            assert.equal(after.length, before.length);
            assert.deepEqual(
                after.map((row) => row.stop_sequence),
                [1, 2, 39],
            );
            assert.deepEqual(
                findStopOccurrencesOnVariant(after, stopA).map((row) => row.stop_sequence),
                [1, 39],
            );
        });
    });

    describe("8. normal bus route: no behavior regression", () => {
        it("routes unique stops with standard forward pairing", () => {
            const pair = selectBestForwardOccurrencePair(linearBusOccurrences, 101, 104);
            assert.ok(pair);
            assert.equal(pair.origin.stop_sequence, 2);
            assert.equal(pair.destination.stop_sequence, 5);

            const segment = sliceStopsBetweenOccurrencePair(linearBusOccurrences, pair);
            assert.deepEqual(
                segment.map((row) => row.stop_sequence),
                [2, 3, 4, 5],
            );
        });

        it("rejects backward bus pairs", () => {
            assert.equal(selectBestForwardOccurrencePair(linearBusOccurrences, 104, 101), null);
        });
    });

    describe("9. linear train route: no behavior regression", () => {
        it("routes unique stations with standard forward pairing", () => {
            const pair = selectBestForwardOccurrencePair(linearTrainOccurrences, 202, 204);
            assert.ok(pair);
            assert.equal(pair.forward_sequence_span, 2);
            assert.deepEqual(
                sliceStopsBetweenOccurrencePair(linearTrainOccurrences, pair).map((row) => row.stop_sequence),
                [2, 3, 4],
            );
        });

        it("does not invent a closing occurrence when stop_id is unique", () => {
            assert.equal(findStopOccurrencesOnVariant(linearTrainOccurrences, 201).length, 1);
            assert.equal(findStopOccurrencesOnVariant(linearTrainOccurrences, 205).length, 1);
        });
    });
});

function compareRouteStopId(
    left: bigint | number | string,
    right: bigint | number | string,
): boolean {
    return String(left) === String(right);
}
