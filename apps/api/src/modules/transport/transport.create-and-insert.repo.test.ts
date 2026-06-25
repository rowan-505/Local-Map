import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { TransportRepository } from "./transport.repo.js";
import type { CreateAndInsertRouteStopInput } from "./transport.schema.js";

const VARIANT_ID = 42n;
const VARIANT_PUBLIC_ID = "42b1a519-0a09-44cd-915e-2fde04bee0aa";
const NEW_STOP_ID = 5000n;
const NEW_STOP_PUBLIC_ID = "5000aaaa-0a09-44cd-915e-2fde04bee0aa";

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
 * Stateful mock PrismaClient for the full createAndInsertRouteStop path. The
 * `$transaction` callback runs against the same client, so the stop INSERT,
 * localized-name writes, audit inserts, the two bulk resequencing UPDATEs, and
 * the new membership INSERT mutate the in-memory rows; the post-commit lite
 * ordered read then returns the final 1..N ordering for assertions.
 *
 * `bulkUpdateCount` records how many `UPDATE ... FROM (VALUES ...)` statements
 * ran so the test can prove resequencing is bulk (exactly 2), not a per-row loop.
 */
function createMockPrisma(initial: RouteStopRow[]) {
    const rows: RouteStopRow[] = initial.map((r) => ({ ...r }));
    let nextRouteStopId = 9000n;
    let bulkUpdateCount = 0;

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

        // listOrderedStopsLite variant lookup (id + has_path EXISTS).
        if (sql.includes("route_paths")) {
            return [{ id: VARIANT_ID, has_path: false }];
        }
        // resolveVariantForInsert + the FOR UPDATE parent lock.
        if (sql.includes("route_variants")) {
            return [{ id: VARIANT_ID, public_id: VARIANT_PUBLIC_ID }];
        }
        if (sql.includes("INSERT INTO transport.stops")) {
            return [{ id: NEW_STOP_ID, public_id: NEW_STOP_PUBLIC_ID }];
        }
        if (sql.includes("stop_names")) {
            // upsertLocalizedStopName existing-row lookup: none exist yet.
            return [];
        }
        if (sql.includes("max(stop_sequence)")) {
            const m = rows.length === 0 ? null : Math.max(...rows.map((r) => r.stop_sequence));
            return [{ m }];
        }
        if (sql.includes("JOIN transport.stops")) {
            // listOrderedStopsLite ordered read (flat lightweight shape).
            return [...rows]
                .sort((a, b) => a.stop_sequence - b.stop_sequence)
                .map((r) => ({
                    route_stop_id: String(r.id),
                    stop_public_id:
                        String(r.stop_id) === String(NEW_STOP_ID)
                            ? NEW_STOP_PUBLIC_ID
                            : `00000000-0000-4000-8000-${String(r.stop_id).padStart(12, "0")}`,
                    stop_sequence: r.stop_sequence,
                    display_name: `Stop ${r.stop_id}`,
                    name_mm: null,
                    name_en: `Stop ${r.stop_id}`,
                    mode: "bus",
                    stop_type: "stop",
                    longitude: 96.1,
                    latitude: 16.8,
                    pickup_type: 0,
                    drop_off_type: 0,
                    is_timing_point: false,
                }));
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
            // membership read (id, stop_id, stop_sequence) FOR UPDATE
            return [...rows].sort((a, b) => a.stop_sequence - b.stop_sequence);
        }
        return [];
    };

    const executeRaw = async (arg: unknown): Promise<number> => {
        const sql = extractSql(arg);
        if (sql.includes("temp_sequence") || sql.includes("final_sequence")) {
            bulkUpdateCount += 1;
            applyPairs(bulkValues(arg));
        }
        // audit inserts + stop_names insert: no-op
        return 1;
    };

    const client = {
        $queryRaw: queryRaw,
        $executeRaw: executeRaw,
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
    };
    return {
        prisma: client as unknown as PrismaClient,
        rows,
        getBulkUpdateCount: () => bulkUpdateCount,
    };
}

function makeVariant(count: number): RouteStopRow[] {
    return Array.from({ length: count }, (_, i) => ({
        id: BigInt(100 + i),
        stop_id: BigInt(i + 1),
        stop_sequence: i + 1,
    }));
}

function baseInput(
    overrides: Partial<CreateAndInsertRouteStopInput> = {}
): CreateAndInsertRouteStopInput {
    return {
        name_en: "New Stop",
        mode: "bus",
        stop_type: "stop",
        longitude: 96.1,
        latitude: 16.8,
        position: "start",
        pickup_type: 0,
        drop_off_type: 0,
        is_timing_point: false,
        ...overrides,
    };
}

describe("TransportRepository.createAndInsertRouteStop (60-stop variant)", () => {
    it("creates a stop and inserts it at the start, keeping a gap-free 1..N", async () => {
        const { prisma, rows, getBulkUpdateCount } = createMockPrisma(makeVariant(60));
        const repo = new TransportRepository(prisma);

        const result = await repo.createAndInsertRouteStop(
            VARIANT_PUBLIC_ID,
            baseInput({ position: "start" })
        );

        // 61 membership rows, gap-free 1..N.
        assert.equal(rows.length, 61);
        assert.equal(result.route_stop_count, 61);
        const sequences = result.ordered_stops.map((s) => s.stop_sequence);
        assert.deepEqual(
            sequences,
            Array.from({ length: 61 }, (_, i) => i + 1),
            "ordered stops must be a gap-free 1..N"
        );

        // The created stop is surfaced and lands first.
        assert.ok(result.created_stop, "created_stop must be present");
        assert.equal(result.created_stop?.public_id, NEW_STOP_PUBLIC_ID);
        const created = result.ordered_stops.find(
            (s) => s.stop_public_id === NEW_STOP_PUBLIC_ID
        );
        assert.equal(created?.stop_sequence, 1, "new stop should be first");

        // Resequencing is bulk: exactly two UPDATE ... FROM (VALUES ...) statements,
        // regardless of the 60 existing rows (no per-row update loop).
        assert.equal(getBulkUpdateCount(), 2, "resequencing must use exactly 2 bulk UPDATEs");
    });

    it("creates a stop and inserts it at the end, keeping a gap-free 1..N", async () => {
        const { prisma, rows, getBulkUpdateCount } = createMockPrisma(makeVariant(60));
        const repo = new TransportRepository(prisma);

        const result = await repo.createAndInsertRouteStop(
            VARIANT_PUBLIC_ID,
            baseInput({ position: "end" })
        );

        assert.equal(rows.length, 61);
        assert.equal(result.route_stop_count, 61);
        const created = result.ordered_stops.find(
            (s) => s.stop_public_id === NEW_STOP_PUBLIC_ID
        );
        assert.equal(created?.stop_sequence, 61, "new stop should be last");
        assert.equal(getBulkUpdateCount(), 2, "resequencing must use exactly 2 bulk UPDATEs");
    });

    it("creates a stop before an anchor (middle) and keeps a gap-free 1..N", async () => {
        const { prisma, getBulkUpdateCount } = createMockPrisma(makeVariant(60));
        const repo = new TransportRepository(prisma);

        // Anchor = route_stop id 130 (originally sequence 31).
        const result = await repo.createAndInsertRouteStop(
            VARIANT_PUBLIC_ID,
            baseInput({ position: "before", anchorRouteStopId: "130" })
        );

        assert.equal(result.route_stop_count, 61);
        const created = result.ordered_stops.find(
            (s) => s.stop_public_id === NEW_STOP_PUBLIC_ID
        );
        assert.equal(created?.stop_sequence, 31, "new stop takes the anchor's slot");
        assert.deepEqual(
            result.ordered_stops.map((s) => s.stop_sequence),
            Array.from({ length: 61 }, (_, i) => i + 1)
        );
        assert.equal(getBulkUpdateCount(), 2, "resequencing must use exactly 2 bulk UPDATEs");
    });
});
