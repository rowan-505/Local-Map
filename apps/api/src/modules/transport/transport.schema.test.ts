import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    moveRouteStopBodySchema,
    routeStopIdParamSchema,
    updateInfrastructureLineBodySchema,
    updateRouteBodySchema,
    updateRouteStopBodySchema,
    updateStopBodySchema,
    updateTerminalBodySchema,
    updateVariantBodySchema,
} from "./transport.schema.js";

describe("updateRouteBodySchema", () => {
    it("rejects an empty body (at least one field required)", () => {
        const result = updateRouteBodySchema.safeParse({});
        assert.equal(result.success, false);
    });

    it("rejects source_refs and normalized_data (strict)", () => {
        const withSourceRefs = updateRouteBodySchema.safeParse({
            public_name: "Route A",
            source_refs: { foo: "bar" },
        });
        assert.equal(withSourceRefs.success, false);

        const withNormalized = updateRouteBodySchema.safeParse({
            public_name: "Route A",
            normalized_data: { foo: "bar" },
        });
        assert.equal(withNormalized.success, false);
    });

    it("rejects an invalid mode and review_status", () => {
        assert.equal(updateRouteBodySchema.safeParse({ mode: "rocket" }).success, false);
        assert.equal(
            updateRouteBodySchema.safeParse({ review_status: "approved" }).success,
            false
        );
    });

    it("rejects confidence_score out of 0–100 range", () => {
        assert.equal(updateRouteBodySchema.safeParse({ confidence_score: -1 }).success, false);
        assert.equal(updateRouteBodySchema.safeParse({ confidence_score: 101 }).success, false);
    });

    it("rejects an empty required text field", () => {
        assert.equal(updateRouteBodySchema.safeParse({ route_code: "   " }).success, false);
    });

    it("normalizes empty nullable text to null", () => {
        const parsed = updateRouteBodySchema.parse({ origin_name: "" });
        assert.equal(parsed.origin_name, null);
    });

    it("accepts an explicit null to clear a nullable field", () => {
        const parsed = updateRouteBodySchema.parse({ description: null });
        assert.equal(parsed.description, null);
    });

    it("accepts a valid partial update and trims text", () => {
        const parsed = updateRouteBodySchema.parse({
            route_code: "  95  ",
            mode: "bus",
            review_status: "reviewed",
            confidence_score: 80,
            is_active: true,
        });
        assert.equal(parsed.route_code, "95");
        assert.equal(parsed.mode, "bus");
        assert.equal(parsed.review_status, "reviewed");
        assert.equal(parsed.confidence_score, 80);
        assert.equal(parsed.is_active, true);
    });
});

describe("updateVariantBodySchema", () => {
    it("rejects an empty body", () => {
        assert.equal(updateVariantBodySchema.safeParse({}).success, false);
    });

    it("rejects source_refs / normalized_data (strict)", () => {
        assert.equal(
            updateVariantBodySchema.safeParse({ headsign: "X", source_refs: {} }).success,
            false
        );
        assert.equal(
            updateVariantBodySchema.safeParse({ headsign: "X", normalized_data: {} }).success,
            false
        );
    });

    it("rejects a non-integer / out-of-range direction_id", () => {
        assert.equal(updateVariantBodySchema.safeParse({ direction_id: 1.5 }).success, false);
        assert.equal(updateVariantBodySchema.safeParse({ direction_id: -1 }).success, false);
        assert.equal(updateVariantBodySchema.safeParse({ direction_id: 40000 }).success, false);
    });

    it("accepts null direction_id and estimated_duration_min", () => {
        const parsed = updateVariantBodySchema.parse({
            direction_id: null,
            estimated_duration_min: null,
        });
        assert.equal(parsed.direction_id, null);
        assert.equal(parsed.estimated_duration_min, null);
    });

    it("accepts a valid partial update", () => {
        const parsed = updateVariantBodySchema.parse({
            variant_code: "95-A",
            direction_id: 0,
            estimated_duration_min: 45,
            review_status: "verified",
            confidence_score: 90,
            is_active: false,
        });
        assert.equal(parsed.variant_code, "95-A");
        assert.equal(parsed.direction_id, 0);
        assert.equal(parsed.estimated_duration_min, 45);
        assert.equal(parsed.is_active, false);
    });
});

describe("updateRouteStopBodySchema", () => {
    it("rejects an empty body", () => {
        assert.equal(updateRouteStopBodySchema.safeParse({}).success, false);
    });

    it("rejects stop_sequence and source_refs (strict)", () => {
        assert.equal(
            updateRouteStopBodySchema.safeParse({ stop_sequence: 2 }).success,
            false
        );
        assert.equal(
            updateRouteStopBodySchema.safeParse({ pickup_type: 0, source_refs: {} }).success,
            false
        );
    });

    it("rejects pickup_type / drop_off_type out of GTFS 0–3 range", () => {
        assert.equal(updateRouteStopBodySchema.safeParse({ pickup_type: 4 }).success, false);
        assert.equal(updateRouteStopBodySchema.safeParse({ drop_off_type: -1 }).success, false);
    });

    it("accepts valid flags", () => {
        const parsed = updateRouteStopBodySchema.parse({
            pickup_type: 2,
            drop_off_type: 3,
            is_timing_point: true,
        });
        assert.equal(parsed.pickup_type, 2);
        assert.equal(parsed.drop_off_type, 3);
        assert.equal(parsed.is_timing_point, true);
    });
});

describe("updateStopBodySchema", () => {
    it("rejects an empty body", () => {
        assert.equal(updateStopBodySchema.safeParse({}).success, false);
    });

    it("rejects source_refs / normalized_data (strict)", () => {
        assert.equal(updateStopBodySchema.safeParse({ name: "X", source_refs: {} }).success, false);
        assert.equal(
            updateStopBodySchema.safeParse({ name: "X", normalized_data: {} }).success,
            false
        );
    });

    it("rejects an empty required name", () => {
        assert.equal(updateStopBodySchema.safeParse({ name: "   " }).success, false);
    });

    it("normalizes empty nullable text to null", () => {
        const parsed = updateStopBodySchema.parse({ name_mm: "" });
        assert.equal(parsed.name_mm, null);
    });

    it("accepts null to clear admin_area_id / parent_stop_id", () => {
        const parsed = updateStopBodySchema.parse({ admin_area_id: null, parent_stop_id: null });
        assert.equal(parsed.admin_area_id, null);
        assert.equal(parsed.parent_stop_id, null);
    });

    it("rejects out-of-range point coordinates", () => {
        assert.equal(
            updateStopBodySchema.safeParse({ point: { longitude: 200, latitude: 0 } }).success,
            false
        );
        assert.equal(
            updateStopBodySchema.safeParse({ point: { longitude: 0, latitude: 91 } }).success,
            false
        );
    });

    it("accepts a valid point + fields", () => {
        const parsed = updateStopBodySchema.parse({
            name: "  Sule  ",
            mode: "bus",
            stop_type: "stop",
            review_status: "verified",
            confidence_score: 88,
            is_active: true,
            point: { longitude: 96.16, latitude: 16.77 },
        });
        assert.equal(parsed.name, "Sule");
        assert.deepEqual(parsed.point, { longitude: 96.16, latitude: 16.77 });
    });
});

describe("updateTerminalBodySchema", () => {
    it("rejects an empty body", () => {
        assert.equal(updateTerminalBodySchema.safeParse({}).success, false);
    });

    it("rejects source_refs / normalized_data (strict)", () => {
        assert.equal(
            updateTerminalBodySchema.safeParse({ name: "X", source_refs: {} }).success,
            false
        );
        assert.equal(
            updateTerminalBodySchema.safeParse({ name: "X", normalized_data: {} }).success,
            false
        );
    });

    it("rejects an empty required name", () => {
        assert.equal(updateTerminalBodySchema.safeParse({ name: "  " }).success, false);
    });

    it("normalizes empty nullable text to null", () => {
        assert.equal(updateTerminalBodySchema.parse({ terminal_code: "" }).terminal_code, null);
    });

    it("accepts null to clear linked_stop_id / operator_id / admin_area_id", () => {
        const parsed = updateTerminalBodySchema.parse({
            linked_stop_id: null,
            operator_id: null,
            admin_area_id: null,
        });
        assert.equal(parsed.linked_stop_id, null);
        assert.equal(parsed.operator_id, null);
        assert.equal(parsed.admin_area_id, null);
    });

    it("rejects out-of-range point coordinates", () => {
        assert.equal(
            updateTerminalBodySchema.safeParse({ point: { longitude: -181, latitude: 0 } }).success,
            false
        );
    });

    it("accepts a valid point + fields", () => {
        const parsed = updateTerminalBodySchema.parse({
            name: "  Pansodan Jetty  ",
            mode: "ferry",
            terminal_role: "terminal",
            review_status: "verified",
            confidence_score: 90,
            is_active: true,
            point: { longitude: 96.16, latitude: 16.77 },
        });
        assert.equal(parsed.name, "Pansodan Jetty");
        assert.deepEqual(parsed.point, { longitude: 96.16, latitude: 16.77 });
    });
});

describe("updateInfrastructureLineBodySchema", () => {
    it("rejects an empty body", () => {
        assert.equal(updateInfrastructureLineBodySchema.safeParse({}).success, false);
    });

    it("rejects source_refs / normalized_data (strict)", () => {
        assert.equal(
            updateInfrastructureLineBodySchema.safeParse({ name: "X", source_refs: {} }).success,
            false
        );
        assert.equal(
            updateInfrastructureLineBodySchema.safeParse({ name: "X", normalized_data: {} }).success,
            false
        );
    });

    it("rejects geometry editing keys (strict)", () => {
        assert.equal(
            updateInfrastructureLineBodySchema.safeParse({ geometry: {} }).success,
            false
        );
        assert.equal(
            updateInfrastructureLineBodySchema.safeParse({ point: { longitude: 0, latitude: 0 } })
                .success,
            false
        );
    });

    it("normalizes empty nullable name to null", () => {
        assert.equal(updateInfrastructureLineBodySchema.parse({ name: "" }).name, null);
    });

    it("accepts null to clear admin_area_id", () => {
        assert.equal(
            updateInfrastructureLineBodySchema.parse({ admin_area_id: null }).admin_area_id,
            null
        );
    });

    it("rejects an empty line_type", () => {
        assert.equal(
            updateInfrastructureLineBodySchema.safeParse({ line_type: "  " }).success,
            false
        );
    });

    it("accepts a valid update", () => {
        const parsed = updateInfrastructureLineBodySchema.parse({
            name: "  Yangon Circular Line  ",
            mode: "train",
            line_type: "rail",
            review_status: "verified",
            confidence_score: 80,
            is_active: true,
        });
        assert.equal(parsed.name, "Yangon Circular Line");
        assert.equal(parsed.line_type, "rail");
    });
});

describe("moveRouteStopBodySchema", () => {
    it("rejects an invalid direction", () => {
        assert.equal(moveRouteStopBodySchema.safeParse({ direction: "left" }).success, false);
    });

    it("accepts up and down", () => {
        assert.equal(moveRouteStopBodySchema.parse({ direction: "up" }).direction, "up");
        assert.equal(moveRouteStopBodySchema.parse({ direction: "down" }).direction, "down");
    });
});

describe("routeStopIdParamSchema", () => {
    it("rejects non-numeric ids", () => {
        assert.equal(routeStopIdParamSchema.safeParse({ id: "abc" }).success, false);
        assert.equal(routeStopIdParamSchema.safeParse({ id: "1.5" }).success, false);
    });

    it("accepts a numeric id", () => {
        assert.equal(routeStopIdParamSchema.parse({ id: "42" }).id, "42");
    });
});
