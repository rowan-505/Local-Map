import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { TransportPublicRepository } from "./transport-public.repo.js";
import {
    buildNextStopsPreview,
    dedupePublicStopRouteServingRows,
    normalizePublicStopKind,
    serializePublicTransportStopDetail,
    serializePublicTransportTerminalDetail,
    TransportPublicService,
} from "./transport-public.service.js";
import { TransportRepository } from "./transport.repo.js";
import {
    classifyTransportStopLookupId,
    classifyTransportTerminalLookupId,
    derivePublicPreviewBadge,
    sqlCanonicalTransportStopExists,
    sqlCanonicalTransportTerminalExists,
    sqlPublicReleaseVisible,
    sqlPublicReleaseVisibleWithoutDeletedAt,
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
        if (Array.isArray(obj.strings)) {
            const strings = obj.strings as string[];
            const values = Array.isArray(obj.values) ? (obj.values as unknown[]) : [];
            let out = "";
            for (let i = 0; i < strings.length; i += 1) {
                out += strings[i] ?? "";
                if (i < values.length) {
                    out += extractSql(values[i]);
                }
            }
            return out;
        }
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

/** Expand Prisma `$queryRaw` tagged-template calls: (strings, ...values). */
function extractTaggedSql(stringsOrSql: unknown, values: unknown[]): string {
    if (Array.isArray(stringsOrSql)) {
        const strings = stringsOrSql as string[];
        let out = "";
        for (let i = 0; i < strings.length; i += 1) {
            out += strings[i] ?? "";
            if (i < values.length) {
                out += extractSql(values[i]);
            }
        }
        return out;
    }
    if (values.length === 0) {
        return extractSql(stringsOrSql);
    }
    return `${extractSql(stringsOrSql)} ${values.map((value) => extractSql(value)).join(" ")}`;
}

function createPublicMockPrisma(handlers: {
    listRows?: unknown[];
    listCount?: bigint;
    routeId?: { id: bigint; route_code: string } | null;
    variantRows?: Array<{ id: bigint; variant_code: string }>;
    stopRows?: unknown[];
    stopDetailRows?: unknown[];
    terminalDetailRows?: unknown[];
    routeServingRows?: unknown[];
    nextPreviewRows?: unknown[];
    fareRows?: unknown[];
}): { prisma: PrismaClient; executed: string[] } {
    const executed: string[] = [];
    const queryRaw: RawHandler = async (arg, ...rest) => {
        executed.push(extractTaggedSql(arg, rest));
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
        if (sql.includes("WITH serving AS") && sql.includes("anchor_stop_sequence")) {
            return handlers.nextPreviewRows ?? [];
        }
        if (sql.includes("r.origin_name") && sql.includes("rs.stop_id =")) {
            return handlers.routeServingRows ?? [];
        }
        if (sql.includes("FROM transport.route_stops rs") && sql.includes("stop_public_id")) {
            return handlers.stopRows ?? [];
        }
        if (sql.includes("FROM transport.fares")) {
            return handlers.fareRows ?? [];
        }
        if (sql.includes("rn_mm.name AS name_mm")) {
            return [{ name_mm: "မြန်မာ", name_en: "English", operator_name: "YBS" }];
        }
        if (sql.includes("FROM transport.route_paths")) {
            return [];
        }
        if (sql.includes("FROM transport.stops s") && sql.includes("route_count")) {
            return handlers.stopDetailRows ?? [];
        }
        if (sql.includes("FROM transport.terminals t") && sql.includes("linked_stop_id")) {
            return handlers.terminalDetailRows ?? [];
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
        if (sql.includes("FROM transport.routes r") && sql.includes("AS search_rank")) {
            return rows.map((row) => ({
                ...(row as Record<string, unknown>),
                search_rank: 0,
                total_count: count,
            }));
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

describe("sqlPublicReleaseVisibleWithoutDeletedAt", () => {
    it("filters review_status and is_active without deleted_at", () => {
        const sql = extractSql(sqlPublicReleaseVisibleWithoutDeletedAt("f"));
        assert.match(sql, /f\.review_status IN \('reviewed', 'verified'\)/);
        assert.match(sql, /f\.is_active = true/);
        assert.doesNotMatch(sql, /deleted_at/);
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

    it("does not reference fares.deleted_at when loading fares for public routes", async () => {
        const { prisma, executed } = createPublicMockPrisma({
            listRows: [
                {
                    route_code: "YBS-1",
                    name_mm: "၁",
                    name_en: "One",
                    operator_name: "YBS",
                },
            ],
            listCount: 1n,
            fareRows: [
                {
                    fare_type: "flat",
                    amount_min: 200,
                    amount_max: 200,
                    currency_code: "MMK",
                    note: null,
                },
            ],
        });
        const repo = new TransportPublicRepository(prisma);
        const result = await repo.listRoutes(publicListQuery);

        const fareSql = executed.filter((sql) => sql.includes("FROM transport.fares"));
        assert.ok(fareSql.length >= 1);
        for (const sql of fareSql) {
            assert.doesNotMatch(sql, /f\.deleted_at/);
            assert.match(sql, /f\.review_status IN \('reviewed', 'verified'\)/);
            assert.match(sql, /f\.is_active = true/);
            // Routes still use soft-delete visibility; fares must not.
            assert.match(sql, /r\.deleted_at IS NULL/);
        }
        assert.equal(result.items[0]?.fare?.amount_min, 200);
        assert.doesNotThrow(() => JSON.stringify(result));
    });

    it("returns public route list when a fare row exists", async () => {
        const { prisma } = createPublicMockPrisma({
            listRows: [
                {
                    route_code: "YBS-11",
                    name_mm: "၁၁",
                    name_en: "Eleven",
                    operator_name: "YBS",
                },
            ],
            listCount: 1n,
            fareRows: [
                {
                    fare_type: "flat",
                    amount_min: 300,
                    amount_max: 400,
                    currency_code: "MMK",
                    note: "approx",
                },
            ],
        });
        const repo = new TransportPublicRepository(prisma);
        const result = await repo.listRoutes(publicListQuery);

        assert.equal(result.total, 1);
        assert.equal(result.items.length, 1);
        assert.deepEqual(result.items[0]?.fare, {
            fare_type: "flat",
            amount_min: 300,
            amount_max: 400,
            currency_code: "MMK",
            note: "approx",
        });
    });

    it("returns public route list when no fare exists", async () => {
        const { prisma } = createPublicMockPrisma({
            listRows: [
                {
                    route_code: "YBS-2",
                    name_mm: "၂",
                    name_en: "Two",
                    operator_name: "YBS",
                },
            ],
            listCount: 1n,
            fareRows: [],
        });
        const repo = new TransportPublicRepository(prisma);
        const result = await repo.listRoutes(publicListQuery);

        assert.equal(result.total, 1);
        assert.equal(result.items[0]?.route_code, "YBS-2");
        assert.equal(result.items[0]?.fare, null);
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

    it("canonical stop lookup requires active non-deleted row only", () => {
        const sql = extractSql(sqlCanonicalTransportStopExists("s"));
        assert.match(sql, /s\.is_active = true/);
        assert.match(sql, /s\.deleted_at IS NULL/);
        assert.doesNotMatch(sql, /review_status/);
    });
});

describe("TransportPublicRepository.getPublicStopByLookupId", () => {
    it("returns null when no canonical stop matches", async () => {
        const { prisma } = createPublicMockPrisma({ stopDetailRows: [] });
        const repo = new TransportPublicRepository(prisma);
        const row = await repo.getPublicStopByLookupId("999");
        assert.equal(row, null);
    });

    it("returns needs_review stop by uuid public_id (tile contract)", async () => {
        const publicId = "e88a9fc6-6545-4e3c-8a23-6d69e4305056";
        const { prisma } = createPublicMockPrisma({
            stopDetailRows: [
                {
                    id: 99n,
                    public_id: publicId,
                    stop_code: null,
                    name_mm: "ကုန်ပဒေသာ",
                    name_en: "Tit Htate",
                    name_und: null,
                    canonical_name: "Sitepyoyay",
                    mode: "bus",
                    stop_type: "stop",
                    review_status: "needs_review",
                    confidence_score: 10,
                    admin_area_name: null,
                    longitude: 96.163928,
                    latitude: 16.781519,
                    route_count: 0n,
                },
            ],
        });
        const repo = new TransportPublicRepository(prisma);
        const row = await repo.getPublicStopByLookupId(publicId);

        assert.equal(row?.public_id, publicId);
        assert.equal(row?.review_status, "needs_review");
    });

    it("queries by numeric id and returns public-release stop row", async () => {
        const { prisma } = createPublicMockPrisma({
            stopDetailRows: [
                {
                    id: 42n,
                    public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    stop_code: "YBS-42",
                    name_mm: "ရပ်",
                    name_en: "Stop 42",
                    name_und: null,
                    canonical_name: "Stop 42",
                    mode: "bus",
                    stop_type: "bus_stop",
                    review_status: "verified",
                    confidence_score: 85,
                    admin_area_name: "Kyauktan",
                    longitude: 96.1,
                    latitude: 16.8,
                    route_count: 3n,
                },
            ],
        });
        const repo = new TransportPublicRepository(prisma);
        const row = await repo.getPublicStopByLookupId("42");

        assert.equal(row?.stop_code, "YBS-42");
        assert.equal(row?.route_count, 3n);
        assert.equal(row?.review_status, "verified");
    });

    it("queries by uuid public_id when lookup is not numeric", async () => {
        const publicId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        const { prisma } = createPublicMockPrisma({
            stopDetailRows: [
                {
                    id: 7n,
                    public_id: publicId,
                    stop_code: null,
                    name_mm: null,
                    name_en: "Terminal",
                    name_und: null,
                    canonical_name: "terminal osm:N:123",
                    mode: "bus",
                    stop_type: "bus_stop",
                    review_status: "reviewed",
                    confidence_score: null,
                    admin_area_name: null,
                    longitude: 96.2,
                    latitude: 16.9,
                    route_count: 0n,
                },
            ],
        });
        const repo = new TransportPublicRepository(prisma);
        const row = await repo.getPublicStopByLookupId(publicId);

        assert.equal(row?.public_id, publicId);
        assert.equal(row?.route_count, 0n);
    });
});

describe("TransportPublicRepository.listRoutesServingPublicStop", () => {
    it("returns route variants that include the stop", async () => {
        const { prisma } = createPublicMockPrisma({
            routeServingRows: [
                {
                    route_id: 10n,
                    route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    route_code: "YBS-9",
                    public_name: "Nine",
                    variant_id: 20n,
                    variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    variant_code: "YBS-9-A",
                    direction_name: "Outbound",
                    origin_name: "A",
                    destination_name: "B",
                    stop_sequence: 4,
                },
            ],
        });
        const repo = new TransportPublicRepository(prisma);
        const rows = await repo.listRoutesServingPublicStop(42n);

        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.route_code, "YBS-9");
        assert.equal(rows[0]?.stop_sequence, 4);
    });

    it("uses DISTINCT ON variant dedupe in SQL", async () => {
        const { prisma, executed } = createPublicMockPrisma({
            routeServingRows: [],
        });
        const repo = new TransportPublicRepository(prisma);
        await repo.listRoutesServingPublicStop(42n);

        const sql = executed.find((entry) => entry.includes("rs.stop_id ="));
        assert.ok(sql);
        assert.match(sql!, /DISTINCT ON \(v\.id\)/);
        assert.match(sql!, /ORDER BY serving\.route_code ASC/);
    });
});

describe("dedupePublicStopRouteServingRows", () => {
    const variantA = {
        route_id: 10n,
        route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        route_code: "YBS-9",
        public_name: "Nine",
        variant_id: 20n,
        variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        variant_code: "YBS-9-A",
        direction_name: "Outbound",
        origin_name: "A",
        destination_name: "B",
        stop_sequence: 4,
    };

    it("deduplicates duplicate variant rows and keeps the lowest stop_sequence", () => {
        const rows = dedupePublicStopRouteServingRows([
            { ...variantA, stop_sequence: 8 },
            { ...variantA, stop_sequence: 4 },
        ]);

        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.stop_sequence, 4);
    });

    it("sorts deterministically by route_code, variant_code, stop_sequence", () => {
        const rows = dedupePublicStopRouteServingRows([
            {
                ...variantA,
                route_code: "YBS-12",
                variant_code: "YBS-12-B",
                variant_public_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                variant_id: 22n,
                stop_sequence: 2,
            },
            {
                ...variantA,
                route_code: "YBS-9",
                variant_code: "YBS-9-B",
                variant_public_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                variant_id: 21n,
                stop_sequence: 3,
            },
            { ...variantA },
        ]);

        assert.deepEqual(
            rows.map((row) => `${row.route_code}:${row.variant_code}:${row.stop_sequence}`),
            ["YBS-12:YBS-12-B:2", "YBS-9:YBS-9-A:4", "YBS-9:YBS-9-B:3"],
        );
    });
});

describe("TransportPublicRepository.listNextStopsPreviewForPublicStop", () => {
    it("returns ranked downstream stops per variant", async () => {
        const { prisma } = createPublicMockPrisma({
            nextPreviewRows: [
                {
                    route_id: 10n,
                    route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    route_code: "YBS-9",
                    public_name: "Nine",
                    variant_id: 20n,
                    variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    variant_code: "YBS-9-A",
                    direction_name: "Outbound",
                    destination_name: "Hledan",
                    anchor_stop_sequence: 4,
                    stop_sequence: 5,
                    stop_id: 51n,
                    stop_public_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                    name_mm: "Next",
                    name_en: "Next",
                    longitude: 96.11,
                    latitude: 16.81,
                },
            ],
        });
        const repo = new TransportPublicRepository(prisma);
        const rows = await repo.listNextStopsPreviewForPublicStop(42n);

        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.stop_sequence, 5);
        assert.equal(rows[0]?.anchor_stop_sequence, 4);
    });

    it("limits preview to three downstream stops per variant in SQL", async () => {
        const { prisma, executed } = createPublicMockPrisma({
            nextPreviewRows: [],
        });
        const repo = new TransportPublicRepository(prisma);
        await repo.listNextStopsPreviewForPublicStop(42n);

        const sql = executed.find((entry) => entry.includes("WITH serving AS"));
        assert.ok(sql);
        assert.match(sql!, /WHERE rn <=/);
        assert.match(sql!, /DISTINCT ON \(rs\.route_variant_id\)/);
    });
});

describe("buildNextStopsPreview", () => {
    const servingRoute = {
        route_id: 10n,
        route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        route_code: "YBS-9",
        public_name: "Nine",
        variant_id: 20n,
        variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        variant_code: "YBS-9-A",
        direction_name: "Outbound",
        origin_name: "A",
        destination_name: "Hledan",
        stop_sequence: 4,
    };

    it("returns empty next_stops for terminal variants on the route", () => {
        const preview = buildNextStopsPreview([servingRoute], []);

        assert.equal(preview.length, 1);
        assert.deepEqual(preview[0]?.next_stops, []);
        assert.deepEqual(preview[0]?.stops, []);
        assert.equal(preview[0]?.current_stop_sequence, 4);
        assert.equal(preview[0]?.public_name, "Nine");
        assert.equal(preview[0]?.destination_name, "Hledan");
    });

    it("orders downstream stops by stop_sequence and maps display_name", () => {
        const preview = buildNextStopsPreview(
            [servingRoute],
            [6, 5].map((stopSequence) => ({
                route_id: 10n,
                route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                route_code: "YBS-9",
                public_name: "Nine",
                variant_id: 20n,
                variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                variant_code: "YBS-9-A",
                direction_name: "Outbound",
                destination_name: "Hledan",
                anchor_stop_sequence: 4,
                stop_sequence: stopSequence,
                stop_id: BigInt(50 + stopSequence),
                stop_public_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                name_mm: `Stop ${stopSequence}`,
                name_en: `Stop ${stopSequence}`,
                longitude: 96.1,
                latitude: 16.8,
            })),
        );

        assert.equal(preview[0]?.next_stops.length, 2);
        assert.deepEqual(
            preview[0]?.next_stops.map((stop) => stop.stop_sequence),
            [5, 6],
        );
        assert.equal(preview[0]?.next_stops[0]?.display_name, "Stop 5");
        assert.equal(preview[0]?.next_stops[0]?.name, "Stop 5");
    });
});

describe("serializePublicTransportStopDetail", () => {
    it("normalizes stop kind and groups next-stop preview", () => {
        const detail = serializePublicTransportStopDetail(
            {
                id: 42n,
                public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                stop_code: "YBS-42",
                name_mm: "ရပ်",
                name_en: "Stop 42",
                name_und: null,
                canonical_name: "Stop 42",
                mode: "bus",
                stop_type: "bus_station",
                review_status: "verified",
                confidence_score: 85,
                admin_area_name: "Kyauktan",
                longitude: 96.1,
                latitude: 16.8,
                route_count: 1n,
            },
            [
                {
                    route_id: 10n,
                    route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    route_code: "YBS-9",
                    public_name: "Nine",
                    variant_id: 20n,
                    variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    variant_code: "YBS-9-A",
                    direction_name: "Outbound",
                    origin_name: "A",
                    destination_name: "B",
                    stop_sequence: 4,
                },
            ],
            [
                {
                    route_id: 10n,
                    route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    route_code: "YBS-9",
                    public_name: "Nine",
                    variant_id: 20n,
                    variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    variant_code: "YBS-9-A",
                    direction_name: "Outbound",
                    destination_name: "Hledan",
                    anchor_stop_sequence: 4,
                    stop_sequence: 5,
                    stop_id: 51n,
                    stop_public_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                    name_mm: "Next",
                    name_en: "Next",
                    longitude: 96.11,
                    latitude: 16.81,
                },
            ],
        );

        assert.equal(detail.stop_type, "station");
        assert.equal(detail.verification_status, "verified");
        assert.equal(detail.routes_serving_this_stop.length, 1);
        assert.equal(detail.next_stops_preview.length, 1);
        assert.equal(detail.next_stops_preview[0]?.current_stop_sequence, 4);
        assert.equal(detail.next_stops_preview[0]?.next_stops.length, 1);
        assert.equal(detail.next_stops_preview[0]?.next_stops[0]?.display_name, "Next");
        assert.deepEqual(detail.coordinates, [96.1, 16.8]);
    });

    it("prefers English display when lang=en and ignores poor canonical cache", () => {
        const detail = serializePublicTransportStopDetail(
            {
                id: 1n,
                public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                stop_code: null,
                name_mm: "ထမနီကုမ္ဘေး",
                name_en: "Htamanikome",
                name_und: null,
                canonical_name: "Htamanikomehtate",
                mode: "bus",
                stop_type: "bus_stop",
                review_status: "needs_review",
                confidence_score: 10,
                admin_area_name: null,
                longitude: 96.1,
                latitude: 16.8,
                route_count: 0n,
            },
            [],
            [],
            { lang: "en" },
        );

        assert.equal(detail.display_name, "Htamanikome");
        assert.equal(detail.name_en, "Htamanikome");
        assert.equal(detail.name_my, "ထမနီကုမ္ဘေး");
        assert.equal(detail.canonical_name, "Htamanikomehtate");
    });

    it("uses Myanmar canonical cache for name_my when stop_names my row is missing", () => {
        const detail = serializePublicTransportStopDetail(
            {
                id: 322n,
                public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                stop_code: null,
                name_mm: null,
                name_en: "Yay Leone Kyauk Tan pagoda",
                name_und: null,
                canonical_name: "ရေလည်ကျောက်တန်းဘုရား",
                mode: "bus",
                stop_type: "bus_stop",
                review_status: "needs_review",
                confidence_score: 10,
                admin_area_name: null,
                longitude: 96.1,
                latitude: 16.8,
                route_count: 0n,
            },
            [],
            [],
            { lang: "my" },
        );

        assert.equal(detail.name_my, "ရေလည်ကျောက်တန်းဘုရား");
        assert.equal(detail.display_name, "ရေလည်ကျောက်တန်းဘုရား");
        assert.equal(detail.name_en, "Yay Leone Kyauk Tan pagoda");
    });

    it("maps ferry_terminal to terminal stop kind", () => {
        assert.equal(normalizePublicStopKind("ferry_terminal"), "terminal");
        assert.equal(normalizePublicStopKind("bus_stop"), "bus_stop");
    });

    it("returns an empty routes_serving_this_stop array when no routes serve the stop", () => {
        const detail = serializePublicTransportStopDetail(
            {
                id: 42n,
                public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                stop_code: null,
                name_mm: null,
                name_en: "Lonely Stop",
                name_und: null,
                canonical_name: "Lonely Stop",
                mode: "bus",
                stop_type: "bus_stop",
                review_status: "reviewed",
                confidence_score: null,
                admin_area_name: null,
                longitude: 96.1,
                latitude: 16.8,
                route_count: 0n,
            },
            [],
            [],
        );

        assert.deepEqual(detail.routes_serving_this_stop, []);
        assert.equal(detail.route_count, 0);
    });

    it("maps compact route serving fields for the detail panel", () => {
        const detail = serializePublicTransportStopDetail(
            {
                id: 42n,
                public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                stop_code: null,
                name_mm: null,
                name_en: "Stop",
                name_und: null,
                canonical_name: "Stop",
                mode: "bus",
                stop_type: "bus_stop",
                review_status: "reviewed",
                confidence_score: null,
                admin_area_name: null,
                longitude: 96.1,
                latitude: 16.8,
                route_count: 1n,
            },
            [
                {
                    route_id: 10n,
                    route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    route_code: "YBS-9",
                    public_name: "Nine",
                    variant_id: 20n,
                    variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    variant_code: "YBS-9-A",
                    direction_name: "Outbound",
                    origin_name: "Aung San",
                    destination_name: "Hledan",
                    stop_sequence: 4,
                },
            ],
            [],
        );

        assert.deepEqual(detail.routes_serving_this_stop[0], {
            route_id: "10",
            route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            route_code: "YBS-9",
            public_name: "Nine",
            variant_id: "20",
            variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            variant_code: "YBS-9-A",
            direction_name: "Outbound",
            origin_name: "Aung San",
            destination_name: "Hledan",
            stop_sequence: 4,
        });
    });
});

describe("classifyTransportStopLookupId", () => {
    it("classifies a numeric string as an id lookup", () => {
        const result = classifyTransportStopLookupId("19370");
        assert.deepEqual(result, { kind: "numeric", id: 19370n });
    });

    it("classifies a uuid string as a public_id lookup", () => {
        const result = classifyTransportStopLookupId(
            "b441f97a-3a4b-43cb-8a16-1ce88869a1aa",
        );
        assert.deepEqual(result, {
            kind: "uuid",
            publicId: "b441f97a-3a4b-43cb-8a16-1ce88869a1aa",
        });
    });

    it("classifies a non-numeric, non-uuid string as invalid", () => {
        assert.deepEqual(classifyTransportStopLookupId("not-a-valid-uuid"), {
            kind: "invalid",
        });
    });

    it("trims surrounding whitespace before classifying", () => {
        assert.deepEqual(classifyTransportStopLookupId("  8441  "), {
            kind: "numeric",
            id: 8441n,
        });
    });
});

describe("TransportPublicRepository.getPublicStopByLookupId", () => {
    const stopRow = {
        id: 42n,
        public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        stop_code: "YBS-42",
        name_mm: "ရပ်",
        name_en: "Stop 42",
        name_und: null,
        canonical_name: "Stop 42",
        mode: "bus",
        stop_type: "bus_stop",
        review_status: "reviewed",
        confidence_score: 70,
        admin_area_name: "Kyauktan",
        longitude: 96.1,
        latitude: 16.8,
        route_count: 0n,
    };

    // Column selection (numeric → s.id, uuid → s.public_id) is proven by the
    // classifyTransportStopLookupId unit tests above; these assert repo behavior.
    it("resolves a canonical stop for a numeric id", async () => {
        const { prisma, executed } = createPublicMockPrisma({ stopDetailRows: [stopRow] });
        const repo = new TransportPublicRepository(prisma);

        const row = await repo.getPublicStopByLookupId("42");

        assert.ok(row);
        assert.equal(row?.id, 42n);
        assert.ok(
            executed.some(
                (sql) => sql.includes("FROM transport.stops s") && sql.includes("route_count"),
            ),
        );
    });

    it("resolves a canonical stop for a uuid public_id", async () => {
        const { prisma, executed } = createPublicMockPrisma({ stopDetailRows: [stopRow] });
        const repo = new TransportPublicRepository(prisma);

        const row = await repo.getPublicStopByLookupId(
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        );

        assert.ok(row);
        assert.ok(
            executed.some(
                (sql) => sql.includes("FROM transport.stops s") && sql.includes("route_count"),
            ),
        );
    });

    it("returns null for an invalid id without querying the database", async () => {
        const { prisma, executed } = createPublicMockPrisma({ stopDetailRows: [stopRow] });
        const repo = new TransportPublicRepository(prisma);

        const row = await repo.getPublicStopByLookupId("not-a-valid-uuid");

        assert.equal(row, null);
        assert.equal(executed.length, 0);
    });

    it("returns null when a valid numeric id matches no canonical stop", async () => {
        const { prisma } = createPublicMockPrisma({ stopDetailRows: [] });
        const repo = new TransportPublicRepository(prisma);

        const row = await repo.getPublicStopByLookupId("999");

        assert.equal(row, null);
    });
});

describe("TransportPublicService.getPublicStopDetail", () => {
    it("returns null when canonical stop does not exist", async () => {
        const { prisma } = createPublicMockPrisma({ stopDetailRows: [] });
        const service = new TransportPublicService(prisma);
        const detail = await service.getPublicStopDetail("999");
        assert.equal(detail, null);
    });

    it("returns null for an invalid lookup id (no guessing)", async () => {
        const { prisma } = createPublicMockPrisma({ stopDetailRows: [] });
        const service = new TransportPublicService(prisma);
        const detail = await service.getPublicStopDetail("not-a-valid-uuid");
        assert.equal(detail, null);
    });

    it("bundles routes and next-stop preview for a visible stop", async () => {
        const { prisma } = createPublicMockPrisma({
            stopDetailRows: [
                {
                    id: 42n,
                    public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    stop_code: "YBS-42",
                    name_mm: "ရပ်",
                    name_en: "Stop 42",
                    name_und: null,
                    canonical_name: "Stop 42",
                    mode: "bus",
                    stop_type: "bus_stop",
                    review_status: "reviewed",
                    confidence_score: 70,
                    admin_area_name: "Kyauktan",
                    longitude: 96.1,
                    latitude: 16.8,
                    route_count: 1n,
                },
            ],
            routeServingRows: [
                {
                    route_id: 10n,
                    route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    route_code: "YBS-9",
                    public_name: "Nine",
                    variant_id: 20n,
                    variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    variant_code: "YBS-9-A",
                    direction_name: "Outbound",
                    origin_name: "A",
                    destination_name: "B",
                    stop_sequence: 4,
                },
            ],
            nextPreviewRows: [],
        });
        const service = new TransportPublicService(prisma);
        const detail = await service.getPublicStopDetail("42");

        assert.ok(detail);
        assert.equal(detail?.routes_serving_this_stop.length, 1);
        assert.equal(detail?.next_stops_preview.length, 1);
        assert.deepEqual(detail?.next_stops_preview[0]?.next_stops, []);
        assert.equal(detail?.status_label, "Reviewed");
    });
});

describe("sqlCanonicalTransportTerminalExists", () => {
    it("requires active non-deleted terminal rows without review_status gate", () => {
        const sql = extractSql(sqlCanonicalTransportTerminalExists("t"));
        assert.match(sql, /t\.is_active = true/);
        assert.match(sql, /t\.deleted_at IS NULL/);
        assert.doesNotMatch(sql, /review_status/);
    });
});

describe("classifyTransportTerminalLookupId", () => {
    it("matches stop lookup contract for numeric and uuid ids", () => {
        assert.deepEqual(classifyTransportTerminalLookupId("12"), {
            kind: "numeric",
            id: 12n,
        });
        assert.deepEqual(
            classifyTransportTerminalLookupId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
            {
                kind: "uuid",
                publicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            },
        );
    });
});

describe("TransportPublicRepository.getPublicTerminalByLookupId", () => {
    it("returns null for invalid lookup ids without querying", async () => {
        const { prisma, executed } = createPublicMockPrisma({ terminalDetailRows: [] });
        const repo = new TransportPublicRepository(prisma);
        const row = await repo.getPublicTerminalByLookupId("not-a-valid-uuid");
        assert.equal(row, null);
        assert.equal(executed.length, 0);
    });

    it("returns terminal row by numeric id", async () => {
        const { prisma } = createPublicMockPrisma({
            terminalDetailRows: [
                {
                    id: 5n,
                    public_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                    terminal_code: "AYT-1",
                    name: "Aung Mingalar",
                    name_mm: "အောင်မင်္ဂလာ",
                    name_en: "Aung Mingalar",
                    mode: "bus",
                    terminal_role: "station",
                    review_status: "verified",
                    confidence_score: 90,
                    admin_area_name: "Yangon",
                    longitude: 96.15,
                    latitude: 16.9,
                    linked_stop_id: 42n,
                    route_count: 2n,
                },
            ],
        });
        const repo = new TransportPublicRepository(prisma);
        const row = await repo.getPublicTerminalByLookupId("5");

        assert.equal(row?.terminal_code, "AYT-1");
        assert.equal(row?.linked_stop_id, 42n);
        assert.equal(row?.route_count, 2n);
    });
});

describe("serializePublicTransportTerminalDetail", () => {
    it("maps terminal fields and linked-stop routes without geometry", () => {
        const detail = serializePublicTransportTerminalDetail(
            {
                id: 5n,
                public_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                terminal_code: "AYT-1",
                name: "Aung Mingalar",
                name_mm: "အောင်မင်္ဂလာ",
                name_en: "Aung Mingalar",
                mode: "bus",
                terminal_role: "station",
                review_status: "verified",
                confidence_score: 90,
                admin_area_name: "Yangon",
                longitude: 96.15,
                latitude: 16.9,
                linked_stop_id: 42n,
                route_count: 1n,
            },
            [
                {
                    route_id: 10n,
                    route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    route_code: "YBS-9",
                    public_name: "Nine",
                    variant_id: 20n,
                    variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    variant_code: "YBS-9-A",
                    direction_name: "Outbound",
                    origin_name: "A",
                    destination_name: "B",
                    stop_sequence: 1,
                },
            ],
            { lang: "my" },
        );

        assert.equal(detail.entity_type, "terminal");
        assert.equal(detail.terminal_role, "station");
        assert.equal(detail.name_my, "အောင်မင်္ဂလာ");
        assert.equal(detail.routes_serving_this_stop.length, 1);
        assert.equal(detail.isVerified, true);
    });
});

describe("TransportPublicService.getPublicTerminalDetail", () => {
    it("returns null when terminal does not exist", async () => {
        const { prisma } = createPublicMockPrisma({ terminalDetailRows: [] });
        const service = new TransportPublicService(prisma);
        const detail = await service.getPublicTerminalDetail("999");
        assert.equal(detail, null);
    });

    it("loads routes from linked stop when present", async () => {
        const { prisma } = createPublicMockPrisma({
            terminalDetailRows: [
                {
                    id: 5n,
                    public_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                    terminal_code: "AYT-1",
                    name: "Aung Mingalar",
                    name_mm: "အောင်မင်္ဂလာ",
                    name_en: "Aung Mingalar",
                    mode: "bus",
                    terminal_role: "station",
                    review_status: "reviewed",
                    confidence_score: 80,
                    admin_area_name: "Yangon",
                    longitude: 96.15,
                    latitude: 16.9,
                    linked_stop_id: 42n,
                    route_count: 1n,
                },
            ],
            routeServingRows: [
                {
                    route_id: 10n,
                    route_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    route_code: "YBS-9",
                    public_name: "Nine",
                    variant_id: 20n,
                    variant_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    variant_code: "YBS-9-A",
                    direction_name: "Outbound",
                    origin_name: "A",
                    destination_name: "B",
                    stop_sequence: 1,
                },
            ],
        });
        const service = new TransportPublicService(prisma);
        const detail = await service.getPublicTerminalDetail("5");

        assert.ok(detail);
        assert.equal(detail?.entity_type, "terminal");
        assert.equal(detail?.routes_serving_this_stop.length, 1);
    });

    it("returns empty routes when terminal has no linked stop", async () => {
        const { prisma } = createPublicMockPrisma({
            terminalDetailRows: [
                {
                    id: 6n,
                    public_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                    terminal_code: null,
                    name: "Ferry Port",
                    name_mm: null,
                    name_en: "Ferry Port",
                    mode: "ferry",
                    terminal_role: "port",
                    review_status: "reviewed",
                    confidence_score: null,
                    admin_area_name: null,
                    longitude: 96.2,
                    latitude: 16.8,
                    linked_stop_id: null,
                    route_count: 0n,
                },
            ],
        });
        const service = new TransportPublicService(prisma);
        const detail = await service.getPublicTerminalDetail("6");

        assert.ok(detail);
        assert.deepEqual(detail?.routes_serving_this_stop, []);
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
