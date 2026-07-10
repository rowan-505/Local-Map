import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRouteSearchCandidates } from "./transport-route-search.js";
import type {
    RouteSearchCandidateVariantRow,
    RouteSearchVariantStopRow,
} from "./transport-public.repo.js";

function variantRow(overrides: Partial<RouteSearchCandidateVariantRow> = {}): RouteSearchCandidateVariantRow {
    return {
        variant_id: 20n,
        variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        variant_code: "TRAIN-1-A",
        direction_name: "Clockwise",
        route_id: 10n,
        route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        route_code: "TRAIN-1",
        public_name: "Circular",
        origin_name: "Yangon Central",
        destination_name: "Yangon Central",
        ...overrides,
    };
}

function stopRow(
    stopSequence: number,
    stopId: bigint,
    overrides: Partial<RouteSearchVariantStopRow> = {},
): RouteSearchVariantStopRow {
    return {
        route_variant_id: 20n,
        route_stop_id: BigInt(stopSequence),
        stop_id: stopId,
        stop_public_id: `00000000-0000-4000-8000-${String(stopSequence).padStart(12, "0")}`,
        stop_sequence: stopSequence,
        name_mm: `MM ${stopSequence}`,
        name_en: `EN ${stopSequence}`,
        ...overrides,
    };
}

describe("buildRouteSearchCandidates", () => {
    it("returns seq 37 → 38 → 39 for circular closing leg to repeated Yangon Central", () => {
        const variants = [variantRow()];
        const stops = [
            stopRow(1, 1n),
            ...Array.from({ length: 35 }, (_, index) => stopRow(index + 2, BigInt(index + 12))),
            stopRow(37, 47n),
            stopRow(38, 48n),
            stopRow(39, 1n),
        ];

        const candidates = buildRouteSearchCandidates(variants, stops, 47n, 1n);
        assert.equal(candidates.length, 1);
        assert.deepEqual(
            candidates[0]?.stops.map((stop) => stop.stop_sequence),
            [37, 38, 39],
        );
        assert.equal(candidates[0]?.origin_stop_sequence, 37);
        assert.equal(candidates[0]?.destination_stop_sequence, 39);
        assert.equal(candidates[0]?.forward_stop_count, 2);
    });

    it("skips variants with no valid forward pair", () => {
        const variants = [variantRow({ variant_id: 21n, variant_public_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })];
        const stops = [
            stopRow(1, 1n, { route_variant_id: 21n }),
            stopRow(2, 2n, { route_variant_id: 21n }),
        ];

        const candidates = buildRouteSearchCandidates(variants, stops, 2n, 1n);
        assert.deepEqual(candidates, []);
    });
});
