import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    canonicalYbsVariantCode,
    isCanonicalYbsRoute,
    isCanonicalYbsRouteUsage,
    oppositeYbsVariant,
    routeUsageDirectionLabel,
    variantDirectionLabel,
    variantHumanRoute,
    ybsVariantOptionLabel,
} from "./variantDirection.js";
import type { TransportVariantSummary } from "./types.js";

function variant(
    overrides: Partial<TransportVariantSummary> & Pick<TransportVariantSummary, "public_id">,
): TransportVariantSummary {
    return {
        variant_code: "YBS-39-D0",
        direction_name: "D0",
        direction_id: 0,
        headsign: null,
        origin_name: "Hledan",
        destination_name: "Sule",
        first_stop_name: "Hledan",
        stop_count: 12,
        path_count: 1,
        path_status: "has_path",
        distance_m: 8_000,
        estimated_duration_min: 45,
        review_status: "reviewed",
        confidence_score: 90,
        is_active: true,
        ...overrides,
    };
}

describe("YBS direction presentation", () => {
    it("requires both bus mode and the canonical YBS route prefix", () => {
        assert.equal(isCanonicalYbsRoute("bus", "YBS-39"), true);
        assert.equal(isCanonicalYbsRoute("train", "YBS-39"), false);
        assert.equal(isCanonicalYbsRoute("bus", "TRIAL-39"), false);
        assert.equal(isCanonicalYbsRouteUsage("", "YBS-39"), true);
        assert.equal(isCanonicalYbsRouteUsage("", "TRIAL-39"), false);
    });

    it("uses direction_id for D0/D1 and does not trust a stale direction name", () => {
        assert.equal(
            variantDirectionLabel(
                variant({ public_id: "d0", direction_id: 0, direction_name: "inbound" }),
                true,
            ),
            "D0",
        );
        assert.equal(
            variantDirectionLabel(
                variant({ public_id: "d1", direction_id: 1, direction_name: "outbound" }),
                true,
            ),
            "D1",
        );
    });

    it("uses stop-usage direction_id instead of legacy YBS wording", () => {
        assert.equal(
            routeUsageDirectionLabel({
                mode: "bus",
                routeCode: "YBS-39",
                directionName: "inbound",
                directionId: 0,
            }),
            "D0",
        );
        assert.equal(
            routeUsageDirectionLabel({
                mode: "bus",
                routeCode: "YBS-39",
                directionName: "outbound",
                directionId: 1,
            }),
            "D1",
        );
    });

    it("puts the human route between the machine label and code", () => {
        const d0 = variant({ public_id: "d0" });
        assert.equal(variantHumanRoute(d0), "Hledan → Sule");
        assert.equal(canonicalYbsVariantCode("YBS-39-A", 0), "YBS-39-A-D0");
        assert.equal(ybsVariantOptionLabel("YBS-39", d0), "D0 · Hledan → Sule · YBS-39-D0");
    });

    it("switches the selected variant bundle by public id and direction_id", () => {
        const d0 = variant({
            public_id: "variant-d0",
            variant_code: "misleading-D1-code",
            direction_name: "stale outbound text",
        });
        const d1 = variant({
            public_id: "variant-d1",
            variant_code: "misleading-D0-code",
            direction_name: "stale inbound text",
            direction_id: 1,
            origin_name: "Sule",
            destination_name: "Hledan",
        });
        assert.equal(oppositeYbsVariant([d0, d1], d0.public_id)?.public_id, d1.public_id);
        assert.equal(oppositeYbsVariant([d0, d1], d1.public_id)?.public_id, d0.public_id);
    });
});
