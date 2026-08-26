import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    canSwapRouteDirection,
    getRouteDirectionSwapPair,
    resolveVariantIdAfterDirectionSwap,
} from "./routeDirectionSwap.js";
import type { TransportVariantSummary } from "./types.js";

function variant(
    overrides: Partial<TransportVariantSummary> & Pick<TransportVariantSummary, "public_id">,
): TransportVariantSummary {
    return {
        variant_code: "YBS-95-D0",
        direction_name: "D0",
        direction_id: 0,
        headsign: null,
        origin_name: null,
        destination_name: null,
        first_stop_name: null,
        stop_count: 0,
        path_count: 0,
        path_status: "none",
        distance_m: null,
        estimated_duration_min: null,
        review_status: "needs_review",
        confidence_score: 60,
        is_active: true,
        ...overrides,
    };
}

describe("getRouteDirectionSwapPair", () => {
    it("returns the direction_id 0/1 pair for two active variants", () => {
        const pair = getRouteDirectionSwapPair([
            variant({ public_id: "a", variant_code: "YBS-95-D0", direction_id: 0 }),
            variant({
                public_id: "b",
                variant_code: "YBS-95-D1",
                direction_id: 1,
                direction_name: "D1",
            }),
        ]);
        assert.ok(pair);
        assert.equal(pair.direction0.public_id, "a");
        assert.equal(pair.direction1.public_id, "b");
        assert.equal(canSwapRouteDirection([pair.direction0, pair.direction1]), true);
    });

    it("returns null when variant count is not two", () => {
        assert.equal(
            getRouteDirectionSwapPair([
                variant({ public_id: "a", direction_id: 0 }),
            ]),
            null,
        );
    });

    it("returns null when directions are not direction_id 0 + 1", () => {
        assert.equal(
            getRouteDirectionSwapPair([
                variant({ public_id: "a", direction_id: 0 }),
                variant({ public_id: "b", direction_id: 2, direction_name: "loop" }),
            ]),
            null,
        );
    });

    it("returns null when more than two active variants exist", () => {
        assert.equal(
            getRouteDirectionSwapPair([
                variant({ public_id: "a", direction_id: 0 }),
                variant({ public_id: "b", direction_id: 1, direction_name: "D1" }),
                variant({ public_id: "c", direction_id: 0, variant_code: "YBS-95-D0-copy" }),
            ]),
            null,
        );
    });
});

describe("resolveVariantIdAfterDirectionSwap", () => {
    it("selects Y to preserve direction 0 when selected X becomes direction 1", () => {
        const before = [
            variant({ public_id: "X", direction_id: 0, direction_name: "D0" }),
            variant({ public_id: "Y", direction_id: 1, direction_name: "D1" }),
        ];
        const selectedDirectionId = before.find((item) => item.public_id === "X")?.direction_id;
        const after = [
            variant({ public_id: "X", direction_id: 1, direction_name: "D1" }),
            variant({ public_id: "Y", direction_id: 0, direction_name: "D0" }),
        ];

        assert.equal(resolveVariantIdAfterDirectionSwap(after, selectedDirectionId), "Y");
    });

    it("selects X to preserve direction 1 when selected Y becomes direction 0", () => {
        const before = [
            variant({ public_id: "X", direction_id: 0, direction_name: "D0" }),
            variant({ public_id: "Y", direction_id: 1, direction_name: "D1" }),
        ];
        const selectedDirectionId = before.find((item) => item.public_id === "Y")?.direction_id;
        const after = [
            variant({ public_id: "X", direction_id: 1, direction_name: "D1" }),
            variant({ public_id: "Y", direction_id: 0, direction_name: "D0" }),
        ];

        assert.equal(resolveVariantIdAfterDirectionSwap(after, selectedDirectionId), "X");
    });

    it("returns the selected physical bundle to its original variant after two swaps", () => {
        const physicalBundles = new Map([
            ["X", { orderedStops: ["X-1", "X-2"], path: "X-path" }],
            ["Y", { orderedStops: ["Y-1", "Y-2"], path: "Y-path" }],
        ]);
        const original = [
            variant({ public_id: "X", direction_id: 0, direction_name: "D0" }),
            variant({ public_id: "Y", direction_id: 1, direction_name: "D1" }),
        ];
        const afterFirstSwap = [
            variant({ public_id: "X", direction_id: 1, direction_name: "D1" }),
            variant({ public_id: "Y", direction_id: 0, direction_name: "D0" }),
        ];

        const originalDirectionId = original.find(
            (item) => item.public_id === "X",
        )?.direction_id;
        const selectedAfterFirstSwap = resolveVariantIdAfterDirectionSwap(
            afterFirstSwap,
            originalDirectionId,
        );
        const directionBeforeSecondSwap = afterFirstSwap.find(
            (item) => item.public_id === selectedAfterFirstSwap,
        )?.direction_id;
        const selectedAfterSecondSwap = resolveVariantIdAfterDirectionSwap(
            original,
            directionBeforeSecondSwap,
        );

        assert.equal(selectedAfterFirstSwap, "Y");
        assert.deepEqual(physicalBundles.get(selectedAfterFirstSwap ?? ""), {
            orderedStops: ["Y-1", "Y-2"],
            path: "Y-path",
        });
        assert.equal(selectedAfterSecondSwap, "X");
        assert.deepEqual(physicalBundles.get(selectedAfterSecondSwap ?? ""), {
            orderedStops: ["X-1", "X-2"],
            path: "X-path",
        });
    });
});
