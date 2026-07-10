import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnifiedSearchRow } from "./public-map.repo.js";
import {
    assertPublicSearchCursorMatchesRequest,
    compareUnifiedSearchSortKeys,
    decodePublicSearchCursor,
    encodePublicSearchCursor,
    InvalidPublicSearchCursorError,
    isUnifiedSearchRowAfterCursor,
    normalizePublicSearchCursorContext,
    PUBLIC_SEARCH_CURSOR_VERSION,
    publicSearchCursorAfterFromRow,
} from "./public-search-cursor.js";
import { buildPublicSearchPage, serializePublicSearchHit } from "./public-map.service.js";
import { resolvePublicSearchFilters } from "./public-search-filters.js";

const SEARCH_CTX = normalizePublicSearchCursorContext({
    q: "yangon",
    mode: "full",
    types: ["place", "transport_stop"],
    category: "all",
    transportType: "all",
    transportMode: "all",
    lang: "en",
});

function makeRow(overrides: Partial<UnifiedSearchRow> = {}): UnifiedSearchRow {
    return {
        entity_type: "place",
        entity_id: "1",
        public_id: "11111111-1111-1111-1111-111111111111",
        display_name: "Alpha",
        subtitle: null,
        primary_name_my: null,
        primary_name_en: "Alpha",
        primary_name_und: null,
        matched_name: null,
        geometry_type: "POINT",
        lng: 96.1,
        lat: 16.8,
        min_lng: null,
        min_lat: null,
        max_lng: null,
        max_lat: null,
        has_geometry: true,
        category_code: null,
        category_name_my: null,
        category_name_en: null,
        admin_area_name_my: null,
        admin_area_name_en: null,
        score: 100,
        importance_score: 10,
        is_verified: false,
        confidence_score: 0,
        boundary_confidence_score: 0,
        address_parts: null,
        ...overrides,
    };
}

describe("public search cursor codec", () => {
    it("round-trips an opaque cursor payload", () => {
        const payload = {
            v: PUBLIC_SEARCH_CURSOR_VERSION,
            ctx: SEARCH_CTX,
            after: {
                score: 88.5,
                importanceScore: 12,
                displayName: "Route A",
                entityType: "transport_route",
                entityId: "42",
            },
        };
        const encoded = encodePublicSearchCursor(payload);
        assert.match(encoded, /^[A-Za-z0-9_-]+$/);
        assert.equal(decodePublicSearchCursor(encoded).after.entityId, "42");
    });

    it("rejects invalid cursor strings", () => {
        assert.throws(() => decodePublicSearchCursor("not-valid-base64!!!"), InvalidPublicSearchCursorError);
        assert.throws(
            () =>
                decodePublicSearchCursor(
                    encodePublicSearchCursor({
                        v: 99 as never,
                        ctx: SEARCH_CTX,
                        after: publicSearchCursorAfterFromRow(makeRow()),
                    }),
                ),
            InvalidPublicSearchCursorError,
        );
    });

    it("rejects cursor when query context does not match", () => {
        const cursor = encodePublicSearchCursor({
            v: PUBLIC_SEARCH_CURSOR_VERSION,
            ctx: SEARCH_CTX,
            after: publicSearchCursorAfterFromRow(makeRow()),
        });
        const decoded = decodePublicSearchCursor(cursor);
        const otherCtx = normalizePublicSearchCursorContext({
            q: "mandalay",
            mode: "full",
            types: SEARCH_CTX.types,
        });
        assert.throws(
            () => assertPublicSearchCursorMatchesRequest(decoded.ctx, otherCtx),
            /does not match query/,
        );
    });

    it("rejects cursor when type filter does not match", () => {
        const cursor = encodePublicSearchCursor({
            v: PUBLIC_SEARCH_CURSOR_VERSION,
            ctx: SEARCH_CTX,
            after: publicSearchCursorAfterFromRow(makeRow()),
        });
        const decoded = decodePublicSearchCursor(cursor);
        const otherCtx = normalizePublicSearchCursorContext({
            q: "yangon",
            mode: "full",
            types: ["place"],
        });
        assert.throws(
            () => assertPublicSearchCursorMatchesRequest(decoded.ctx, otherCtx),
            /type filter/,
        );
    });
});

describe("unified search stable ordering", () => {
    it("uses entity_type and entity_id as final tie-breakers", () => {
        const a = publicSearchCursorAfterFromRow(
            makeRow({ entity_type: "place", entity_id: "2", display_name: "Same" }),
        );
        const b = publicSearchCursorAfterFromRow(
            makeRow({ entity_type: "transport_stop", entity_id: "1", display_name: "Same" }),
        );
        assert.ok(compareUnifiedSearchSortKeys(a, b) < 0);
        assert.ok(isUnifiedSearchRowAfterCursor(b, a));
        assert.equal(isUnifiedSearchRowAfterCursor(a, b), false);
    });

    it("breaks exact score ties by display_name ascending", () => {
        const earlier = publicSearchCursorAfterFromRow(
            makeRow({ display_name: "Alpha", entity_id: "10", score: 50, importance_score: 5 }),
        );
        const later = publicSearchCursorAfterFromRow(
            makeRow({ display_name: "Beta", entity_id: "11", score: 50, importance_score: 5 }),
        );
        assert.ok(compareUnifiedSearchSortKeys(earlier, later) < 0);
        assert.ok(isUnifiedSearchRowAfterCursor(later, earlier));
    });

    it("orders null scores as normalized zero scores with the usual tie-breakers", () => {
        const earlier = publicSearchCursorAfterFromRow(
            makeRow({ entity_type: "admin_area", entity_id: "10", display_name: "Same", score: null, importance_score: 5 }),
        );
        const later = publicSearchCursorAfterFromRow(
            makeRow({ entity_type: "place", entity_id: "11", display_name: "Same", score: 0, importance_score: 5 }),
        );

        assert.equal(earlier.score, 0);
        assert.equal(later.score, 0);
        assert.ok(compareUnifiedSearchSortKeys(earlier, later) < 0);
        assert.ok(isUnifiedSearchRowAfterCursor(later, earlier));
    });
});

describe("buildPublicSearchPage", () => {
    it("returns the first page with nextCursor when more rows exist", () => {
        const rows = [
            makeRow({ entity_id: "1", display_name: "One" }),
            makeRow({ entity_id: "2", display_name: "Two" }),
            makeRow({ entity_id: "3", display_name: "Three" }),
        ];
        const page = buildPublicSearchPage(rows, 2, SEARCH_CTX);

        assert.equal(page.items.length, 2);
        assert.equal(page.hasMore, true);
        assert.ok(page.nextCursor);
        const decoded = decodePublicSearchCursor(page.nextCursor);
        assert.equal(decoded.after.entityId, "2");
        assert.deepEqual(decoded.ctx.types, SEARCH_CTX.types);
    });

    it("normalizes a null boundary score into a valid numeric cursor and response score", () => {
        const rows = [
            makeRow({ entity_id: "1", display_name: "One", score: 1 }),
            makeRow({ entity_id: "2", display_name: "Null score", score: null }),
            makeRow({ entity_id: "3", display_name: "After null score", score: null }),
        ];

        const page = buildPublicSearchPage(rows, 2, SEARCH_CTX);

        assert.equal(page.items.length, 2);
        assert.ok(page.nextCursor);
        assert.equal(page.items[1]?.score, 0);

        const decoded = decodePublicSearchCursor(page.nextCursor);
        assert.equal(decoded.after.entityId, "2");
        assert.equal(decoded.after.score, 0);
    });

    it("returns the final page without nextCursor", () => {
        const rows = [makeRow({ entity_id: "9", display_name: "Last" })];
        const page = buildPublicSearchPage(rows, 20, SEARCH_CTX);

        assert.equal(page.items.length, 1);
        assert.equal(page.hasMore, false);
        assert.equal(page.nextCursor, null);
    });

    it("simulates next page continuation without duplicates", () => {
        const rows = Array.from({ length: 5 }, (_, index) =>
            makeRow({
                entity_id: String(index + 1),
                display_name: `Row ${index + 1}`,
                score: 100 - index,
            }),
        );

        const first = buildPublicSearchPage(rows, 2, SEARCH_CTX);
        assert.equal(first.items.length, 2);
        assert.ok(first.nextCursor);

        const decoded = decodePublicSearchCursor(first.nextCursor!);
        const remaining = rows.filter((row) =>
            isUnifiedSearchRowAfterCursor(publicSearchCursorAfterFromRow(row), decoded.after),
        );
        const second = buildPublicSearchPage(remaining, 2, SEARCH_CTX);

        assert.equal((second.items[0] as { entityId: string }).entityId, "3");
        assert.equal((first.items[1] as { entityId: string }).entityId, "2");
        assert.notEqual(
            (second.items[0] as { entityId: string }).entityId,
            (first.items[0] as { entityId: string }).entityId,
        );
    });

    it("continues across null score rows without duplicates or skipped stable rows", () => {
        const rows = [
            makeRow({ entity_type: "place", entity_id: "1", display_name: "Alpha", score: 10, importance_score: 4 }),
            makeRow({ entity_type: "admin_area", entity_id: "3", display_name: "Beta", score: null, importance_score: 5 }),
            makeRow({ entity_type: "place", entity_id: "2", display_name: "Beta", score: null, importance_score: 5 }),
            makeRow({ entity_type: "place", entity_id: "4", display_name: "Gamma", score: null, importance_score: 5 }),
            makeRow({ entity_type: "place", entity_id: "5", display_name: "Delta", score: null, importance_score: 4 }),
        ];

        const first = buildPublicSearchPage(rows, 2, SEARCH_CTX);
        assert.ok(first.nextCursor);
        const after1 = decodePublicSearchCursor(first.nextCursor).after;
        const page2Rows = rows.filter((row) =>
            isUnifiedSearchRowAfterCursor(publicSearchCursorAfterFromRow(row), after1),
        );
        const second = buildPublicSearchPage(page2Rows, 2, SEARCH_CTX);
        assert.ok(second.nextCursor);
        const after2 = decodePublicSearchCursor(second.nextCursor).after;
        const page3Rows = rows.filter((row) =>
            isUnifiedSearchRowAfterCursor(publicSearchCursorAfterFromRow(row), after2),
        );
        const third = buildPublicSearchPage(page3Rows, 2, SEARCH_CTX);

        const ids = [...first.items, ...second.items, ...third.items].map((item) => {
            assert.ok("entityId" in item);
            return `${item.entityType}:${item.entityId}`;
        });

        assert.deepEqual(ids, ["place:1", "admin_area:3", "place:2", "place:4", "place:5"]);
        assert.equal(new Set(ids).size, ids.length);
    });
});

describe("PublicMapService.search pagination (mocked repo)", () => {
    it("requests limit + 1 rows for index search", async () => {
        const calls: Array<{ limit: number; after?: unknown }> = [];
        const repo = {
            searchUnifiedDocuments: async (params: { limit: number; after?: unknown }) => {
                calls.push({ limit: params.limit, after: params.after });
                return [makeRow({ entity_id: "1" })];
            },
            logFailedSearch: async () => {},
            insertSearchRequestEvent: async () => {},
        };
        const reverseSearch = { reverse: async () => null };
        const { PublicMapService } = await import("./public-map.service.js");
        const service = new PublicMapService(repo as never, reverseSearch as never);

        const page = await service.search({ q: "yangon", limit: 20, types: ["place"] });
        assert.equal(page.items.length, 1);
        assert.equal(calls[0]?.limit, 21);
        assert.equal(calls[0]?.after, undefined);
    });

    it("passes decoded cursor position to the repo on continuation", async () => {
        const after = publicSearchCursorAfterFromRow(makeRow({ entity_id: "7", score: 42 }));
        const calls: Array<{ after?: { entityId: string } }> = [];
        const repo = {
            searchUnifiedDocuments: async (params: { after?: { entityId: string } }) => {
                calls.push({ after: params.after });
                return [];
            },
            logFailedSearch: async () => {},
            insertSearchRequestEvent: async () => {},
        };
        const reverseSearch = { reverse: async () => null };
        const { PublicMapService } = await import("./public-map.service.js");
        const service = new PublicMapService(repo as never, reverseSearch as never);

        await service.search({
            q: "yangon",
            limit: 20,
            after,
            cursorContext: SEARCH_CTX,
        });

        assert.equal(calls[0]?.after?.entityId, "7");
    });

    it("continues page 1 to page 2 to page 3 for q=yangon with Myanmar language and map bias", async () => {
        const rows = Array.from({ length: 6 }, (_, index) =>
            makeRow({
                entity_type: index % 2 === 0 ? "place" : "admin_area",
                entity_id: String(index + 1),
                display_name: `Yangon ${index + 1}`,
                primary_name_my: `ရန်ကုန် ${index + 1}`,
                primary_name_en: `Yangon ${index + 1}`,
                score: 100 - index,
                importance_score: 50 - index,
            }),
        );
        const calls: Array<{ limit: number; after?: { entityId: string }; lang?: string; lat?: number; lng?: number }> = [];
        const repo = {
            searchUnifiedDocuments: async (params: {
                limit: number;
                after?: ReturnType<typeof publicSearchCursorAfterFromRow>;
                lang?: "my" | "en" | "und";
                lat?: number;
                lng?: number;
            }) => {
                calls.push({
                    limit: params.limit,
                    after: params.after,
                    lang: params.lang,
                    lat: params.lat,
                    lng: params.lng,
                });
                const remaining = params.after
                    ? rows.filter((row) =>
                          isUnifiedSearchRowAfterCursor(
                              publicSearchCursorAfterFromRow(row),
                              params.after!,
                          ),
                      )
                    : rows;
                return remaining.slice(0, params.limit);
            },
            logFailedSearch: async () => {},
            insertSearchRequestEvent: async () => {},
        };
        const reverseSearch = { reverse: async () => null };
        const { PublicMapService } = await import("./public-map.service.js");
        const service = new PublicMapService(repo as never, reverseSearch as never);
        const filters = resolvePublicSearchFilters({
            category: "all",
            transportType: "all",
            transportMode: "all",
        });
        const ctx = normalizePublicSearchCursorContext({
            q: "yangon",
            mode: "full",
            types: [...filters.entityTypes],
            lat: 16.8401,
            lng: 96.1735,
            category: filters.category,
            transportType: filters.transportType,
            transportMode: filters.transportMode,
            lang: "my",
        });

        const first = await service.search({
            q: "yangon",
            limit: 2,
            lat: 16.8401,
            lng: 96.1735,
            lang: "my",
            filters,
            cursorContext: ctx,
        });
        assert.equal(first.items.length, 2);
        assert.ok(first.nextCursor);

        const page2Url = new URL("https://api.example.test/public/search");
        page2Url.searchParams.set("q", "yangon");
        page2Url.searchParams.set("lang", "my");
        page2Url.searchParams.set("lat", "16.8401");
        page2Url.searchParams.set("lng", "96.1735");
        page2Url.searchParams.set("limit", "2");
        page2Url.searchParams.set("cursor", first.nextCursor);
        assert.equal(page2Url.searchParams.get("cursor"), first.nextCursor);
        assert.match(first.nextCursor, /^[A-Za-z0-9_-]+$/);

        const decoded1 = decodePublicSearchCursor(page2Url.searchParams.get("cursor")!);
        assertPublicSearchCursorMatchesRequest(decoded1.ctx, ctx);
        const second = await service.search({
            q: "yangon",
            limit: 2,
            lat: 16.8401,
            lng: 96.1735,
            lang: "my",
            filters,
            after: decoded1.after,
            cursorContext: ctx,
        });
        assert.equal(second.items.length, 2);
        assert.ok(second.nextCursor);

        const decoded2 = decodePublicSearchCursor(second.nextCursor);
        assertPublicSearchCursorMatchesRequest(decoded2.ctx, ctx);
        const third = await service.search({
            q: "yangon",
            limit: 2,
            lat: 16.8401,
            lng: 96.1735,
            lang: "my",
            filters,
            after: decoded2.after,
            cursorContext: ctx,
        });

        const ids = [...first.items, ...second.items, ...third.items].map((item) => {
            assert.ok("entityId" in item);
            return `${item.entityType}:${item.entityId}`;
        });
        assert.deepEqual(ids, [
            "place:1",
            "admin_area:2",
            "place:3",
            "admin_area:4",
            "place:5",
            "admin_area:6",
        ]);
        assert.equal(new Set(ids).size, ids.length);
        assert.equal(calls[0]?.after, undefined);
        assert.equal(calls[1]?.after?.entityId, "2");
        assert.equal(calls[2]?.after?.entityId, "4");
    });

    it("rejects a valid cursor when the map-center bias changes inside the same search", () => {
        const filters = resolvePublicSearchFilters({
            category: "all",
            transportType: "all",
            transportMode: "all",
        });
        const ctx = normalizePublicSearchCursorContext({
            q: "yangon",
            mode: "full",
            types: [...filters.entityTypes],
            lat: 16.84,
            lng: 96.173,
            category: filters.category,
            transportType: filters.transportType,
            transportMode: filters.transportMode,
            lang: "my",
        });
        const cursor = encodePublicSearchCursor({
            v: PUBLIC_SEARCH_CURSOR_VERSION,
            ctx,
            after: publicSearchCursorAfterFromRow(makeRow({ entity_id: "2" })),
        });
        const decoded = decodePublicSearchCursor(cursor);
        const changedMapCenter = normalizePublicSearchCursorContext({
            q: "yangon",
            mode: "full",
            types: [...filters.entityTypes],
            lat: 16.8404,
            lng: 96.173,
            category: filters.category,
            transportType: filters.transportType,
            transportMode: filters.transportMode,
            lang: "my",
        });

        assert.throws(
            () => assertPublicSearchCursorMatchesRequest(decoded.ctx, changedMapCenter),
            /reference location/,
        );
    });

    it("keeps filtered transport pagination bound to the same filter context", () => {
        const filters = resolvePublicSearchFilters({
            category: "transport",
            transportType: "routes",
            transportMode: "bus",
        });
        const ctx = normalizePublicSearchCursorContext({
            q: "yangon",
            mode: "full",
            types: [...filters.entityTypes],
            category: filters.category,
            transportType: filters.transportType,
            transportMode: filters.transportMode,
            lang: "my",
        });
        const cursor = encodePublicSearchCursor({
            v: PUBLIC_SEARCH_CURSOR_VERSION,
            ctx,
            after: publicSearchCursorAfterFromRow(
                makeRow({
                    entity_type: "transport_route",
                    entity_id: "99",
                    display_name: "YBS 99",
                }),
            ),
        });
        const decoded = decodePublicSearchCursor(cursor);
        assertPublicSearchCursorMatchesRequest(decoded.ctx, ctx);

        const changedFilter = normalizePublicSearchCursorContext({
            q: "yangon",
            mode: "full",
            types: ["transport_stop", "bus_stop"],
            category: "transport",
            transportType: "stops",
            transportMode: "bus",
            lang: "my",
        });
        assert.throws(
            () => assertPublicSearchCursorMatchesRequest(decoded.ctx, changedFilter),
            /type filter|transport type filter/,
        );
    });
});

describe("public search language + pagination", () => {
    it("serializes localized display names without changing cursor sort keys", () => {
        const row = makeRow({
            display_name: "Indexed English",
            primary_name_my: "ရန်ကုန်",
            primary_name_en: "Yangon",
        });

        const myHit = serializePublicSearchHit(row, "my");
        const enHit = serializePublicSearchHit(row, "en");

        assert.equal(myHit.displayName, "ရန်ကုန်");
        assert.equal(enHit.displayName, "Yangon");
        assert.equal(myHit.primaryNameMy, "ရန်ကုန်");
        assert.equal(enHit.primaryNameEn, "Yangon");
    });

    it("round-trips language in v3 cursor payloads", () => {
        const ctx = normalizePublicSearchCursorContext({
            q: "yangon",
            mode: "full",
            types: ["place"],
            lang: "my",
        });
        const encoded = encodePublicSearchCursor({
            v: PUBLIC_SEARCH_CURSOR_VERSION,
            ctx,
            after: publicSearchCursorAfterFromRow(makeRow()),
        });
        const decoded = decodePublicSearchCursor(encoded);
        assert.equal(decoded.ctx.lang, "my");
    });

    it("rejects cursor when language does not match", () => {
        const cursor = encodePublicSearchCursor({
            v: PUBLIC_SEARCH_CURSOR_VERSION,
            ctx: normalizePublicSearchCursorContext({
                q: "yangon",
                mode: "full",
                types: ["place"],
                lang: "my",
            }),
            after: publicSearchCursorAfterFromRow(makeRow()),
        });
        const decoded = decodePublicSearchCursor(cursor);
        const otherCtx = normalizePublicSearchCursorContext({
            q: "yangon",
            mode: "full",
            types: ["place"],
            lang: "en",
        });
        assert.throws(
            () => assertPublicSearchCursorMatchesRequest(decoded.ctx, otherCtx),
            /language/,
        );
    });
});
