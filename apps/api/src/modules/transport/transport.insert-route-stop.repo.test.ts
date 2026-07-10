import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { TransportRepository } from "./transport.repo.js";

const VARIANT_ID = 36n;

type RouteStopRow = { id: bigint; stop_id: bigint; stop_sequence: number };

/** Best-effort SQL text from either a tagged-template array or a Prisma.Sql object. */
function extractSql(arg: unknown): string {
    if (Array.isArray(arg)) {
        return arg.join("?");
    }
    if (arg && typeof arg === "object") {
        const obj = arg as Record<string, unknown>;
        if (typeof obj.sql === "string") return obj.sql;
        if (typeof obj.text === "string") return obj.text;
        if (Array.isArray(obj.strings)) return (obj.strings as string[]).join("?");
    }
    return String(arg);
}

/** Flat `[id, seq, id, seq, ...]` values from a bulk Prisma.sql UPDATE. */
function bulkValues(arg: unknown): unknown[] {
    if (arg && typeof arg === "object" && Array.isArray((arg as { values?: unknown[] }).values)) {
        return (arg as { values: unknown[] }).values;
    }
    return [];
}

/**
 * Stateful in-memory mock of the route_stops slice for one variant. It mirrors
 * the exact statements issued by insertStopIntoVariantTx (variant lock, ordered
 * membership read, max(sequence), two bulk resequencing UPDATEs, the INSERT, and
 * the audit insert) so the final stop_sequence ordering can be asserted.
 */
function createStatefulTx(initial: RouteStopRow[]) {
    const rows: RouteStopRow[] = initial.map((r) => ({ ...r }));
    let nextRouteStopId = 9000n;

    const applyPairs = (values: unknown[]) => {
        for (let i = 0; i + 1 < values.length; i += 2) {
            const id = String(values[i]);
            const seq = Number(values[i + 1]);
            const row = rows.find((r) => String(r.id) === id);
            if (row) row.stop_sequence = seq;
        }
    };

    const queryRaw = async (arg: unknown, ...rest: unknown[]): Promise<unknown> => {
        const sql = extractSql(arg);
        if (sql.includes("route_variants")) {
            return [{ id: VARIANT_ID }];
        }
        if (sql.includes("max(stop_sequence)")) {
            const m = rows.length === 0 ? null : Math.max(...rows.map((r) => r.stop_sequence));
            return [{ m }];
        }
        if (sql.includes("INSERT INTO transport.route_stops")) {
            const id = nextRouteStopId;
            nextRouteStopId += 1n;
            // Tagged-template values: variantId, stopId, stop_sequence, ...
            rows.push({
                id,
                stop_id: BigInt(rest[1] as bigint | number),
                stop_sequence: Number(rest[2]),
            });
            return [{ id }];
        }
        if (sql.includes("FROM transport.route_stops")) {
            return [...rows].sort((a, b) => a.stop_sequence - b.stop_sequence);
        }
        return [];
    };

    const executeRaw = async (arg: unknown): Promise<number> => {
        const sql = extractSql(arg);
        if (sql.includes("temp_sequence") || sql.includes("final_sequence")) {
            applyPairs(bulkValues(arg));
        }
        // audit insert + anything else: no-op
        return 1;
    };

    const tx = { $queryRaw: queryRaw, $executeRaw: executeRaw };
    return { tx, rows };
}

type InsertArgs = {
    variantId: bigint;
    variantPublicId: string;
    stopId: bigint;
    stopRef: string;
    position: "start" | "end" | "before" | "after";
    anchorRouteStopId?: string;
    pickup_type: number;
    drop_off_type: number;
    is_timing_point: boolean;
};

type RepoWithPrivate = {
    insertStopIntoVariantTx: (tx: unknown, args: InsertArgs) => Promise<bigint>;
};

function callInsert(rows: RouteStopRow[], overrides: Partial<InsertArgs>) {
    const { tx, rows: state } = createStatefulTx(rows);
    const repo = new TransportRepository({} as unknown as PrismaClient);
    const args: InsertArgs = {
        variantId: VARIANT_ID,
        variantPublicId: "36b1a519-0a09-44cd-915e-2fde04bee02f",
        stopId: 9999n,
        stopRef: "9999",
        position: "start",
        pickup_type: 0,
        drop_off_type: 0,
        is_timing_point: false,
        ...overrides,
    };
    const promise = (repo as unknown as RepoWithPrivate).insertStopIntoVariantTx(tx, args);
    return { promise, state };
}

/** Build a gap-free variant: route_stop id 100+i, stop_id i+1, sequence i+1. */
function makeVariant(count: number): RouteStopRow[] {
    return Array.from({ length: count }, (_, i) => ({
        id: BigInt(100 + i),
        stop_id: BigInt(i + 1),
        stop_sequence: i + 1,
    }));
}

function sortedSequences(rows: RouteStopRow[]): number[] {
    return rows.map((r) => r.stop_sequence).sort((a, b) => a - b);
}

function assertGapFree(rows: RouteStopRow[]) {
    const expected = Array.from({ length: rows.length }, (_, i) => i + 1);
    assert.deepEqual(sortedSequences(rows), expected, "final sequences must be a gap-free 1..N");
}

function seqForStop(rows: RouteStopRow[], stopId: bigint): number | undefined {
    return rows.find((r) => String(r.stop_id) === String(stopId))?.stop_sequence;
}

/** stop_id 1 at sequence 1 and again at sequence 39 (circular closing revisit). */
function makeRevisitAtOneAndThirtyNine(): RouteStopRow[] {
    const rows = makeVariant(39);
    rows[38] = { id: 138n, stop_id: 1n, stop_sequence: 39 };
    return rows;
}

describe("TransportRepository.insertStopIntoVariantTx (resequencing)", () => {
    it("inserts at the start of a 60-stop variant and keeps 1..N", async () => {
        const { promise, state } = callInsert(makeVariant(60), { position: "start" });
        await promise;

        assert.equal(state.length, 61);
        assertGapFree(state);
        assert.equal(seqForStop(state, 9999n), 1, "new stop should be first");
    });

    it("inserts between two stops (before an anchor) and keeps 1..N", async () => {
        // Anchor = the 31st row (route_stop id 130, originally sequence 31).
        const { promise, state } = callInsert(makeVariant(60), {
            position: "before",
            anchorRouteStopId: "130",
        });
        await promise;

        assert.equal(state.length, 61);
        assertGapFree(state);
        assert.equal(seqForStop(state, 9999n), 31, "new stop should take the anchor's slot");
    });

    it("inserts at the end of a 60-stop variant and keeps 1..N", async () => {
        const { promise, state } = callInsert(makeVariant(60), { position: "end" });
        await promise;

        assert.equal(state.length, 61);
        assertGapFree(state);
        assert.equal(seqForStop(state, 9999n), 61, "new stop should be last");
    });

    it("inserts into an empty variant at sequence 1", async () => {
        const { promise, state } = callInsert([], { position: "start" });
        await promise;

        assert.equal(state.length, 1);
        assertGapFree(state);
        assert.equal(seqForStop(state, 9999n), 1);
    });

    it("allows the same stop_id at another occurrence (circular revisit)", async () => {
        const { promise, state } = callInsert(makeRevisitAtOneAndThirtyNine(), {
            position: "end",
            stopId: 1n,
            stopRef: "1",
        });
        await promise;

        assert.equal(state.length, 40);
        assertGapFree(state);

        const occurrences = state.filter((r) => String(r.stop_id) === "1");
        assert.equal(occurrences.length, 3, "stop_id 1 at sequences 1, 39, and new end");
        const sequences = occurrences.map((r) => r.stop_sequence).sort((a, b) => a - b);
        assert.deepEqual(sequences, [1, 39, 40]);

        const firstOccurrence = state.find((r) => r.id === 100n);
        assert.ok(firstOccurrence);
        assert.equal(firstOccurrence.stop_sequence, 1);
    });
});
