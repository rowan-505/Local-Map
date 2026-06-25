import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    archiveStopBodySchema,
    insertExistingRouteStopBodySchema,
    createAndInsertRouteStopBodySchema,
    searchTransportStopsQuerySchema,
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
            name_en: "Route A",
            source_refs: { foo: "bar" },
        });
        assert.equal(withSourceRefs.success, false);

        const withNormalized = updateRouteBodySchema.safeParse({
            name_en: "Route A",
            normalized_data: { foo: "bar" },
        });
        assert.equal(withNormalized.success, false);
    });

    it("rejects public_name (display name is derived, not editable)", () => {
        assert.equal(updateRouteBodySchema.safeParse({ public_name: "Route A" }).success, false);
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

    it("accepts name_mm / name_en and trims them", () => {
        const parsed = updateRouteBodySchema.parse({
            name_mm: "  အမှတ် ၉၅  ",
            name_en: "  Route 95  ",
        });
        assert.equal(parsed.name_mm, "အမှတ် ၉၅");
        assert.equal(parsed.name_en, "Route 95");
    });

    it("normalizes an empty name_mm / name_en to null", () => {
        const parsed = updateRouteBodySchema.parse({ name_mm: "", name_en: "Route 95" });
        assert.equal(parsed.name_mm, null);
        assert.equal(parsed.name_en, "Route 95");
    });

    it("rejects clearing both name_mm and name_en in one request", () => {
        assert.equal(
            updateRouteBodySchema.safeParse({ name_mm: "", name_en: "" }).success,
            false
        );
        assert.equal(
            updateRouteBodySchema.safeParse({ name_mm: null, name_en: null }).success,
            false
        );
    });

    it("allows clearing only one localized name (merge rule enforced in repo)", () => {
        assert.equal(updateRouteBodySchema.safeParse({ name_mm: "" }).success, true);
        assert.equal(updateRouteBodySchema.safeParse({ name_en: null }).success, true);
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
        assert.equal(
            updateStopBodySchema.safeParse({ name_en: "X", source_refs: {} }).success,
            false
        );
        assert.equal(
            updateStopBodySchema.safeParse({ name_en: "X", normalized_data: {} }).success,
            false
        );
    });

    it("rejects the raw `name` cache as a direct edit (strict)", () => {
        assert.equal(updateStopBodySchema.safeParse({ name: "Sule" }).success, false);
    });

    it("accepts name_mm / name_en and trims them", () => {
        const parsed = updateStopBodySchema.parse({
            name_mm: "  ဆူးလေ  ",
            name_en: "  Sule  ",
        });
        assert.equal(parsed.name_mm, "ဆူးလေ");
        assert.equal(parsed.name_en, "Sule");
    });

    it("normalizes empty nullable text to null", () => {
        const parsed = updateStopBodySchema.parse({ name_mm: "", name_en: "Sule" });
        assert.equal(parsed.name_mm, null);
        assert.equal(parsed.name_en, "Sule");
    });

    it("rejects clearing both name_mm and name_en in one request", () => {
        assert.equal(updateStopBodySchema.safeParse({ name_mm: "", name_en: "" }).success, false);
        assert.equal(
            updateStopBodySchema.safeParse({ name_mm: null, name_en: null }).success,
            false
        );
    });

    it("allows clearing a single localized name (merge-aware rule lives in repo)", () => {
        assert.equal(updateStopBodySchema.safeParse({ name_mm: "" }).success, true);
        assert.equal(updateStopBodySchema.safeParse({ name_en: null }).success, true);
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
            name_en: "  Sule  ",
            mode: "bus",
            stop_type: "stop",
            review_status: "verified",
            confidence_score: 88,
            is_active: true,
            point: { longitude: 96.16, latitude: 16.77 },
        });
        assert.equal(parsed.name_en, "Sule");
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

    it("rejects a line_type outside the allowlist", () => {
        assert.equal(
            updateInfrastructureLineBodySchema.safeParse({ line_type: "monorail" }).success,
            false
        );
    });

    it("accepts every allowed line_type", () => {
        for (const value of [
            "ferry",
            "rail",
            "abandoned",
            "disused",
            "construction",
            "narrow_gauge",
            "tram",
        ]) {
            assert.equal(
                updateInfrastructureLineBodySchema.parse({ line_type: value }).line_type,
                value
            );
        }
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

describe("insertExistingRouteStopBodySchema", () => {
    const STOP_UUID = "11111111-1111-4111-8111-111111111111";

    it("requires a stop reference (stopPublicId or stopId)", () => {
        assert.equal(
            insertExistingRouteStopBodySchema.safeParse({ position: "end" }).success,
            false
        );
    });

    it("rejects an invalid position", () => {
        assert.equal(
            insertExistingRouteStopBodySchema.safeParse({ stopId: 1, position: "middle" }).success,
            false
        );
    });

    it("rejects stop_sequence and source_refs (strict)", () => {
        assert.equal(
            insertExistingRouteStopBodySchema.safeParse({
                stopId: 1,
                position: "end",
                stop_sequence: 3,
            }).success,
            false
        );
        assert.equal(
            insertExistingRouteStopBodySchema.safeParse({
                stopId: 1,
                position: "end",
                source_refs: {},
            }).success,
            false
        );
    });

    it("requires anchorRouteStopId for before/after", () => {
        assert.equal(
            insertExistingRouteStopBodySchema.safeParse({ stopId: 1, position: "before" }).success,
            false
        );
        assert.equal(
            insertExistingRouteStopBodySchema.safeParse({ stopId: 1, position: "after" }).success,
            false
        );
        assert.equal(
            insertExistingRouteStopBodySchema.safeParse({
                stopId: 1,
                position: "after",
                anchorRouteStopId: "42",
            }).success,
            true
        );
    });

    it("does not require anchorRouteStopId for start/end", () => {
        assert.equal(
            insertExistingRouteStopBodySchema.safeParse({ stopId: 1, position: "start" }).success,
            true
        );
        assert.equal(
            insertExistingRouteStopBodySchema.safeParse({
                stopPublicId: STOP_UUID,
                position: "end",
            }).success,
            true
        );
    });

    it("rejects a non-numeric anchorRouteStopId", () => {
        assert.equal(
            insertExistingRouteStopBodySchema.safeParse({
                stopId: 1,
                position: "before",
                anchorRouteStopId: "abc",
            }).success,
            false
        );
    });

    it("rejects pickup_type / drop_off_type out of GTFS 0–3 range", () => {
        assert.equal(
            insertExistingRouteStopBodySchema.safeParse({
                stopId: 1,
                position: "end",
                pickup_type: 4,
            }).success,
            false
        );
        assert.equal(
            insertExistingRouteStopBodySchema.safeParse({
                stopId: 1,
                position: "end",
                drop_off_type: -1,
            }).success,
            false
        );
    });

    it("defaults the membership flags to GTFS column defaults", () => {
        const parsed = insertExistingRouteStopBodySchema.parse({
            stopPublicId: STOP_UUID,
            position: "start",
        });
        assert.equal(parsed.pickup_type, 0);
        assert.equal(parsed.drop_off_type, 0);
        assert.equal(parsed.is_timing_point, false);
    });

    it("accepts a full valid before-insert body", () => {
        const parsed = insertExistingRouteStopBodySchema.parse({
            stopId: 7,
            position: "before",
            anchorRouteStopId: "100",
            pickup_type: 2,
            drop_off_type: 3,
            is_timing_point: true,
        });
        assert.equal(parsed.stopId, 7);
        assert.equal(parsed.position, "before");
        assert.equal(parsed.anchorRouteStopId, "100");
        assert.equal(parsed.is_timing_point, true);
    });
});

describe("createAndInsertRouteStopBodySchema", () => {
    const base = {
        mode: "bus",
        stop_type: "stop",
        longitude: 96.1,
        latitude: 16.8,
        position: "end" as const,
    };

    it("requires at least one of name_mm / name_en", () => {
        assert.equal(createAndInsertRouteStopBodySchema.safeParse(base).success, false);
        assert.equal(
            createAndInsertRouteStopBodySchema.safeParse({ ...base, name_mm: " မြန်မာ" }).success,
            true
        );
        assert.equal(
            createAndInsertRouteStopBodySchema.safeParse({ ...base, name_en: "English" }).success,
            true
        );
    });

    it("requires mode / stop_type / coordinates", () => {
        const { mode: _mode, ...noMode } = base;
        assert.equal(
            createAndInsertRouteStopBodySchema.safeParse({ ...noMode, name_en: "x" }).success,
            false
        );
        assert.equal(
            createAndInsertRouteStopBodySchema.safeParse({
                ...base,
                name_en: "x",
                longitude: 200,
            }).success,
            false
        );
    });

    it("rejects an invalid mode", () => {
        assert.equal(
            createAndInsertRouteStopBodySchema.safeParse({
                ...base,
                name_en: "x",
                mode: "spaceship",
            }).success,
            false
        );
    });

    it("requires anchorRouteStopId for before/after", () => {
        assert.equal(
            createAndInsertRouteStopBodySchema.safeParse({
                ...base,
                name_en: "x",
                position: "before",
            }).success,
            false
        );
        assert.equal(
            createAndInsertRouteStopBodySchema.safeParse({
                ...base,
                name_en: "x",
                position: "before",
                anchorRouteStopId: "12",
            }).success,
            true
        );
    });

    it("rejects unknown fields (strict) and trims names", () => {
        assert.equal(
            createAndInsertRouteStopBodySchema.safeParse({
                ...base,
                name_en: "x",
                stop_code: "ABC",
            }).success,
            false
        );
        const parsed = createAndInsertRouteStopBodySchema.parse({
            ...base,
            name_en: "  Downtown  ",
        });
        assert.equal(parsed.name_en, "Downtown");
        assert.equal(parsed.pickup_type, 0);
        assert.equal(parsed.is_timing_point, false);
    });
});

describe("searchTransportStopsQuerySchema", () => {
    it("accepts an empty query and applies defaults", () => {
        const parsed = searchTransportStopsQuerySchema.parse({});
        assert.equal(parsed.limit, 20);
        assert.equal(parsed.radiusMeters, 1000);
        assert.equal(parsed.search, undefined);
    });

    it("coerces numeric query strings", () => {
        const parsed = searchTransportStopsQuerySchema.parse({
            nearLng: "96.16",
            nearLat: "16.77",
            radiusMeters: "500",
            limit: "10",
        });
        assert.equal(parsed.nearLng, 96.16);
        assert.equal(parsed.nearLat, 16.77);
        assert.equal(parsed.radiusMeters, 500);
        assert.equal(parsed.limit, 10);
    });

    it("requires nearLng and nearLat together", () => {
        assert.equal(searchTransportStopsQuerySchema.safeParse({ nearLng: 96.16 }).success, false);
        assert.equal(searchTransportStopsQuerySchema.safeParse({ nearLat: 16.77 }).success, false);
        assert.equal(
            searchTransportStopsQuerySchema.safeParse({ nearLng: 96.16, nearLat: 16.77 }).success,
            true
        );
    });

    it("caps the limit at 50 and rejects out-of-range coordinates/radius", () => {
        assert.equal(searchTransportStopsQuerySchema.safeParse({ limit: 51 }).success, false);
        assert.equal(searchTransportStopsQuerySchema.safeParse({ radiusMeters: 50001 }).success, false);
        assert.equal(
            searchTransportStopsQuerySchema.safeParse({ nearLng: 200, nearLat: 0 }).success,
            false
        );
    });

    it("rejects an invalid mode and a non-uuid excludeRouteVariantPublicId", () => {
        assert.equal(searchTransportStopsQuerySchema.safeParse({ mode: "rocket" }).success, false);
        assert.equal(
            searchTransportStopsQuerySchema.safeParse({ excludeRouteVariantPublicId: "nope" })
                .success,
            false
        );
    });
});

describe("archiveStopBodySchema", () => {
    it("accepts an empty body (no reason)", () => {
        const parsed = archiveStopBodySchema.parse({});
        assert.equal(parsed.reason, undefined);
    });

    it("trims a provided reason", () => {
        const parsed = archiveStopBodySchema.parse({ reason: "  duplicate stop  " });
        assert.equal(parsed.reason, "duplicate stop");
    });

    it("rejects a reason longer than 500 characters", () => {
        assert.equal(
            archiveStopBodySchema.safeParse({ reason: "x".repeat(501) }).success,
            false
        );
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
