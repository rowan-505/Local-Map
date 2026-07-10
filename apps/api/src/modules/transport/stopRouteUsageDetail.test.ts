import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    assembleStopRouteUsageDetail,
    buildStopRouteUsageSummary,
    isAnticlockwiseRouteUsage,
    isClockwiseRouteUsage,
    isInboundRouteUsage,
    isOutboundRouteUsage,
} from "./stopRouteUsageDetail.js";

describe("stopRouteUsageDetail direction helpers", () => {
    it("detects inbound and outbound from direction_id", () => {
        assert.equal(
            isInboundRouteUsage({ variantCode: "X-A", directionName: null, directionId: 1 }),
            true,
        );
        assert.equal(
            isOutboundRouteUsage({ variantCode: "X-B", directionName: null, directionId: 0 }),
            true,
        );
    });

    it("detects clockwise and anticlockwise from variant_code", () => {
        assert.equal(
            isClockwiseRouteUsage({
                variantCode: "TRAIN-GA-3-CLOCKWISE",
                directionName: "Clockwise",
                directionId: null,
            }),
            true,
        );
        assert.equal(
            isAnticlockwiseRouteUsage({
                variantCode: "TRAIN-KA-6-ANTICLOCKWISE",
                directionName: "Anticlockwise",
                directionId: null,
            }),
            true,
        );
        assert.equal(
            isClockwiseRouteUsage({
                variantCode: "TRAIN-KA-6-ANTICLOCKWISE",
                directionName: "Anticlockwise",
                directionId: null,
            }),
            false,
        );
    });

    it("builds distinct route and variant totals with direction counts", () => {
        const usages = [
            {
                variantCode: "BUS-1-A",
                directionName: "outbound",
                directionId: 0,
            },
            {
                variantCode: "BUS-1-B",
                directionName: "inbound",
                directionId: 1,
            },
            {
                variantCode: "TRAIN-GA-3-CLOCKWISE",
                directionName: "Clockwise",
                directionId: null,
            },
        ];

        const summary = buildStopRouteUsageSummary(
            usages,
            ["route-a", "route-b"],
            ["variant-a", "variant-b", "variant-c"],
        );

        assert.deepEqual(summary, {
            totalRoutes: 2,
            totalVariants: 3,
            routeStopMemberships: 3,
            inboundCount: 1,
            outboundCount: 1,
            clockwiseCount: 1,
            anticlockwiseCount: 0,
        });
    });

    it("assembles canonical route-usage detail payload", () => {
        const items = [
            {
                routeStopId: "rs-1",
                routeId: "route-a",
                routeCode: "BUS-1",
                routeName: "Bus One",
                variantId: "variant-a",
                variantCode: "BUS-1-A",
                directionName: "outbound",
                directionId: 0,
                stopSequence: 1,
            },
        ];
        const summary = buildStopRouteUsageSummary(
            [{ variantCode: "BUS-1-A", directionName: "outbound", directionId: 0 }],
            ["route-a"],
            ["variant-a"],
        );

        const assembled = assembleStopRouteUsageDetail("00000000-0000-4000-8000-000000000001", items, summary);

        assert.equal(assembled.stopId, assembled.stopPublicId);
        assert.equal(assembled.totalRoutes, summary.totalRoutes);
        assert.deepEqual(assembled.routes, assembled.items);
        assert.deepEqual(assembled.directionUsage, {
            inbound: summary.inboundCount,
            outbound: summary.outboundCount,
            clockwise: summary.clockwiseCount,
            anticlockwise: summary.anticlockwiseCount,
        });
    });
});
