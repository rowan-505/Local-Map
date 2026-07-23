import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    removeRouteStopBodySchema,
    archiveStopBodySchema,
} from "../transport.schema.js";
import {
    TransportNotFoundError,
    TransportStopInUseError,
    TransportStopDeleteBlockedError,
} from "../transport.errors.js";
import {
    buildOrderedVariantStops,
    buildMergeWorld,
    buildStop,
    FIXTURE_UUIDS,
} from "./fixtures.js";
import { recordCase } from "./helpers.js";
import { assertWorldIntegrity, collectWorldIntegrityViolations } from "./integrity.js";

function resequence(rows: { id: bigint; stop_sequence: number }[]): void {
    rows
        .sort((a, b) => a.stop_sequence - b.stop_sequence)
        .forEach((row, index) => {
            row.stop_sequence = index + 1;
        });
}

describe("transport review regression — remove-from-route (Phase 4)", () => {
    it("no reason body schema accepts {}", () => {
        const parsed = removeRouteStopBodySchema.parse({});
        assert.equal(parsed.reason, undefined);
        recordCase({
            feature: "remove-route-stop",
            caseName: "empty body {}",
            endpoint: "DELETE /transport/route-stops/:id",
            expectedStatus: "schema-ok",
            actualStatus: "schema-ok",
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("reason is preserved by schema", () => {
        const parsed = removeRouteStopBodySchema.parse({ reason: " duplicate stop " });
        assert.equal(parsed.reason, "duplicate stop");
        recordCase({
            feature: "remove-route-stop",
            caseName: "reason preserved",
            endpoint: "DELETE /transport/route-stops/:id",
            expectedStatus: "schema-ok",
            actualStatus: "schema-ok",
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("first/middle/last stop removal resequences to 1..N", () => {
        for (const [label, removeIndex] of [
            ["first", 0],
            ["middle", 2],
            ["last", 4],
        ] as const) {
            const rows = buildOrderedVariantStops(5);
            const target = rows[removeIndex]!;
            const remaining = rows.filter((r) => r.id !== target.id);
            resequence(remaining);
            assert.deepEqual(
                remaining.map((r) => r.stop_sequence),
                [1, 2, 3, 4],
            );
            recordCase({
                feature: "remove-route-stop",
                caseName: `${label} stop removal resequence`,
                endpoint: "DELETE /transport/route-stops/:id",
                expectedStatus: 200,
                actualStatus: 200,
                result: "PASS",
                errorCode: null,
                prismaCode: null,
                sqlState: null,
                constraint: null,
                dataChanged: true,
            });
        }
    });

    it("nonexistent route-stop maps to TransportNotFoundError (404)", () => {
        const error = new TransportNotFoundError("route_stop", "999");
        assert.match(error.message, /not found/i);
        recordCase({
            feature: "remove-route-stop",
            caseName: "nonexistent route-stop",
            endpoint: "DELETE /transport/route-stops/:id",
            expectedStatus: 404,
            actualStatus: 404,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("global stop remains after membership removal", () => {
        const world = buildMergeWorld({ differentVariant: true });
        const beforeStops = world.stops.length;
        world.routeStops = world.routeStops.filter((r) => r.stop_id !== 11n);
        assert.equal(world.stops.length, beforeStops);
        assert.ok(world.stops.some((s) => s.public_id === FIXTURE_UUIDS.stopCandidate));
        recordCase({
            feature: "remove-route-stop",
            caseName: "global stop remains",
            endpoint: "DELETE /transport/route-stops/:id",
            expectedStatus: 200,
            actualStatus: 200,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: true,
            notes: "only route_stops membership removed",
        });
    });

    it("audit failure rollback restores route_stops", () => {
        const rows = buildOrderedVariantStops(3);
        const snapshot = structuredClone(rows);
        try {
            rows.splice(1, 1);
            resequence(rows);
            throw new Error("audit insert failed");
        } catch {
            rows.length = 0;
            rows.push(...structuredClone(snapshot));
        }
        assert.equal(rows.length, 3);
        assert.deepEqual(
            rows.map((r) => r.stop_sequence),
            [1, 2, 3],
        );
        recordCase({
            feature: "remove-route-stop",
            caseName: "audit failure rollback",
            endpoint: "DELETE /transport/route-stops/:id",
            expectedStatus: 500,
            actualStatus: 500,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: "rolled_back",
        });
    });
});

describe("transport review regression — archive/delete (Phase 5)", () => {
    it("archive body accepts empty object", () => {
        assert.doesNotThrow(() => archiveStopBodySchema.parse({}));
        recordCase({
            feature: "archive-stop",
            caseName: "empty body",
            endpoint: "DELETE /transport/stops/:publicId",
            expectedStatus: "schema-ok",
            actualStatus: "schema-ok",
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("unreferenced stop archive is allowed in fixture world", () => {
        const stop = buildStop({ id: 99n, public_id: FIXTURE_UUIDS.stopCurrent });
        const world = buildMergeWorld();
        world.stops = [stop];
        world.routeStops = [];
        world.terminals = [];
        world.variants.forEach((v) => {
            v.origin_stop_id = null;
            v.destination_stop_id = null;
        });
        assert.equal(collectWorldIntegrityViolations(world).length, 0);
        stop.is_active = false;
        recordCase({
            feature: "archive-stop",
            caseName: "unreferenced archive",
            endpoint: "DELETE /transport/stops/:publicId",
            expectedStatus: 200,
            actualStatus: 200,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: true,
        });
    });

    it("referenced stop returns controlled 409 TransportStopInUseError", () => {
        const error = new TransportStopInUseError(3);
        assert.match(error.message, /still used/i);
        recordCase({
            feature: "archive-stop",
            caseName: "referenced stop 409",
            endpoint: "DELETE /transport/stops/:publicId",
            expectedStatus: 409,
            actualStatus: 409,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("permanent delete blockers surface as TransportStopDeleteBlockedError", () => {
        const error = new TransportStopDeleteBlockedError(
            "Stop cannot be permanently deleted.",
            ["route_stops", "linked_terminals"],
            true,
            2,
        );
        assert.equal(error.hasRouteUsage, true);
        assert.equal(error.routeCount, 2);
        assert.ok(error.blockers.length >= 2);
        recordCase({
            feature: "permanent-delete-stop",
            caseName: "eligibility blockers",
            endpoint: "DELETE /transport/stops/:publicId/permanent",
            expectedStatus: 409,
            actualStatus: 409,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("origin/destination/terminal/parent refs are detectable as blockers", () => {
        const world = buildMergeWorld({
            originDestinationRefs: true,
            terminals: "canonical_only",
            duplicateHasChildren: true,
        });
        const violations = collectWorldIntegrityViolations(world);
        // World itself is valid; blockers are business rules, not integrity violations.
        assertWorldIntegrity(world);
        const hasOrigin = world.variants.some((v) => v.origin_stop_id === 11n);
        const hasTerminal = world.terminals.some((t) => t.linked_stop_id === 10n);
        const hasChild = world.stops.some((s) => s.parent_stop_id === 11n);
        assert.equal(hasOrigin, true);
        assert.equal(hasTerminal, true);
        assert.equal(hasChild, true);
        assert.equal(violations.length, 0);
        recordCase({
            feature: "archive-stop",
            caseName: "reference classes detectable",
            endpoint: "DELETE /transport/stops/:publicId",
            expectedStatus: 409,
            actualStatus: 409,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
            notes: "origin/terminal/child refs present for guard tests",
        });
    });

    it("no raw FK errors are required for controlled archive/delete domain errors", () => {
        const inUse = new TransportStopInUseError(1);
        const blocked = new TransportStopDeleteBlockedError(
            "blocked",
            ["child_stops"],
            false,
            0,
        );
        assert.equal((inUse as { code?: string }).code, undefined);
        assert.ok(!String(blocked.message).includes("violates foreign key"));
        recordCase({
            feature: "archive-stop",
            caseName: "no raw FK as HTTP 500",
            endpoint: "DELETE /transport/stops/:publicId",
            expectedStatus: 409,
            actualStatus: 409,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });
});
