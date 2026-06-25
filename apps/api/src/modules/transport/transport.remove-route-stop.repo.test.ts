import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { TransportRepository } from "./transport.repo.js";
import { TransportNotFoundError } from "./transport.errors.js";

const VARIANT_ID = 36n;
const VARIANT_PUBLIC_ID = "36b1a519-0a09-44cd-915e-2fde04bee02f";

type RouteStopRow = { id: bigint; stop_id: bigint; stop_sequence: number };

function extractSql(arg: unknown): string {
    if (Array.isArray(arg)) return arg.join("?");
    if (arg && typeof arg === "object") {
        const obj = arg as Record<string, unknown>;
        if (typeof obj.sql === "string") return obj.sql;
        if (typeof obj.text === "string") return obj.text;
        if (Array.isArray(obj.strings)) return (obj.strings as string[]).join("?");
    }
    return String(arg);
}

function bulkValues(arg: unknown): unknown[] {
    if (arg && typeof arg === "object" && Array.isArray((arg as { values?: unknown[] }).values)) {
        return (arg as { values: unknown[] }).values;
    }
    return [];
}

/**
 * Stateful mock PrismaClient for removeRouteStop. `$transaction` runs the
 * callback with the same client, so the deletion + two bulk resequencing UPDATEs
 * mutate the in-memory rows, and the post-commit listStopsForVariant read returns
 * the final ordering for assertions.
 */
function createMockPrisma(initial: RouteStopRow[]) {
    const rows: RouteStopRow[] = initial.map((r) => ({ ...r }));

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
            return [{ id: VARIANT_ID, public_id: VARIANT_PUBLIC_ID }];
        }
        if (sql.includes("count(*)")) {
            return [{ count: BigInt(rows.length) }];
        }
        if (sql.includes("route_paths")) {
            return [];
        }
        if (sql.includes("JOIN transport.stops")) {
            // listStopsForVariant read after commit.
            return [...rows]
                .sort((a, b) => a.stop_sequence - b.stop_sequence)
                .map((r) => ({
                    id: r.id,
                    stop_sequence: r.stop_sequence,
                    pickup_type: 0,
                    drop_off_type: 0,
                    is_timing_point: false,
                    distance_from_start_m: null,
                    stop_public_id: `00000000-0000-4000-8000-${String(r.stop_id).padStart(12, "0")}`,
                    stop_name: `Stop ${r.stop_id}`,
                    stop_name_mm: null,
                    stop_name_en: `Stop ${r.stop_id}`,
                    stop_mode: "bus",
                    stop_type: "stop",
                    geometry: null,
                }));
        }
        if (sql.includes("ORDER BY stop_sequence ASC")) {
            // remaining membership (id, stop_id, stop_sequence) FOR UPDATE
            return [...rows].sort((a, b) => a.stop_sequence - b.stop_sequence);
        }
        if (sql.includes("FROM transport.route_stops")) {
            // beforeRows snapshot: WHERE id = ${id} FOR UPDATE
            const target = rows.find((r) => String(r.id) === String(rest[0]));
            if (!target) return [];
            return [
                {
                    id: target.id,
                    route_variant_id: VARIANT_ID,
                    stop_id: target.stop_id,
                    stop_sequence: target.stop_sequence,
                    pickup_type: 0,
                    drop_off_type: 0,
                    is_timing_point: false,
                    distance_from_start_m: null,
                },
            ];
        }
        return [];
    };

    const executeRaw = async (arg: unknown, ...rest: unknown[]): Promise<number> => {
        const sql = extractSql(arg);
        if (sql.includes("DELETE FROM transport.route_stops")) {
            const id = String(rest[0]);
            const idx = rows.findIndex((r) => String(r.id) === id);
            if (idx >= 0) rows.splice(idx, 1);
            return 1;
        }
        if (sql.includes("temp_sequence") || sql.includes("final_sequence")) {
            applyPairs(bulkValues(arg));
        }
        return 1;
    };

    const client = {
        $queryRaw: queryRaw,
        $executeRaw: executeRaw,
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
    };
    return { prisma: client as unknown as PrismaClient, rows };
}

function makeVariant(count: number): RouteStopRow[] {
    return Array.from({ length: count }, (_, i) => ({
        id: BigInt(100 + i),
        stop_id: BigInt(i + 1),
        stop_sequence: i + 1,
    }));
}

describe("TransportRepository.removeRouteStop (resequencing)", () => {
    it("removes the first stop of a 60-stop variant and resequences to 1..N", async () => {
        const { prisma, rows } = createMockPrisma(makeVariant(60));
        const repo = new TransportRepository(prisma);

        const result = await repo.removeRouteStop(100n); // route_stop id 100 == sequence 1

        assert.equal(result.deleted, true);
        assert.equal(result.variantPublicId, VARIANT_PUBLIC_ID);
        assert.equal(rows.length, 59);

        const sequences = result.items.map((i) => i.stop_sequence);
        assert.deepEqual(
            sequences,
            Array.from({ length: 59 }, (_, i) => i + 1),
            "remaining stops must be a gap-free 1..N"
        );
        // The removed stop (stop_id 1) is gone; old second stop is now first.
        assert.equal(rows.some((r) => String(r.stop_id) === "1"), false);
    });

    it("removes a middle stop and resequences to 1..N", async () => {
        const { prisma, rows } = createMockPrisma(makeVariant(60));
        const repo = new TransportRepository(prisma);

        const result = await repo.removeRouteStop(130n); // sequence 31

        assert.equal(rows.length, 59);
        const sequences = result.items.map((i) => i.stop_sequence);
        assert.deepEqual(
            sequences,
            Array.from({ length: 59 }, (_, i) => i + 1)
        );
    });

    it("removes the last stop with no resequencing needed", async () => {
        const { prisma, rows } = createMockPrisma(makeVariant(60));
        const repo = new TransportRepository(prisma);

        const result = await repo.removeRouteStop(159n); // sequence 60

        assert.equal(rows.length, 59);
        const sequences = result.items.map((i) => i.stop_sequence);
        assert.deepEqual(
            sequences,
            Array.from({ length: 59 }, (_, i) => i + 1)
        );
    });

    it("rejects removing an unknown route stop (404)", async () => {
        const { prisma } = createMockPrisma(makeVariant(5));
        const repo = new TransportRepository(prisma);

        await assert.rejects(repo.removeRouteStop(99999n), TransportNotFoundError);
    });
});
