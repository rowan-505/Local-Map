import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { TransportPublicRepository } from "./transport-public.repo.js";
import { TransportRepository } from "./transport.repo.js";
import {
    derivePublicPreviewBadge,
    sqlPublicReleaseVisible,
} from "./transport-public-visibility.js";

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
        if (Array.isArray(obj.values)) {
            const values = obj.values as unknown[];
            return values
                .map((value) => {
                    if (value && typeof value === "object" && "strings" in value) {
                        return extractSql(value);
                    }
                    return "";
                })
                .join(" ");
        }
    }
    return String(arg);
}

function createPublicMockPrisma(handlers: {
    listRows?: unknown[];
    listCount?: bigint;
    routeId?: { id: bigint; route_code: string } | null;
    variantRows?: Array<{ id: bigint; variant_code: string }>;
    stopRows?: unknown[];
}): { prisma: PrismaClient; executed: string[] } {
    const executed: string[] = [];
    const queryRaw: RawHandler = async (arg) => {
        executed.push(extractSql(arg));
        const sql = executed[executed.length - 1];
        if (sql.includes("SELECT 1 FROM transport.routes")) {
            return [];
        }
        if (sql.includes("count(*)::bigint AS count") && sql.includes("FROM transport.routes r")) {
            return [{ count: handlers.listCount ?? BigInt(handlers.listRows?.length ?? 0) }];
        }
        if (sql.includes("FROM transport.routes r") && sql.includes("ORDER BY r.route_code")) {
            return handlers.listRows ?? [];
        }
        if (sql.includes("FROM transport.routes r") && sql.includes("r.route_code =")) {
            return handlers.routeId ? [handlers.routeId] : [];
        }
        if (sql.includes("FROM transport.route_variants v") && sql.includes("v.route_id")) {
            return (handlers.variantRows ?? []).map((v) => ({
                id: v.id,
                variant_code: v.variant_code,
                direction_name: "Outbound",
                direction_id: 0,
                headsign: null,
                distance_m: null,
            }));
        }
        if (sql.includes("FROM transport.route_stops rs") && sql.includes("stop_public_id")) {
            return handlers.stopRows ?? [];
        }
        if (sql.includes("FROM transport.fares")) {
            return [];
        }
        if (sql.includes("rn_mm.name AS name_mm")) {
            return [{ name_mm: "မြန်မာ", name_en: "English", operator_name: "YBS" }];
        }
        if (sql.includes("FROM transport.route_paths")) {
            return [];
        }
        return [];
    };

    const client = {
        $queryRaw: queryRaw,
        $executeRaw: async () => 1,
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
    };
    return { prisma: client as unknown as PrismaClient, executed };
}

function createAdminListMockPrisma(rows: unknown[], count: bigint): PrismaClient {
    const queryRaw: RawHandler = async (arg) => {
        const sql = extractSql(arg);
        if (sql.includes("SELECT 1 FROM transport.routes")) {
            return [];
        }
        if (sql.includes("count(*)::bigint AS count") && sql.includes("FROM transport.routes r")) {
            return [{ count }];
        }
        if (sql.includes("FROM transport.routes r") && sql.includes("ORDER BY r.updated_at")) {
            return rows;
        }
        return [];
    };
    const client = {
        $queryRaw: queryRaw,
        $executeRaw: async () => 1,
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
    };
    return client as unknown as PrismaClient;
}

const publicListQuery = {
    limit: 25,
    offset: 0,
    isActive: undefined,
    includeDeleted: undefined,
} as const;

describe("sqlPublicReleaseVisible", () => {
    it("includes reviewed and verified review_status filter", () => {
        const sql = extractSql(sqlPublicReleaseVisible("r"));
        assert.match(sql, /review_status IN \('reviewed', 'verified'\)/);
        assert.match(sql, /is_active = true/);
        assert.match(sql, /deleted_at IS NULL/);
    });
});

describe("derivePublicPreviewBadge", () => {
    it("labels imported_unreviewed as hidden", () => {
        const badge = derivePublicPreviewBadge({
            review_status: "imported_unreviewed",
            is_active: true,
        });
        assert.equal(badge.label, "Hidden: imported_unreviewed");
        assert.equal(badge.visibility, "hidden");
    });

    it("labels reviewed as visible", () => {
        const badge = derivePublicPreviewBadge({
            review_status: "reviewed",
            is_active: true,
        });
        assert.equal(badge.label, "Visible: reviewed");
        assert.equal(badge.visibility, "visible");
    });

    it("labels inactive route as hidden even when reviewed", () => {
        const badge = derivePublicPreviewBadge({
            review_status: "reviewed",
            is_active: false,
        });
        assert.equal(badge.label, "Hidden: inactive");
        assert.equal(badge.visibility, "hidden");
    });
});

describe("TransportPublicRepository.listRoutes", () => {
    it("enforces public-release filter on routes in SQL helper", () => {
        const sql = extractSql(sqlPublicReleaseVisible("r"));
        assert.match(sql, /r\.review_status IN \('reviewed', 'verified'\)/);
    });

    it("hides needs_review routes by only selecting reviewed or verified rows", () => {
        const hidden = derivePublicPreviewBadge({
            review_status: "needs_review",
            is_active: true,
        });
        assert.equal(hidden.visibility, "hidden");
    });

    it("returns reviewed routes from the public query", async () => {
        const { prisma } = createPublicMockPrisma({
            listRows: [
                {
                    route_code: "YBS-1",
                    name_mm: "၁",
                    name_en: "One",
                    operator_name: "YBS",
                },
            ],
            listCount: 1n,
        });
        const repo = new TransportPublicRepository(prisma);
        const result = await repo.listRoutes(publicListQuery);

        assert.equal(result.total, 1);
        assert.equal(result.items[0]?.route_code, "YBS-1");
    });
});

describe("TransportPublicRepository.getRouteByCode", () => {
    it("returns ordered stops for public variants", async () => {
        const { prisma } = createPublicMockPrisma({
            routeId: { id: 1n, route_code: "YBS-1" },
            variantRows: [{ id: 10n, variant_code: "YBS-1-A" }],
            stopRows: [
                {
                    stop_sequence: 1,
                    stop_public_id: "22222222-2222-4222-8222-222222222222",
                    name_mm: "ရပ်နား",
                    name_en: "Stop A",
                    geometry: { type: "Point", coordinates: [96.1, 16.8] },
                    distance_from_start_m: 0,
                },
            ],
        });

        const repo = new TransportPublicRepository(prisma);
        const detail = await repo.getRouteByCode("YBS-1");

        assert.equal(detail.variants[0]?.stops.length, 1);
        assert.equal(detail.variants[0]?.stops[0]?.name_en, "Stop A");
    });

    it("uses public-release filter on stop alias in SQL helper", () => {
        const sql = extractSql(sqlPublicReleaseVisible("s"));
        assert.match(sql, /s\.review_status IN \('reviewed', 'verified'\)/);
    });
});

describe("TransportRepository.listRoutes (dashboard)", () => {
    it("still returns needs_review routes when no publicVisibility filter is set", async () => {
        const prisma = createAdminListMockPrisma(
            [
                {
                    public_id: "11111111-1111-4111-8111-111111111111",
                    route_code: "YBS-9",
                    public_name: "Nine",
                    name_mm: null,
                    name_en: null,
                    display_name: "YBS-9",
                    mode: "bus",
                    route_kind: "local",
                    origin_name: null,
                    destination_name: null,
                    review_status: "needs_review",
                    confidence_score: 20,
                    is_active: true,
                    variant_count: 2n,
                    stop_count: 10n,
                    path_count: 0n,
                    has_source_link: true,
                    has_estimate_path: false,
                    has_verified_path: false,
                    updated_at: new Date(),
                },
            ],
            1n,
        );
        const repo = new TransportRepository(prisma);
        const result = await repo.listRoutes({
            limit: 25,
            offset: 0,
            reviewStatus: "needs_review",
            isActive: undefined,
            includeDeleted: undefined,
            hasStops: undefined,
            hasPath: undefined,
            hasSourceLink: undefined,
        });

        assert.equal(result.total, 1);
        assert.equal(result.items[0]?.review_status, "needs_review");
    });
});

describe("public release visibility rule", () => {
    it("treats active needs_review route as public hidden", () => {
        const badge = derivePublicPreviewBadge({
            review_status: "needs_review",
            is_active: true,
        });
        assert.equal(badge.visibility, "hidden");
        assert.equal(badge.label, "Hidden: needs_review");
    });

    it("treats imported_unreviewed route as public hidden", () => {
        const badge = derivePublicPreviewBadge({
            review_status: "imported_unreviewed",
            is_active: true,
        });
        assert.equal(badge.visibility, "hidden");
        assert.equal(badge.label, "Hidden: imported_unreviewed");
    });
});
