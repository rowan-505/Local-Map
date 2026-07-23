import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { TransportRepository } from "./transport.repo.js";

const CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_ID = "22222222-2222-4222-8222-222222222222";

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

function createMergePreviewPrisma(options: {
    currentAdminAreaId: bigint | number | null;
    candidateAdminAreaId: bigint | number | null;
    usageRows?: Array<{
        stop_internal_id: bigint;
        route_stop_id: string;
        route_id: string;
        route_code: string;
        route_name: string | null;
        variant_id: string;
        variant_code: string;
        direction_name: string | null;
        direction_id: number | null;
        stop_sequence: number;
    }>;
    terminalRows?: Array<{
        id: bigint;
        public_id: string;
        linked_stop_id: bigint;
        name: string;
    }>;
}): PrismaClient {
    const usageRows = options.usageRows ?? [];
    const terminalRows = options.terminalRows ?? [];

    const queryRaw: RawHandler = async (arg) => {
        const sql = extractSql(arg);

        if (sql.includes('to_regclass') || sql.includes("information_schema.schemata")) {
            return [{ exists: true }];
        }
        if (sql.includes("SELECT 1 FROM transport.routes")) {
            return [{ "?column?": 1 }];
        }
        if (sql.includes("information_schema.columns")) {
            return [{ exists: false }];
        }
        if (sql.includes("FROM transport.stops s") && sql.includes("public_id IN")) {
            return [
                {
                    id: 1n,
                    public_id: CURRENT_ID,
                    name: "Current",
                    name_mm: null,
                    name_en: "Current",
                    mode: "bus",
                    stop_type: "stop",
                    admin_area_id: options.currentAdminAreaId,
                    admin_area_name: "Yangon",
                    review_status: "needs_review",
                    confidence_score: 70,
                    is_active: true,
                    longitude: 96.15,
                    latitude: 16.8,
                },
                {
                    id: 2n,
                    public_id: CANDIDATE_ID,
                    name: "Candidate",
                    name_mm: null,
                    name_en: "Candidate",
                    mode: "bus",
                    stop_type: "stop",
                    admin_area_id: options.candidateAdminAreaId,
                    admin_area_name: "Yangon",
                    review_status: "needs_review",
                    confidence_score: 75,
                    is_active: true,
                    longitude: 96.151,
                    latitude: 16.801,
                },
            ];
        }
        if (sql.includes("ST_Equals") || sql.includes("geom_same") || sql.includes("ST_Distance")) {
            return [{ geom_same: false, geom_distance_m: 12.5 }];
        }
        if (sql.includes("AS current_route_stops") || sql.includes("current_route_stops")) {
            return [
                {
                    current_route_stops: BigInt(usageRows.filter((r) => r.stop_internal_id === 1n).length),
                    candidate_route_stops: BigInt(usageRows.filter((r) => r.stop_internal_id === 2n).length),
                    current_variant_origins: 0n,
                    candidate_variant_origins: 0n,
                    current_variant_destinations: 0n,
                    candidate_variant_destinations: 0n,
                    current_terminals: BigInt(
                        terminalRows.filter((r) => r.linked_stop_id === 1n).length,
                    ),
                    candidate_terminals: BigInt(
                        terminalRows.filter((r) => r.linked_stop_id === 2n).length,
                    ),
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
                },
            ];
        }
        if (
            sql.includes("FROM transport.terminals") &&
            sql.includes("public_id") &&
            !sql.includes("current_terminals")
        ) {
            return terminalRows;
        }
        if (sql.includes("FROM transport.route_stops rs") || sql.includes("stop_internal_id")) {
            return usageRows;
        }
        return [];
    };

    const client = {
        $queryRaw: mock.fn(queryRaw),
        $executeRaw: mock.fn(async () => 0),
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
    };
    return client as unknown as PrismaClient;
}

describe("TransportRepository.getStopMergePreview bigint serialization", () => {
    it("returns JSON-serializable preview when admin_area_id is bigint", async () => {
        const prisma = createMergePreviewPrisma({
            currentAdminAreaId: 5801n,
            candidateAdminAreaId: 5801n,
            usageRows: [
                {
                    stop_internal_id: 1n,
                    route_stop_id: "101",
                    route_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    route_code: "YBS-11",
                    route_name: null,
                    variant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    variant_code: "YBS-11-A",
                    direction_name: "outbound",
                    direction_id: 0,
                    stop_sequence: 10,
                },
            ],
        });
        const repo = new TransportRepository(prisma);
        const preview = await repo.getStopMergePreview(CURRENT_ID, CANDIDATE_ID);

        assert.equal(preview.currentStop.adminAreaId, 5801);
        assert.equal(typeof preview.currentStop.adminAreaId, "number");
        assert.equal(preview.candidateStop.adminAreaId, 5801);
        assert.equal(typeof preview.candidateStop.adminAreaId, "number");
        assert.equal(preview.fieldComparison.admin_area_id.current, 5801);
        assert.equal(preview.fieldComparison.admin_area_id.candidate, 5801);
        assert.equal(typeof preview.fieldComparison.admin_area_id.current, "number");
        assert.equal(preview.candidateUsage.summary.totalRoutes, 0);
        assert.equal(preview.currentUsage.summary.totalRoutes, 1);
        assert.equal(preview.affectedRoutes.length, 1);
        assert.equal(preview.mergeAllowed, true);
        const serialized = JSON.stringify(preview);
        assert.doesNotThrow(() => JSON.parse(serialized));
        assert.match(serialized, /"adminAreaId":5801/);
        assert.doesNotMatch(serialized, /5801n/);
    });

    it("returns JSON-safe null adminAreaId when admin_area_id is null", async () => {
        const prisma = createMergePreviewPrisma({
            currentAdminAreaId: null,
            candidateAdminAreaId: null,
        });
        const repo = new TransportRepository(prisma);
        const preview = await repo.getStopMergePreview(CURRENT_ID, CANDIDATE_ID);

        assert.equal(preview.currentStop.adminAreaId, null);
        assert.equal(preview.candidateStop.adminAreaId, null);
        assert.doesNotThrow(() => JSON.stringify(preview));
    });

    it("coerces non-null number admin_area_id without BigInt leakage", async () => {
        const prisma = createMergePreviewPrisma({
            currentAdminAreaId: 9999,
            candidateAdminAreaId: 8888,
        });
        const repo = new TransportRepository(prisma);
        const preview = await repo.getStopMergePreview(CURRENT_ID, CANDIDATE_ID);

        assert.equal(preview.currentStop.adminAreaId, 9999);
        assert.equal(preview.candidateStop.adminAreaId, 8888);
        assert.doesNotThrow(() => JSON.stringify(preview));
    });

    it("reports both-stops-in-same-variant as duplicate membership, not a hard block", async () => {
        const prisma = createMergePreviewPrisma({
            currentAdminAreaId: null,
            candidateAdminAreaId: null,
            usageRows: [
                {
                    stop_internal_id: 1n,
                    route_stop_id: "101",
                    route_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    route_code: "YBS-34",
                    route_name: "YBS 34",
                    variant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    variant_code: "YBS-34-A",
                    direction_name: "outbound",
                    direction_id: 0,
                    stop_sequence: 12,
                },
                {
                    stop_internal_id: 2n,
                    route_stop_id: "202",
                    route_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    route_code: "YBS-34",
                    route_name: "YBS 34",
                    variant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    variant_code: "YBS-34-A",
                    direction_name: "outbound",
                    direction_id: 0,
                    stop_sequence: 45,
                },
            ],
        });
        const repo = new TransportRepository(prisma);
        const preview = await repo.getStopMergePreview(CURRENT_ID, CANDIDATE_ID);

        assert.equal(preview.duplicateMembershipConflicts.length, 1);
        assert.equal(preview.sameVariantConflicts.length, 1);
        assert.equal(preview.sequenceConflicts.length, 0);
        assert.equal(preview.mergeAllowed, true);
        assert.ok(preview.sameVariantWarning);
    });

    it("blocks merge when both stops have active terminals", async () => {
        const prisma = createMergePreviewPrisma({
            currentAdminAreaId: 5801n,
            candidateAdminAreaId: 5801n,
            terminalRows: [
                {
                    id: 101n,
                    public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    linked_stop_id: 1n,
                    name: "Current terminal",
                },
                {
                    id: 202n,
                    public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    linked_stop_id: 2n,
                    name: "Candidate terminal",
                },
            ],
        });
        const repo = new TransportRepository(prisma);
        const preview = await repo.getStopMergePreview(CURRENT_ID, CANDIDATE_ID);

        assert.equal(preview.terminalConflict.exists, true);
        assert.equal(preview.mergeAllowed, false);
        assert.ok(preview.mergeBlockers.includes("MERGE_TERMINAL_CONFLICT"));
        assert.equal(preview.terminalConflict.canonicalTerminal?.id, "101");
        assert.equal(preview.terminalConflict.duplicateTerminal?.id, "202");
        assert.doesNotThrow(() => JSON.stringify(preview));
    });
});
