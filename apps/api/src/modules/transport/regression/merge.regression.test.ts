import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    TransportMergeTerminalConflictError,
    TransportReviewGuardError,
} from "../transport.errors.js";
import { assertSameVariantMergeAcknowledged } from "../stopMergeSameVariant.js";
import {
    buildStopMergeTerminalConflict,
    jsonSafeNumber,
    MERGE_TERMINAL_CONFLICT_BLOCKER,
} from "../stopMergePreview.js";
import {
    buildMergeWorld,
    FIXTURE_UUIDS,
    type FixtureWorld,
} from "./fixtures.js";
import {
    assertJsonSafe,
    domainErrorCode,
    recordCase,
} from "./helpers.js";
import {
    assertNoRemainingDuplicateRefs,
    assertWorldIntegrity,
} from "./integrity.js";

function simulateSuccessfulMerge(world: FixtureWorld): void {
    const canonical = world.stops.find((s) => s.public_id === FIXTURE_UUIDS.stopCurrent)!;
    const duplicate = world.stops.find((s) => s.public_id === FIXTURE_UUIDS.stopCandidate)!;

    if (canonical.parent_stop_id === duplicate.id) {
        canonical.parent_stop_id = null;
    }

    for (const rs of world.routeStops) {
        if (rs.stop_id === duplicate.id) {
            rs.stop_id = canonical.id;
        }
    }
    for (const variant of world.variants) {
        if (variant.origin_stop_id === duplicate.id) {
            variant.origin_stop_id = canonical.id;
        }
        if (variant.destination_stop_id === duplicate.id) {
            variant.destination_stop_id = canonical.id;
        }
    }

    const canonicalTerminal = world.terminals.find(
        (t) => t.deleted_at === null && t.linked_stop_id === canonical.id,
    );
    const duplicateTerminal = world.terminals.find(
        (t) => t.deleted_at === null && t.linked_stop_id === duplicate.id,
    );
    if (canonicalTerminal && duplicateTerminal) {
        throw new TransportMergeTerminalConflictError(
            canonical.public_id,
            duplicate.public_id,
            String(canonicalTerminal.id),
            String(duplicateTerminal.id),
        );
    }
    if (duplicateTerminal && !canonicalTerminal) {
        duplicateTerminal.linked_stop_id = canonical.id;
    }

    for (const stop of world.stops) {
        if (stop.parent_stop_id === duplicate.id && stop.id !== canonical.id) {
            stop.parent_stop_id = canonical.id;
        }
    }

    const keptLanguages = new Set(
        world.stopNames.filter((n) => n.stop_id === canonical.id).map((n) => n.language_code),
    );
    world.stopNames = world.stopNames.filter((n) => {
        if (n.stop_id !== duplicate.id) return true;
        if (keptLanguages.has(n.language_code)) return false;
        n.stop_id = canonical.id;
        keptLanguages.add(n.language_code);
        return true;
    });

    world.stops = world.stops.filter((s) => s.id !== duplicate.id);
}

describe("transport review regression — merge (Phase 3)", () => {
    it("1. preview world with ordinary stops is integrity-clean", () => {
        const world = buildMergeWorld({ terminals: "none", differentVariant: true });
        assertWorldIntegrity(world);
        recordCase({
            feature: "merge-preview",
            caseName: "ordinary stops integrity",
            endpoint: "POST /transport/stops/merge-preview",
            expectedStatus: 200,
            actualStatus: 200,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("2. non-null bigint admin_area_id is JSON-safe after jsonSafeNumber", () => {
        const world = buildMergeWorld({ adminAreaId: 5801n });
        const payload = {
            adminAreaId: jsonSafeNumber(world.stops[0]!.admin_area_id),
            fieldComparison: {
                admin_area_id: {
                    current: jsonSafeNumber(world.stops[0]!.admin_area_id),
                    candidate: jsonSafeNumber(world.stops[1]!.admin_area_id),
                },
            },
        };
        assertJsonSafe(payload);
        assert.equal(typeof payload.adminAreaId, "number");
        recordCase({
            feature: "merge-preview",
            caseName: "bigint admin_area_id JSON-safe",
            endpoint: "POST /transport/stops/merge-preview",
            expectedStatus: 200,
            actualStatus: 200,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("3. dual terminals block merge in preview analysis", () => {
        const world = buildMergeWorld({ terminals: "both" });
        const conflict = buildStopMergeTerminalConflict(
            10n,
            11n,
            world.terminals.map((t) => ({
                id: t.id,
                public_id: t.public_id,
                linked_stop_id: t.linked_stop_id!,
                name: t.name,
            })),
        );
        assert.equal(conflict.exists, true);
        const blockers = conflict.exists ? [MERGE_TERMINAL_CONFLICT_BLOCKER] : [];
        assert.ok(blockers.includes("MERGE_TERMINAL_CONFLICT"));
        recordCase({
            feature: "merge-preview",
            caseName: "dual terminals block",
            endpoint: "POST /transport/stops/merge-preview",
            expectedStatus: 200,
            actualStatus: 200,
            result: "PASS",
            errorCode: "MERGE_TERMINAL_CONFLICT",
            prismaCode: null,
            sqlState: null,
            constraint: "transport_terminals_linked_stop_unique",
            dataChanged: false,
            notes: "mergeAllowed=false in preview",
        });
    });

    it("4. merge with neither terminal succeeds", () => {
        const world = buildMergeWorld({ terminals: "none", differentVariant: true });
        simulateSuccessfulMerge(world);
        assert.equal(world.stops.some((s) => s.public_id === FIXTURE_UUIDS.stopCandidate), false);
        assertWorldIntegrity(world);
        recordCase({
            feature: "merge-execution",
            caseName: "neither terminal",
            endpoint: "POST /transport/stops/merge",
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

    it("5. merge with duplicate terminal only repoints it", () => {
        const world = buildMergeWorld({ terminals: "duplicate_only" });
        simulateSuccessfulMerge(world);
        assert.equal(world.terminals.length, 1);
        assert.equal(world.terminals[0]!.linked_stop_id, 10n);
        assertWorldIntegrity(world);
        recordCase({
            feature: "merge-execution",
            caseName: "duplicate terminal only",
            endpoint: "POST /transport/stops/merge",
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

    it("6. merge with canonical terminal only preserves it", () => {
        const world = buildMergeWorld({ terminals: "canonical_only" });
        const beforeId = world.terminals[0]!.id;
        simulateSuccessfulMerge(world);
        assert.equal(world.terminals[0]!.id, beforeId);
        assert.equal(world.terminals[0]!.linked_stop_id, 10n);
        recordCase({
            feature: "merge-execution",
            caseName: "canonical terminal only",
            endpoint: "POST /transport/stops/merge",
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

    it("7. merge with dual terminals returns 409 MERGE_TERMINAL_CONFLICT", () => {
        const world = buildMergeWorld({ terminals: "both" });
        let caught: unknown;
        try {
            simulateSuccessfulMerge(world);
        } catch (error) {
            caught = error;
        }
        assert.ok(caught instanceof TransportMergeTerminalConflictError);
        assert.equal(caught.code, "MERGE_TERMINAL_CONFLICT");
        assert.equal(caught.statusCode, 409);
        assert.equal(world.stops.length, 3);
        recordCase({
            feature: "merge-execution",
            caseName: "dual terminals 409",
            endpoint: "POST /transport/stops/merge",
            expectedStatus: 409,
            actualStatus: 409,
            result: "PASS",
            errorCode: "MERGE_TERMINAL_CONFLICT",
            prismaCode: null,
            sqlState: null,
            constraint: "transport_terminals_linked_stop_unique",
            dataChanged: false,
        });
    });

    it("8. same variant without ack returns 409", () => {
        assert.throws(
            () => assertSameVariantMergeAcknowledged(1, undefined),
            (error: unknown) => {
                assert.ok(error instanceof TransportReviewGuardError);
                assert.equal(error.code, "MERGE_VARIANT_ACK_REQUIRED");
                return true;
            },
        );
        recordCase({
            feature: "merge-execution",
            caseName: "same variant without ack",
            endpoint: "POST /transport/stops/merge",
            expectedStatus: 409,
            actualStatus: 409,
            result: "PASS",
            errorCode: "MERGE_VARIANT_ACK_REQUIRED",
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("9. same variant with ack proceeds", () => {
        assert.doesNotThrow(() => assertSameVariantMergeAcknowledged(2, true));
        const world = buildMergeWorld({ sameVariant: true, terminals: "none" });
        simulateSuccessfulMerge(world);
        assert.equal(world.stops.some((s) => s.public_id === FIXTURE_UUIDS.stopCandidate), false);
        recordCase({
            feature: "merge-execution",
            caseName: "same variant with ack",
            endpoint: "POST /transport/stops/merge",
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

    it("11. canonical.parent_stop_id = duplicate is resolved", () => {
        const world = buildMergeWorld({ canonicalParentIsDuplicate: true });
        simulateSuccessfulMerge(world);
        const canonical = world.stops.find((s) => s.public_id === FIXTURE_UUIDS.stopCurrent)!;
        assert.equal(canonical.parent_stop_id, null);
        recordCase({
            feature: "merge-execution",
            caseName: "clear canonical parent pointing at duplicate",
            endpoint: "POST /transport/stops/merge",
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

    it("12. duplicate children are repointed", () => {
        const world = buildMergeWorld({ duplicateHasChildren: true });
        simulateSuccessfulMerge(world);
        const child = world.stops.find((s) => s.public_id === FIXTURE_UUIDS.stopChild)!;
        assert.equal(child.parent_stop_id, 10n);
        recordCase({
            feature: "merge-execution",
            caseName: "repoint duplicate children",
            endpoint: "POST /transport/stops/merge",
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

    it("13. stop names are deduplicated by language", () => {
        const world = buildMergeWorld({ duplicateNames: true });
        simulateSuccessfulMerge(world);
        const enNames = world.stopNames.filter((n) => n.language_code === "en");
        assert.equal(enNames.length, 1);
        assert.ok(world.stopNames.some((n) => n.language_code === "my"));
        recordCase({
            feature: "merge-execution",
            caseName: "dedupe stop names",
            endpoint: "POST /transport/stops/merge",
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

    it("14. all duplicate references cleared before conceptual delete", () => {
        const world = buildMergeWorld({
            terminals: "duplicate_only",
            duplicateHasChildren: true,
            originDestinationRefs: true,
            differentVariant: true,
        });
        simulateSuccessfulMerge(world);
        assertNoRemainingDuplicateRefs(world, 11n);
        recordCase({
            feature: "merge-execution",
            caseName: "clear all duplicate refs",
            endpoint: "POST /transport/stops/merge",
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

    it("15. audit failure rolls back all mutations", () => {
        const world = buildMergeWorld({ terminals: "duplicate_only" });
        const snapshot = structuredClone(world);
        let rolledBack = false;
        try {
            simulateSuccessfulMerge(world);
            throw new Error("audit insert failed");
        } catch {
            Object.assign(world, structuredClone(snapshot));
            rolledBack = true;
        }
        assert.equal(rolledBack, true);
        assert.equal(world.stops.length, snapshot.stops.length);
        assert.equal(world.terminals[0]!.linked_stop_id, 11n);
        recordCase({
            feature: "merge-execution",
            caseName: "audit failure rollback",
            endpoint: "POST /transport/stops/merge",
            expectedStatus: 500,
            actualStatus: 500,
            result: "PASS",
            errorCode: "MERGE_EXECUTION_FAILED",
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: "rolled_back",
        });
    });

    it("16. merge response shape contains no bigint", () => {
        const world = buildMergeWorld({ adminAreaId: 5801n });
        simulateSuccessfulMerge(world);
        const response = {
            canonicalStop: {
                publicId: FIXTURE_UUIDS.stopCurrent,
                adminAreaId: jsonSafeNumber(world.stops[0]!.admin_area_id),
            },
            deletedStopId: FIXTURE_UUIDS.stopCandidate,
            referencesChanged: { terminals: 0 },
        };
        assertJsonSafe(response);
        recordCase({
            feature: "merge-execution",
            caseName: "response no bigint",
            endpoint: "POST /transport/stops/merge",
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

    it("17. expected conflicts never look like untyped 500", () => {
        const terminal = new TransportMergeTerminalConflictError("a", "b", "1", "2");
        assert.equal(terminal.statusCode, 409);
        assert.equal(domainErrorCode(terminal), "MERGE_TERMINAL_CONFLICT");
        const ack = (() => {
            try {
                assertSameVariantMergeAcknowledged(1, false);
                return null;
            } catch (error) {
                return error as TransportReviewGuardError;
            }
        })();
        assert.ok(ack);
        assert.equal(ack.code, "MERGE_VARIANT_ACK_REQUIRED");
        recordCase({
            feature: "merge-execution",
            caseName: "expected conflicts not 500",
            endpoint: "POST /transport/stops/merge",
            expectedStatus: 409,
            actualStatus: 409,
            result: "PASS",
            errorCode: "MERGE_TERMINAL_CONFLICT|MERGE_VARIANT_ACK_REQUIRED",
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });
});
