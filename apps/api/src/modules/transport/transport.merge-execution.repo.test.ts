import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { TransportRepository } from "./transport.repo.js";
import {
    TransportMergeParentConflictError,
    TransportMergeTerminalConflictError,
    TransportReviewGuardError,
} from "./transport.errors.js";

const CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_ID = "22222222-2222-4222-8222-222222222222";
const TERMINAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TERMINAL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type RawHandler = (arg: unknown, ...rest: unknown[]) => Promise<unknown>;

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

function extractValues(arg: unknown): unknown[] {
    if (arg && typeof arg === "object") {
        const obj = arg as Record<string, unknown>;
        if (Array.isArray(obj.values)) return obj.values;
    }
    return [];
}

function stopRow(options: {
    id: bigint;
    publicId: string;
    adminAreaId?: bigint | null;
    parentStopId?: bigint | null;
    name?: string;
}) {
    return {
        id: options.id,
        public_id: options.publicId,
        name: options.name ?? `Stop ${options.id}`,
        name_mm: null,
        name_en: options.name ?? `Stop ${options.id}`,
        mode: "bus",
        stop_type: "stop",
        admin_area_id: options.adminAreaId ?? 5801n,
        admin_area_name: "Yangon",
        review_status: "needs_review",
        confidence_score: 70,
        is_active: true,
        longitude: 96.15,
        latitude: 16.8,
        parent_stop_id: options.parentStopId ?? null,
    };
}

function emptyReferenceCounts(overrides: Record<string, bigint> = {}) {
    return {
        current_route_stops: 0n,
        candidate_route_stops: 0n,
        current_variant_origins: 0n,
        candidate_variant_origins: 0n,
        current_variant_destinations: 0n,
        candidate_variant_destinations: 0n,
        current_terminals: 0n,
        candidate_terminals: 0n,
        current_fares_origin: 0n,
        candidate_fares_origin: 0n,
        current_fares_destination: 0n,
        candidate_fares_destination: 0n,
        current_child_stops: 0n,
        candidate_child_stops: 0n,
        current_stop_names: 0n,
        candidate_stop_names: 0n,
        current_source_links: 0n,
        candidate_source_links: 0n,
        ...overrides,
    };
}

type MergeFixture = {
    terminals: Array<{
        id: bigint;
        public_id: string;
        linked_stop_id: bigint;
        name: string;
        review_status?: string;
        is_active?: boolean;
    }>;
    canonicalParentStopId?: bigint | null;
    duplicateChildren?: bigint[];
    sameVariantUsage?: boolean;
    failAudit?: boolean;
    track: {
        mutated: boolean;
        terminalRepointedTo: bigint | null;
        deletedStopIds: bigint[];
        clearedCanonicalParent: boolean;
        childRepoints: number;
        committed: boolean;
    };
};

function createMergePrisma(fixture: MergeFixture): PrismaClient {
    const track = fixture.track;
    const terminals = [...fixture.terminals];
    let duplicateDeleted = false;
    let childrenRepointed = false;
    let remainingDuplicateChildren = [...(fixture.duplicateChildren ?? [])];

    const queryRaw: RawHandler = async (arg) => {
        const sql = extractSql(arg);
        const values = extractValues(arg);

        if (sql.includes("to_regclass") || sql.includes("information_schema.schemata")) {
            return [{ exists: true }];
        }
        if (sql.includes("SELECT 1 FROM transport.routes")) {
            return [{ "?column?": 1 }];
        }
        if (sql.includes("information_schema.columns")) {
            return [{ exists: false }];
        }

        // Single-stop snapshot (loadMergePreviewStopRow)
        if (
            sql.includes("FROM transport.stops s") &&
            sql.includes("WHERE s.public_id =") &&
            sql.includes("LIMIT 1")
        ) {
            const publicId = String(values[0] ?? "");
            if (publicId === CANDIDATE_ID && duplicateDeleted) {
                return [];
            }
            if (publicId === CANDIDATE_ID) {
                return [stopRow({ id: 2n, publicId: CANDIDATE_ID })];
            }
            return [
                stopRow({
                    id: 1n,
                    publicId: CURRENT_ID,
                    parentStopId: fixture.canonicalParentStopId ?? null,
                }),
            ];
        }

        // Preview pair load
        if (sql.includes("FROM transport.stops s") && sql.includes("public_id IN")) {
            return [
                stopRow({
                    id: 1n,
                    publicId: CURRENT_ID,
                    parentStopId: fixture.canonicalParentStopId ?? null,
                }),
                stopRow({ id: 2n, publicId: CANDIDATE_ID }),
            ];
        }

        if (sql.includes("geom_same") || sql.includes("ST_Equals") || sql.includes("ST_Distance")) {
            return [{ geom_same: true, geom_distance_m: 0 }];
        }

        if (sql.includes("AS current_route_stops")) {
            return [
                emptyReferenceCounts({
                    current_terminals: BigInt(
                        terminals.filter((t) => t.linked_stop_id === 1n).length,
                    ),
                    candidate_terminals: BigInt(
                        terminals.filter((t) => t.linked_stop_id === 2n).length,
                    ),
                    candidate_child_stops: BigInt(remainingDuplicateChildren.length),
                }),
            ];
        }

        if (
            sql.includes("FROM transport.terminals") &&
            sql.includes("linked_stop_id") &&
            !sql.includes("FOR UPDATE") &&
            !sql.includes("UPDATE")
        ) {
            return terminals.map((t) => ({
                id: t.id,
                public_id: t.public_id,
                linked_stop_id: t.linked_stop_id,
                name: t.name,
            }));
        }

        if (sql.includes("stop_internal_id") || (sql.includes("FROM transport.route_stops rs") && sql.includes("variant"))) {
            if (!fixture.sameVariantUsage) {
                return [];
            }
            return [
                {
                    stop_id: 1n,
                    stop_internal_id: 1n,
                    route_stop_id: "101",
                    route_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    route_code: "YBS-1",
                    route_name: "YBS 1",
                    variant_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    variant_code: "YBS-1-A",
                    direction_name: "outbound",
                    direction_id: 0,
                    stop_sequence: 10,
                },
                {
                    stop_id: 2n,
                    stop_internal_id: 2n,
                    route_stop_id: "202",
                    route_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    route_code: "YBS-1",
                    route_name: "YBS 1",
                    variant_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    variant_code: "YBS-1-A",
                    direction_name: "outbound",
                    direction_id: 0,
                    stop_sequence: 20,
                },
            ];
        }

        if (
            sql.includes("FROM transport.stops") &&
            sql.includes("FOR UPDATE") &&
            sql.includes("review_status")
        ) {
            return [
                {
                    id: 1n,
                    public_id: CURRENT_ID,
                    mode: "bus",
                    review_status: "needs_review",
                    parent_stop_id: fixture.canonicalParentStopId ?? null,
                    updated_at: new Date("2026-01-01T00:00:00.000Z"),
                },
                {
                    id: 2n,
                    public_id: CANDIDATE_ID,
                    mode: "bus",
                    review_status: "needs_review",
                    parent_stop_id: null,
                    updated_at: new Date("2026-01-01T00:00:00.000Z"),
                },
            ];
        }

        if (sql.includes("FROM transport.terminals") && sql.includes("FOR UPDATE")) {
            return terminals.map((t) => ({
                id: t.id,
                public_id: t.public_id,
                linked_stop_id: t.linked_stop_id,
                name: t.name,
                review_status: t.review_status ?? "reviewed",
                is_active: t.is_active ?? true,
            }));
        }

        if (sql.includes("SELECT parent_stop_id") && sql.includes("FROM transport.stops")) {
            return [{ parent_stop_id: null }];
        }

        if (
            sql.includes("SELECT id") &&
            sql.includes("FROM transport.stops") &&
            sql.includes("parent_stop_id =")
        ) {
            return remainingDuplicateChildren.map((id) => ({ id }));
        }

        if (sql.includes("AS route_stops") && sql.includes("AS terminals")) {
            const stopId = values.find((v) => typeof v === "bigint") as bigint | undefined;
            const id = stopId ?? 0n;
            return [
                {
                    route_stops: 0n,
                    variant_origins: 0n,
                    variant_destinations: 0n,
                    terminals: BigInt(
                        terminals.filter((t) => t.linked_stop_id === id).length,
                    ),
                    fares_origin: 0n,
                    fares_destination: 0n,
                    child_stops: BigInt(
                        id === 2n && !childrenRepointed ? remainingDuplicateChildren.length : 0,
                    ),
                    stop_names: 0n,
                    source_links: 0n,
                },
            ];
        }

        if (sql.includes("UPDATE transport.route_stops")) {
            track.mutated = true;
            return [];
        }
        if (sql.includes("UPDATE transport.route_variants")) {
            track.mutated = true;
            return [];
        }
        if (sql.includes("UPDATE transport.stop_names") || sql.includes("UPDATE transport.source_links")) {
            track.mutated = true;
            return [{ count: 0n }];
        }
        if (sql.includes("WITH updated AS") && sql.includes("parent_stop_id")) {
            track.mutated = true;
            track.childRepoints = remainingDuplicateChildren.length;
            childrenRepointed = true;
            remainingDuplicateChildren = [];
            return [{ count: BigInt(track.childRepoints) }];
        }

        return [];
    };

    const executeRaw: RawHandler = async (arg) => {
        const sql = extractSql(arg);
        if (sql.includes("UPDATE transport.terminals")) {
            track.mutated = true;
            track.terminalRepointedTo = 1n;
            const dupTerm = terminals.find((t) => t.linked_stop_id === 2n);
            if (dupTerm) {
                dupTerm.linked_stop_id = 1n;
            }
            return 1;
        }
        if (sql.includes("parent_stop_id = NULL") && sql.includes("UPDATE transport.stops")) {
            track.mutated = true;
            track.clearedCanonicalParent = true;
            fixture.canonicalParentStopId = null;
            return 1;
        }
        if (sql.includes("DELETE FROM transport.stops")) {
            track.mutated = true;
            track.deletedStopIds.push(2n);
            duplicateDeleted = true;
            return 1;
        }
        if (sql.includes("DELETE FROM transport.stop_names") || sql.includes("DELETE FROM transport.source_links")) {
            track.mutated = true;
            return 0;
        }
        if (sql.includes("INSERT INTO") && sql.includes("transport_audit_logs")) {
            if (fixture.failAudit) {
                throw new Error("audit insert failed");
            }
            return 1;
        }
        return 0;
    };

    const client = {
        $queryRaw: mock.fn(queryRaw),
        $executeRaw: mock.fn(executeRaw),
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
            try {
                const result = await fn(client);
                track.committed = true;
                return result;
            } catch (error) {
                track.committed = false;
                throw error;
            }
        },
    };
    return client as unknown as PrismaClient;
}

describe("TransportRepository.mergeStopsKeepCanonical terminal safety", () => {
    it("rejects dual-terminal merge with 409 domain error and no commit", async () => {
        const track = {
            mutated: false,
            terminalRepointedTo: null as bigint | null,
            deletedStopIds: [] as bigint[],
            clearedCanonicalParent: false,
            childRepoints: 0,
            committed: false,
        };
        const prisma = createMergePrisma({
            terminals: [
                {
                    id: 10n,
                    public_id: TERMINAL_A,
                    linked_stop_id: 1n,
                    name: "A",
                },
                {
                    id: 20n,
                    public_id: TERMINAL_B,
                    linked_stop_id: 2n,
                    name: "B",
                },
            ],
            track,
        });
        const repo = new TransportRepository(prisma);

        await assert.rejects(
            () =>
                repo.mergeStopsKeepCanonical(CURRENT_ID, CANDIDATE_ID, {
                    currentStopPublicId: CURRENT_ID,
                    candidateStopPublicId: CANDIDATE_ID,
                }),
            (error: unknown) => {
                assert.ok(error instanceof TransportMergeTerminalConflictError);
                assert.equal(error.code, "MERGE_TERMINAL_CONFLICT");
                assert.equal(error.statusCode, 409);
                assert.match(error.message, /active terminals/i);
                assert.equal(error.message.includes("23505"), false);
                return true;
            },
        );

        assert.equal(track.committed, false);
        assert.equal(track.deletedStopIds.length, 0);
        assert.equal(track.terminalRepointedTo, null);
    });

    it("repoints only-duplicate terminal to canonical and deletes duplicate", async () => {
        const track = {
            mutated: false,
            terminalRepointedTo: null as bigint | null,
            deletedStopIds: [] as bigint[],
            clearedCanonicalParent: false,
            childRepoints: 0,
            committed: false,
        };
        const terminals = [
            {
                id: 20n,
                public_id: TERMINAL_B,
                linked_stop_id: 2n,
                name: "Dup terminal",
            },
        ];
        const prisma = createMergePrisma({ terminals, track });
        const repo = new TransportRepository(prisma);

        const result = await repo.mergeStopsKeepCanonical(CURRENT_ID, CANDIDATE_ID, {
            currentStopPublicId: CURRENT_ID,
            candidateStopPublicId: CANDIDATE_ID,
        });

        assert.equal(track.committed, true);
        assert.equal(track.terminalRepointedTo, 1n);
        assert.deepEqual(track.deletedStopIds, [2n]);
        assert.equal(result.referencesChanged.terminals, 1);
        assert.equal(terminals[0]?.linked_stop_id, 1n);
        assert.doesNotThrow(() => JSON.stringify(result));
        assert.equal(typeof result.canonicalStop.adminAreaId, "number");
    });

    it("leaves only-canonical terminal unchanged", async () => {
        const track = {
            mutated: false,
            terminalRepointedTo: null as bigint | null,
            deletedStopIds: [] as bigint[],
            clearedCanonicalParent: false,
            childRepoints: 0,
            committed: false,
        };
        const terminals = [
            {
                id: 10n,
                public_id: TERMINAL_A,
                linked_stop_id: 1n,
                name: "Keep terminal",
            },
        ];
        const prisma = createMergePrisma({ terminals, track });
        const repo = new TransportRepository(prisma);

        const result = await repo.mergeStopsKeepCanonical(CURRENT_ID, CANDIDATE_ID, {
            currentStopPublicId: CURRENT_ID,
            candidateStopPublicId: CANDIDATE_ID,
        });

        assert.equal(track.terminalRepointedTo, null);
        assert.equal(terminals[0]?.linked_stop_id, 1n);
        assert.equal(result.referencesChanged.terminals, 0);
        assert.deepEqual(track.deletedStopIds, [2n]);
    });

    it("merges when neither stop has a terminal", async () => {
        const track = {
            mutated: false,
            terminalRepointedTo: null as bigint | null,
            deletedStopIds: [] as bigint[],
            clearedCanonicalParent: false,
            childRepoints: 0,
            committed: false,
        };
        const prisma = createMergePrisma({ terminals: [], track });
        const repo = new TransportRepository(prisma);

        const result = await repo.mergeStopsKeepCanonical(CURRENT_ID, CANDIDATE_ID, {
            currentStopPublicId: CURRENT_ID,
            candidateStopPublicId: CANDIDATE_ID,
        });

        assert.equal(result.referencesChanged.terminals, 0);
        assert.deepEqual(track.deletedStopIds, [2n]);
        assert.equal(track.committed, true);
    });

    it("requires same-variant acknowledgement", async () => {
        const track = {
            mutated: false,
            terminalRepointedTo: null as bigint | null,
            deletedStopIds: [] as bigint[],
            clearedCanonicalParent: false,
            childRepoints: 0,
            committed: false,
        };
        const prisma = createMergePrisma({
            terminals: [],
            sameVariantUsage: true,
            track,
        });
        const repo = new TransportRepository(prisma);

        await assert.rejects(
            () =>
                repo.mergeStopsKeepCanonical(CURRENT_ID, CANDIDATE_ID, {
                    currentStopPublicId: CURRENT_ID,
                    candidateStopPublicId: CANDIDATE_ID,
                }),
            (error: unknown) => {
                assert.ok(error instanceof TransportReviewGuardError);
                assert.equal(error.code, "MERGE_VARIANT_ACK_REQUIRED");
                return true;
            },
        );
        assert.equal(track.deletedStopIds.length, 0);
    });

    it("proceeds past acknowledgement gate when ack is true", async () => {
        const track = {
            mutated: false,
            terminalRepointedTo: null as bigint | null,
            deletedStopIds: [] as bigint[],
            clearedCanonicalParent: false,
            childRepoints: 0,
            committed: false,
        };
        const prisma = createMergePrisma({
            terminals: [],
            sameVariantUsage: true,
            track,
        });
        const repo = new TransportRepository(prisma);

        const result = await repo.mergeStopsKeepCanonical(CURRENT_ID, CANDIDATE_ID, {
            currentStopPublicId: CURRENT_ID,
            candidateStopPublicId: CANDIDATE_ID,
            acknowledgeSameVariantOccurrences: true,
        });

        assert.equal(track.committed, true);
        assert.deepEqual(track.deletedStopIds, [2n]);
        assert.ok(result.deletedStopId);
    });

    it("clears canonical.parent_stop_id when it points at duplicate", async () => {
        const track = {
            mutated: false,
            terminalRepointedTo: null as bigint | null,
            deletedStopIds: [] as bigint[],
            clearedCanonicalParent: false,
            childRepoints: 0,
            committed: false,
        };
        const prisma = createMergePrisma({
            terminals: [],
            canonicalParentStopId: 2n,
            track,
        });
        const repo = new TransportRepository(prisma);

        await repo.mergeStopsKeepCanonical(CURRENT_ID, CANDIDATE_ID, {
            currentStopPublicId: CURRENT_ID,
            candidateStopPublicId: CANDIDATE_ID,
        });

        assert.equal(track.clearedCanonicalParent, true);
        assert.deepEqual(track.deletedStopIds, [2n]);
    });

    it("repoints duplicate child stops to canonical", async () => {
        const track = {
            mutated: false,
            terminalRepointedTo: null as bigint | null,
            deletedStopIds: [] as bigint[],
            clearedCanonicalParent: false,
            childRepoints: 0,
            committed: false,
        };
        const prisma = createMergePrisma({
            terminals: [],
            duplicateChildren: [99n, 100n],
            track,
        });
        const repo = new TransportRepository(prisma);

        const result = await repo.mergeStopsKeepCanonical(CURRENT_ID, CANDIDATE_ID, {
            currentStopPublicId: CURRENT_ID,
            candidateStopPublicId: CANDIDATE_ID,
        });

        assert.equal(track.childRepoints, 2);
        assert.equal(result.referencesChanged.childStops, 2);
    });

    it("rolls back when audit insertion fails", async () => {
        const track = {
            mutated: false,
            terminalRepointedTo: null as bigint | null,
            deletedStopIds: [] as bigint[],
            clearedCanonicalParent: false,
            childRepoints: 0,
            committed: false,
        };
        const prisma = createMergePrisma({
            terminals: [],
            failAudit: true,
            track,
        });
        const repo = new TransportRepository(prisma);

        await assert.rejects(() =>
            repo.mergeStopsKeepCanonical(CURRENT_ID, CANDIDATE_ID, {
                currentStopPublicId: CURRENT_ID,
                candidateStopPublicId: CANDIDATE_ID,
            }),
        );
        assert.equal(track.committed, false);
    });
});

describe("TransportMergeParentConflictError", () => {
    it("exposes MERGE_PARENT_CONFLICT with status 409", () => {
        const error = new TransportMergeParentConflictError(CURRENT_ID, CANDIDATE_ID);
        assert.equal(error.code, "MERGE_PARENT_CONFLICT");
        assert.equal(error.statusCode, 409);
    });
});
