import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
    allowsTransportRouteVariantResults,
    escapeLikeToken,
    PublicMapRepository,
    splitSearchTokens,
    type UnifiedSearchRow,
} from "./public-map.repo.js";
import {
    clampUnifiedSearchLimit,
    coordinatePinResult,
    parseCoordinate,
    planPublicSearch,
    serializePublicSearchHit,
    serializeUnifiedSearchResult,
} from "./public-map.service.js";

function makeRow(overrides: Partial<UnifiedSearchRow> = {}): UnifiedSearchRow {
    return {
        entity_type: "place",
        entity_id: "42",
        public_id: "11111111-1111-1111-1111-111111111111",
        display_name: "  Kyauktan Market  ",
        subtitle: "Market",
        primary_name_my: " ဈေး ",
        primary_name_en: "Kyauktan Market",
        primary_name_und: null,
        matched_name: " Kyauktan Market ",
        geometry_type: "POINT",
        lng: 96.3168,
        lat: 16.659,
        min_lng: 96.31,
        min_lat: 16.65,
        max_lng: 96.32,
        max_lat: 16.66,
        has_geometry: true,
        category_code: "market",
        category_name_my: "ဈေး",
        category_name_en: "Market",
        admin_area_name_my: "ကျောက်တန်း",
        admin_area_name_en: "Kyauktan",
        score: 123.456,
        importance_score: 0,
        is_verified: true,
        confidence_score: 70,
        boundary_confidence_score: 0,
        address_parts: null,
        ...overrides,
    };
}

async function captureUnifiedSearchSql(query: string): Promise<string> {
    const capturedQueries: Array<{ strings: readonly string[] }> = [];
    const tx = {
        $executeRawUnsafe: async () => 0,
        $queryRaw: async <T>(sql: { strings: readonly string[] }): Promise<T> => {
            capturedQueries.push(sql);
            return [] as T;
        },
    };
    const prisma = {
        $transaction: async <T>(callback: (client: typeof tx) => Promise<T>): Promise<T> =>
            callback(tx),
    } as unknown as PrismaClient;

    const repo = new PublicMapRepository(prisma);
    const plan = planPublicSearch(query);
    assert.equal(plan.allowed, true);
    if (!plan.allowed) throw new Error("expected an allowed public search query");
    await repo.searchUnifiedDocuments({ q: query, mode: plan.mode, limit: 20 });

    const capturedSql = capturedQueries.at(-1);
    assert.ok(capturedSql, "expected the unified search SQL to be executed");
    return capturedSql.strings.join("?");
}

describe("numeric transport query planning", () => {
    it("keeps one-character queries blocked and ordinary two-character text in prefix mode", () => {
        assert.deepEqual(planPublicSearch("1"), { allowed: false });
        assert.deepEqual(planPublicSearch("ab"), { allowed: true, mode: "prefix" });
    });

    it("runs digit-only queries of length two or more in full mode", () => {
        for (const query of ["13", "37", "100", "113"]) {
            assert.deepEqual(planPublicSearch(query), { allowed: true, mode: "full" });
        }
    });

    it("keeps route-code and explicit variant queries in normal full mode", () => {
        for (const query of ["ybs-13", "YBS 13", "YBS 13 D0"]) {
            assert.deepEqual(planPublicSearch(query), { allowed: true, mode: "full" });
        }
    });

    it("adds the exact-number candidate branch only for numeric transport intent", async () => {
        for (const query of ["13", "37", "100", "113"]) {
            const numericSql = await captureUnifiedSearchSql(query);
            assert.match(numericSql, /d\.entity_type IN \('transport_route', 'bus_route'\)/);
            assert.match(
                numericSql,
                /right\(lower\(btrim\(d\.code\)\), length\(\?\) \+ 1\)/,
            );
        }

        const normalSql = await captureUnifiedSearchSql("ybs-13");
        assert.doesNotMatch(
            normalSql,
            /right\(lower\(btrim\(d\.code\)\), length\(\?\) \+ 1\)/,
        );
    });
});

describe("canonical transport route result shaping", () => {
    it("suppresses route variants for normal route queries", async () => {
        for (const query of ["13", "ybs-13", "YBS 13"]) {
            assert.equal(allowsTransportRouteVariantResults(query), false);
            const sql = await captureUnifiedSearchSql(query);
            assert.match(
                sql,
                /d\.entity_type NOT IN \('transport_route_variant', 'bus_route_variant'\)/,
            );
        }
    });

    it("allows route variants for explicit D0/D1 queries", async () => {
        for (const query of ["YBS 13 D0", "YBS-13-D1", "d0", "D1"]) {
            assert.equal(allowsTransportRouteVariantResults(query), true);
            const sql = await captureUnifiedSearchSql(query);
            assert.doesNotMatch(
                sql,
                /d\.entity_type NOT IN \('transport_route_variant', 'bus_route_variant'\)/,
            );
        }
    });

    it("does not treat embedded D0/D1-like text as an explicit variant query", () => {
        assert.equal(allowsTransportRouteVariantResults("D01"), false);
        assert.equal(allowsTransportRouteVariantResults("ROAD0"), false);
        assert.equal(allowsTransportRouteVariantResults("YBS 13 D10"), false);
    });

    it("keeps other entity types and alias candidate deduplication unchanged", async () => {
        const sql = await captureUnifiedSearchSql("yangon");
        assert.match(sql, /FROM search\.search_document_names n/);
        assert.match(sql, /candidate_ids AS MATERIALIZED/);
        assert.match(sql, /GROUP BY id/);
        assert.doesNotMatch(sql, /lower\(btrim\(scored\.display_name\)\)/);
    });
});

describe("clampUnifiedSearchLimit", () => {
    it("defaults to 20 when undefined or non-finite", () => {
        assert.equal(clampUnifiedSearchLimit(undefined), 20);
        assert.equal(clampUnifiedSearchLimit(Number.NaN), 20);
    });

    it("caps at 50 and floors at 1, truncating fractions", () => {
        assert.equal(clampUnifiedSearchLimit(999), 50);
        assert.equal(clampUnifiedSearchLimit(0), 1);
        assert.equal(clampUnifiedSearchLimit(12.9), 12);
    });
});

describe("serializeUnifiedSearchResult", () => {
    it("maps snake_case rows to camelCase, trims names, rounds score", () => {
        const result = serializeUnifiedSearchResult(makeRow());

        assert.equal(result.entityType, "place");
        assert.equal(result.entityId, "42");
        assert.equal(result.displayName, "Kyauktan Market");
        assert.equal(result.primaryNameMy, "ဈေး");
        assert.equal(result.matchedName, "Kyauktan Market");
        assert.deepEqual(result.center, [96.3168, 16.659]);
        assert.deepEqual(result.bbox, [96.31, 16.65, 96.32, 16.66]);
        assert.equal(result.hasGeometry, true);
        assert.equal(result.categoryName, "Market");
        assert.equal(result.adminAreaNameEn, "Kyauktan");
        assert.equal(result.score, 123.46);
        assert.equal(result.isVerified, true);
        assert.equal(result.confidenceScore, 70);
    });

    it("returns null center when centroid is missing", () => {
        const result = serializeUnifiedSearchResult(makeRow({ lng: null, lat: null }));
        assert.equal(result.center, null);
    });

    it("returns null bbox when any envelope corner is missing", () => {
        const result = serializeUnifiedSearchResult(makeRow({ max_lat: null }));
        assert.equal(result.bbox, null);
    });

    it("falls back to Myanmar category name when English is missing", () => {
        const result = serializeUnifiedSearchResult(
            makeRow({ category_name_en: null }),
        );
        assert.equal(result.categoryName, "ဈေး");
    });
});

describe("serializePublicSearchHit", () => {
    it("maps a place to a point camera target and id", () => {
        const hit = serializePublicSearchHit(makeRow(), "en");
        assert.equal(hit.id, "place:42");
        assert.equal(hit.entityType, "place");
        assert.equal(hit.type, "place");
        assert.equal(hit.entityId, "42");
        assert.equal(hit.publicId, "11111111-1111-1111-1111-111111111111");
        assert.equal(hit.displayName, "Kyauktan Market");
        assert.equal(hit.primaryNameEn, "Kyauktan Market");
        assert.deepEqual(hit.center, [96.3168, 16.659]);
        assert.equal(hit.cameraTarget?.type, "point");
        assert.equal(hit.cameraTarget?.zoom, 16);
        assert.equal(hit.hasGeometry, true);
        assert.equal(hit.geometryType, "POINT");
        assert.equal(hit.verification.isVerified, true);
        assert.equal(hit.category?.code, "market");
    });

    it("prefers Myanmar labels when lang=my", () => {
        const hit = serializePublicSearchHit(makeRow(), "my");
        assert.equal(hit.displayName, "ဈေး");
        assert.equal(hit.primaryNameMy, "ဈေး");
    });

    it("maps a grouped street to a bounds camera target", () => {
        const hit = serializePublicSearchHit(
            makeRow({
                entity_type: "street_group",
                entity_id: "777",
                display_name: "Pyay Road",
                primary_name_my: "ပြည်လမ်း",
                primary_name_en: "Pyay Road",
                subtitle: "primary",
                geometry_type: "MultiLineString",
                category_code: "primary",
            }),
        );
        assert.equal(hit.id, "street_group:777");
        assert.equal(hit.entityType, "street_group");
        assert.equal(hit.geometryType, "MultiLineString");
        assert.equal(hit.cameraTarget?.type, "bounds");
        assert.deepEqual(hit.bbox, [96.31, 16.65, 96.32, 16.66]);
        assert.equal(hit.category?.code, "primary");
    });

    it("omits center/bbox and camera target when geometry is missing", () => {
        const hit = serializePublicSearchHit(
            makeRow({
                entity_type: "street_group",
                lng: null,
                lat: null,
                min_lng: null,
                min_lat: null,
                max_lng: null,
                max_lat: null,
            }),
        );
        assert.equal(hit.center, null);
        assert.equal(hit.bbox, null);
        assert.equal(hit.cameraTarget, undefined);
    });
});

describe("splitSearchTokens (multi-token Myanmar search)", () => {
    it("treats glued Myanmar township + road as two tokens (AND match)", () => {
        // "အင်းစိန် ဘုရင့်နောင်" -> Insein + Bayint Naung. FTS misses this because the
        // stored strings glue terms ("ဘုရင့်နောင်လမ်း", "အင်းစိန်ခရိုင်"); per-token
        // trigram AND finds it.
        const tokens = splitSearchTokens("အင်းစိန် ဘုရင့်နောင်");
        assert.deepEqual(tokens, ["အင်းစိန်", "ဘုရင့်နောင်"]);
    });

    it("splits Latin multi-word road queries", () => {
        assert.deepEqual(splitSearchTokens("lashio muse"), ["lashio", "muse"]);
        assert.deepEqual(splitSearchTokens("yangon mandalay"), [
            "yangon",
            "mandalay",
        ]);
    });

    it("keeps single-token queries as one token (single-token path)", () => {
        assert.deepEqual(splitSearchTokens("ဘုရင့်နောင်"), ["ဘုရင့်နောင်"]);
        assert.deepEqual(splitSearchTokens("ကျောက်တန်း"), ["ကျောက်တန်း"]);
    });

    it("collapses extra whitespace and drops empty tokens", () => {
        assert.deepEqual(splitSearchTokens("  yangon   mandalay  "), [
            "yangon",
            "mandalay",
        ]);
        assert.deepEqual(splitSearchTokens("   "), []);
    });
});

describe("parseCoordinate", () => {
    it("parses the common lat,lng formats", () => {
        assert.deepEqual(parseCoordinate("16.8,96.15"), { lat: 16.8, lng: 96.15 });
        assert.deepEqual(parseCoordinate("16.8, 96.15"), { lat: 16.8, lng: 96.15 });
        assert.deepEqual(parseCoordinate("16.8 96.15"), { lat: 16.8, lng: 96.15 });
        assert.deepEqual(parseCoordinate("16.8;96.15"), { lat: 16.8, lng: 96.15 });
    });

    it("rejects non-coordinates and out-of-range values", () => {
        assert.equal(parseCoordinate("yangon"), null);
        assert.equal(parseCoordinate("hledan 11 road"), null);
        // lat > 90 (e.g. lng,lat order) -> reject, fall through to text search.
        assert.equal(parseCoordinate("96.15,16.8"), null);
        assert.equal(parseCoordinate("100,200"), null);
        assert.equal(parseCoordinate(""), null);
    });

    it("supports negative coordinates within range", () => {
        assert.deepEqual(parseCoordinate("-33.9, 151.2"), { lat: -33.9, lng: 151.2 });
    });
});

describe("coordinatePinResult", () => {
    it("builds an in-service-area pin with score 100 and a point camera", () => {
        const hit = coordinatePinResult(16.8, 96.15, null, false);
        assert.equal(hit.entityType, "coordinate");
        assert.equal(hit.type, "coordinate");
        assert.equal(hit.displayName, "16.8, 96.15");
        assert.equal(hit.subtitle, "Coordinate location");
        assert.equal(hit.geometryType, "Point");
        assert.deepEqual(hit.center, [96.15, 16.8]);
        assert.equal(hit.hasGeometry, true);
        assert.equal(hit.score, 100);
        assert.equal(hit.coordinate.outsideServiceArea, false);
        assert.equal(hit.cameraTarget.type, "point");
        assert.deepEqual(hit.cameraTarget.center, [96.15, 16.8]);
    });

    it("flags out-of-service-area pins and keeps reverse admin info", () => {
        const reverse = {
            nearbyName: "Sule Pagoda",
            nearbyType: null,
            nearbyDistanceM: null,
            township: "Dagon",
            district: "Kyauktada District",
            regionState: "Yangon Region",
            country: "Myanmar",
            confidence: null,
        };
        const outside = coordinatePinResult(-33.9, 151.2, null, true);
        assert.equal(outside.coordinate.outsideServiceArea, true);
        // Subtitle stays a stable descriptor; admin detail rides in `reverse`.
        const inArea = coordinatePinResult(16.8, 96.15, reverse, false);
        assert.equal(inArea.subtitle, "Coordinate location");
        assert.equal(inArea.reverse?.township, "Dagon");
    });
});

describe("serializePublicSearchHit transport entity types", () => {
    it("serializes train station hits with mode-agnostic fields", () => {
        const hit = serializePublicSearchHit(
            makeRow({
                entity_type: "transport_stop",
                display_name: "Yangon Central",
                category_code: "train",
                category_name_en: "station",
                address_parts: {
                    mode: "train",
                    stop_type: "station",
                    review_status: "verified",
                    verification_status: "verified",
                },
            }),
        );

        assert.equal(hit.entityType, "transport_stop");
        assert.equal(hit.type, "transport_stop");
        assert.equal(hit.transport?.mode, "train");
        assert.equal(hit.transport?.stopType, "station");
        assert.equal(hit.verification.reviewStatus, "verified");
        assert.equal(hit.verification.verificationStatus, "verified");
    });

    it("maps legacy bus_stop index rows to transport_stop in API output", () => {
        const hit = serializePublicSearchHit(
            makeRow({
                entity_type: "bus_stop",
                category_code: "bus",
                category_name_en: "bus_stop",
                address_parts: { mode: "bus", stop_type: "bus_stop", review_status: "reviewed" },
            }),
        );

        assert.equal(hit.entityType, "transport_stop");
        assert.equal(hit.transport?.mode, "bus");
    });

    it("serializes express route hits with mode metadata", () => {
        const hit = serializePublicSearchHit(
            makeRow({
                entity_type: "transport_route",
                display_name: "Yangon - Mandalay Express",
                category_code: "express",
                address_parts: { mode: "express", review_status: "reviewed" },
            }),
        );

        assert.equal(hit.entityType, "transport_route");
        assert.equal(hit.transport?.mode, "express");
    });
});

describe("escapeLikeToken", () => {
    it("escapes LIKE wildcards so tokens can't inject patterns", () => {
        assert.equal(escapeLikeToken("a%b_c"), "a\\%b\\_c");
        assert.equal(escapeLikeToken("back\\slash"), "back\\\\slash");
    });

    it("leaves Myanmar/Latin text unchanged", () => {
        assert.equal(escapeLikeToken("ဘုရင့်နောင်"), "ဘုရင့်နောင်");
        assert.equal(escapeLikeToken("lashio"), "lashio");
    });
});
