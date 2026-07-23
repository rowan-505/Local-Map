import assert from "node:assert/strict";

import type { FixtureWorld } from "./fixtures.js";

export type IntegrityViolation = {
    code: string;
    message: string;
};

/**
 * In-memory integrity checks mirroring Phase 9 database assertions.
 * Safe for mock worlds; does not query production.
 */
export function collectWorldIntegrityViolations(world: FixtureWorld): IntegrityViolation[] {
    const violations: IntegrityViolation[] = [];
    const activeStops = world.stops.filter((s) => s.deleted_at === null);
    const stopById = new Map(activeStops.map((s) => [s.id, s]));

    for (const stop of activeStops) {
        if (stop.parent_stop_id === stop.id) {
            violations.push({
                code: "SELF_PARENT",
                message: `Stop ${stop.public_id} is its own parent.`,
            });
        }
        if (stop.parent_stop_id !== null && !stopById.has(stop.parent_stop_id)) {
            violations.push({
                code: "ORPHAN_PARENT",
                message: `Stop ${stop.public_id} parent_stop_id is missing.`,
            });
        }
        if (stop.mode !== "bus" && stop.mode !== "train" && stop.mode !== "ferry") {
            // soft note only for unexpected modes in fixtures
        }
    }

    for (const route of world.routes) {
        for (const variant of world.variants.filter((v) => v.route_id === route.id)) {
            if (variant.deleted_at) continue;
            for (const rs of world.routeStops.filter((r) => r.route_variant_id === variant.id)) {
                const stop = stopById.get(rs.stop_id);
                if (!stop) {
                    violations.push({
                        code: "ORPHAN_ROUTE_STOP",
                        message: `Route stop ${rs.id} references missing stop ${rs.stop_id}.`,
                    });
                    continue;
                }
                if (stop.mode !== route.mode) {
                    violations.push({
                        code: "MODE_MISMATCH",
                        message: `Stop ${stop.public_id} mode ${stop.mode} != route ${route.route_code} mode ${route.mode}.`,
                    });
                }
            }
        }
    }

    const byVariant = new Map<bigint, number[]>();
    for (const rs of world.routeStops) {
        const list = byVariant.get(rs.route_variant_id) ?? [];
        list.push(rs.stop_sequence);
        byVariant.set(rs.route_variant_id, list);
    }
    for (const [variantId, sequences] of byVariant) {
        const unique = new Set(sequences);
        if (unique.size !== sequences.length) {
            violations.push({
                code: "DUPLICATE_SEQUENCE",
                message: `Variant ${variantId} has duplicate stop_sequence values.`,
            });
        }
    }

    const linked = new Map<bigint, number>();
    for (const terminal of world.terminals.filter((t) => t.deleted_at === null && t.linked_stop_id)) {
        const stopId = terminal.linked_stop_id!;
        linked.set(stopId, (linked.get(stopId) ?? 0) + 1);
    }
    for (const [stopId, count] of linked) {
        if (count > 1) {
            violations.push({
                code: "TERMINAL_UNIQUE",
                message: `Stop ${stopId} has ${count} active linked terminals.`,
            });
        }
    }

    return violations;
}

export function assertWorldIntegrity(world: FixtureWorld): void {
    const violations = collectWorldIntegrityViolations(world);
    assert.equal(
        violations.length,
        0,
        violations.map((v) => `${v.code}: ${v.message}`).join("; "),
    );
}

export function assertNoRemainingDuplicateRefs(
    world: FixtureWorld,
    duplicateStopId: bigint,
): void {
    const remainingRouteStops = world.routeStops.filter((r) => r.stop_id === duplicateStopId);
    const remainingTerminals = world.terminals.filter(
        (t) => t.deleted_at === null && t.linked_stop_id === duplicateStopId,
    );
    const remainingChildren = world.stops.filter(
        (s) => s.deleted_at === null && s.parent_stop_id === duplicateStopId,
    );
    const remainingNames = world.stopNames.filter((n) => n.stop_id === duplicateStopId);
    const remainingAsOrigin = world.variants.filter(
        (v) => v.deleted_at === null && v.origin_stop_id === duplicateStopId,
    );
    const remainingAsDestination = world.variants.filter(
        (v) => v.deleted_at === null && v.destination_stop_id === duplicateStopId,
    );

    assert.equal(remainingRouteStops.length, 0, "duplicate still referenced by route_stops");
    assert.equal(remainingTerminals.length, 0, "duplicate still linked by terminals");
    assert.equal(remainingChildren.length, 0, "duplicate still has child stops");
    assert.equal(remainingNames.length, 0, "duplicate still has stop_names");
    assert.equal(remainingAsOrigin.length, 0, "duplicate still used as origin");
    assert.equal(remainingAsDestination.length, 0, "duplicate still used as destination");
}
