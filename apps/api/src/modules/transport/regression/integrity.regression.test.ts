import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMergeWorld, buildOrderedVariantStops, cloneWorld } from "./fixtures.js";
import { recordCase } from "./helpers.js";
import {
    assertWorldIntegrity,
    collectWorldIntegrityViolations,
} from "./integrity.js";

describe("transport review regression — integrity (Phase 9)", () => {
    it("detects duplicate stop_sequence per variant", () => {
        const world = buildMergeWorld();
        world.routeStops = [
            ...buildOrderedVariantStops(2),
            {
                id: 999n,
                route_variant_id: 2n,
                stop_id: 3n,
                stop_sequence: 1,
                travel_time_from_previous_seconds: null,
                waiting_time_seconds: null,
            },
        ];
        const violations = collectWorldIntegrityViolations(world);
        assert.ok(violations.some((v) => v.code === "DUPLICATE_SEQUENCE"));
        recordCase({
            feature: "integrity",
            caseName: "duplicate stop_sequence",
            endpoint: "n/a",
            expectedStatus: "violation",
            actualStatus: "violation",
            result: "PASS",
            errorCode: "DUPLICATE_SEQUENCE",
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("detects active terminal uniqueness violation", () => {
        const world = buildMergeWorld({ terminals: "canonical_only" });
        world.terminals.push({
            id: 99n,
            public_id: "99999999-9999-4999-8999-999999999999",
            linked_stop_id: 10n,
            name: "Second",
            review_status: "reviewed",
            is_active: true,
            deleted_at: null,
        });
        const violations = collectWorldIntegrityViolations(world);
        assert.ok(violations.some((v) => v.code === "TERMINAL_UNIQUE"));
        recordCase({
            feature: "integrity",
            caseName: "terminal unique violation",
            endpoint: "n/a",
            expectedStatus: "violation",
            actualStatus: "violation",
            result: "PASS",
            errorCode: "TERMINAL_UNIQUE",
            prismaCode: null,
            sqlState: null,
            constraint: "transport_terminals_linked_stop_unique",
            dataChanged: false,
        });
    });

    it("detects stop self-parent", () => {
        const world = buildMergeWorld();
        world.stops[0]!.parent_stop_id = world.stops[0]!.id;
        const violations = collectWorldIntegrityViolations(world);
        assert.ok(violations.some((v) => v.code === "SELF_PARENT"));
        recordCase({
            feature: "integrity",
            caseName: "self-parent",
            endpoint: "n/a",
            expectedStatus: "violation",
            actualStatus: "violation",
            result: "PASS",
            errorCode: "SELF_PARENT",
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("detects mode mismatch between route and stop", () => {
        const world = buildMergeWorld({ differentVariant: true });
        world.stops[0]!.mode = "train";
        const violations = collectWorldIntegrityViolations(world);
        assert.ok(violations.some((v) => v.code === "MODE_MISMATCH"));
        recordCase({
            feature: "integrity",
            caseName: "mode mismatch",
            endpoint: "n/a",
            expectedStatus: "violation",
            actualStatus: "violation",
            result: "PASS",
            errorCode: "MODE_MISMATCH",
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("failed transaction leaves world unchanged via clone restore", () => {
        const world = buildMergeWorld({ terminals: "duplicate_only" });
        const snapshot = cloneWorld(world);
        try {
            world.terminals[0]!.linked_stop_id = 10n;
            world.stops = world.stops.filter((s) => s.id !== 11n);
            throw new Error("force rollback");
        } catch {
            const restored = cloneWorld(snapshot);
            Object.assign(world, restored);
        }
        assert.equal(world.stops.length, snapshot.stops.length);
        assert.equal(world.terminals[0]!.linked_stop_id, 11n);
        assertWorldIntegrity(world);
        recordCase({
            feature: "integrity",
            caseName: "failed tx unchanged",
            endpoint: "n/a",
            expectedStatus: "rolled_back",
            actualStatus: "rolled_back",
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: "rolled_back",
        });
    });
});
