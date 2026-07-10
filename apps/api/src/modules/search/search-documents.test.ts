import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildCanonicalFreshnessForEntityKeysSql,
    computeSearchDocumentSyncState,
    normalizeSearchDocumentEntityType,
    resolveSearchDocumentEntityTypesForFilter,
} from "./search-canonical-source.js";
import {
    enrichIndexedDocumentRows,
    entityKey,
    needsCanonicalJoinForList,
    SearchDocumentsRepository,
} from "./search-documents.repo.js";
import { listSearchDocumentsQuerySchema } from "./search-documents.schema.js";

describe("search-canonical-source", () => {
    it("normalizes legacy transport entity filters", () => {
        assert.equal(normalizeSearchDocumentEntityType("bus_stop"), "transport_stop");
        assert.equal(normalizeSearchDocumentEntityType("transport_route"), "transport_route");
        assert.equal(normalizeSearchDocumentEntityType("unknown"), null);
    });

    it("expands route entity filters to route + variant types", () => {
        assert.deepEqual(resolveSearchDocumentEntityTypesForFilter("transport_route"), [
            "transport_route",
            "transport_route_variant",
        ]);
        assert.deepEqual(resolveSearchDocumentEntityTypesForFilter("place"), ["place"]);
        assert.equal(resolveSearchDocumentEntityTypesForFilter(undefined), null);
    });

    it("computes sync state using the same stale rules as index health", () => {
        const canonical = new Date("2026-07-10T12:00:00.000Z");
        const indexed = new Date("2026-07-10T11:00:00.000Z");

        assert.equal(
            computeSearchDocumentSyncState({
                hasCanonical: true,
                indexedSourceUpdatedAt: indexed,
                canonicalSourceUpdatedAt: canonical,
            }),
            "stale",
        );
        assert.equal(
            computeSearchDocumentSyncState({
                hasCanonical: true,
                indexedSourceUpdatedAt: canonical,
                canonicalSourceUpdatedAt: indexed,
            }),
            "current",
        );
        assert.equal(
            computeSearchDocumentSyncState({
                hasCanonical: false,
                indexedSourceUpdatedAt: indexed,
                canonicalSourceUpdatedAt: null,
            }),
            "ghost",
        );
    });

    it("builds canonical freshness SQL only for requested entity keys", () => {
        const sql = buildCanonicalFreshnessForEntityKeysSql([
            { entity_type: "place", entity_id: 10n },
            { entity_type: "transport_stop", entity_id: 20n },
        ]);

        assert.ok(sql);
        const rendered = sql.strings.join("");
        assert.match(rendered, /v_search_places_source/);
        assert.match(rendered, /v_search_bus_stops_source/);
        assert.match(rendered, /entity_id IN/);
    });
});

describe("listSearchDocumentsQuerySchema", () => {
    it("accepts Fastify-coerced boolean query params", () => {
        const parsed = listSearchDocumentsQuerySchema.safeParse({
            page: 1,
            pageSize: 1,
            is_verified: true,
            is_public: false,
            is_active: true,
            has_alias: false,
        });

        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.is_verified, true);
            assert.equal(parsed.data.is_public, false);
            assert.equal(parsed.data.is_active, true);
            assert.equal(parsed.data.has_alias, false);
        }
    });

    it("accepts current canonical transport entity type filters", () => {
        const parsed = listSearchDocumentsQuerySchema.safeParse({
            entity_type: "transport_stop",
            page: 1,
            pageSize: 25,
        });

        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.entity_type, "transport_stop");
        }
    });

    it("accepts transport mode, review status, sync state, and pagination", () => {
        const parsed = listSearchDocumentsQuerySchema.safeParse({
            transport_mode: "bus",
            review_status: "verified",
            sync_state: "stale",
            page: "3",
            pageSize: "25",
        });

        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.transport_mode, "bus");
            assert.equal(parsed.data.review_status, "verified");
            assert.equal(parsed.data.sync_state, "stale");
            assert.equal(parsed.data.page, 3);
            assert.equal(parsed.data.pageSize, 25);
        }
    });
});

describe("SearchDocumentsService serialization", () => {
    it("serializes bigint ids and timestamps to strings", async () => {
        const { SearchDocumentsService } = await import("./search-documents.service.js");

        class MockRepo {
            async list() {
                return {
                    items: [
                        {
                            search_document_id: 42n,
                            entity_type: "place",
                            entity_id: 101n,
                            public_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                            display_name: "Yangon International Airport",
                            primary_name_my: "လေဆိပ်",
                            primary_name_en: "Yangon International Airport",
                            primary_name_und: null,
                            transport_mode: null,
                            review_status: "verified",
                            is_verified: true,
                            is_public: true,
                            is_active: true,
                            importance_score: 85,
                            confidence_score: 90,
                            indexed_at: new Date("2026-07-10T00:00:00.000Z"),
                            source_updated_at: new Date("2026-07-09T00:00:00.000Z"),
                            canonical_source_updated_at: new Date("2026-07-10T00:00:00.000Z"),
                            alias_count: 4,
                            sync_state: "stale" as const,
                        },
                    ],
                    total: 1,
                };
            }
        }

        const service = new SearchDocumentsService(new MockRepo() as never);
        const result = await service.list({
            page: 1,
            pageSize: 25,
            sort: "indexed_at",
            order: "desc",
        });

        assert.equal(result.items[0]?.search_document_id, "42");
        assert.equal(result.items[0]?.entity_id, "101");
        assert.equal(result.items[0]?.sync_state, "stale");
        assert.equal(result.items[0]?.alias_count, 4);
    });
});

describe("SearchDocumentsRepository listing strategy", () => {
    it("uses fast path unless sync_state filter requires canonical join", () => {
        assert.equal(needsCanonicalJoinForList({}), false);
        assert.equal(needsCanonicalJoinForList({ sync_state: undefined }), false);
        assert.equal(needsCanonicalJoinForList({ sync_state: "current" }), true);
        assert.equal(needsCanonicalJoinForList({ sync_state: "stale" }), true);
        assert.equal(needsCanonicalJoinForList({ sync_state: "ghost" }), true);
    });

    it("enriches page rows with alias counts and sync state when canonical map is provided", () => {
        const canonical = new Date("2026-07-10T12:00:00.000Z");
        const indexed = new Date("2026-07-10T11:00:00.000Z");
        const rows = enrichIndexedDocumentRows(
            [
                {
                    search_document_id: 1n,
                    entity_type: "place",
                    entity_id: 42n,
                    public_id: null,
                    display_name: "Test",
                    primary_name_my: null,
                    primary_name_en: "Test",
                    primary_name_und: null,
                    transport_mode: null,
                    review_status: null,
                    is_verified: true,
                    is_public: true,
                    is_active: true,
                    importance_score: 10,
                    confidence_score: 20,
                    indexed_at: indexed,
                    source_updated_at: indexed,
                },
            ],
            new Map([[entityKey("place", 42n), 3]]),
            new Map([[entityKey("place", 42n), canonical]]),
        );

        assert.equal(rows[0]?.alias_count, 3);
        assert.equal(rows[0]?.sync_state, "stale");
        assert.equal(rows[0]?.canonical_source_updated_at?.toISOString(), canonical.toISOString());
    });

    it("uses cheap list sync state on fast path without canonical freshness", () => {
        const rows = enrichIndexedDocumentRows(
            [
                {
                    search_document_id: 1n,
                    entity_type: "street_group",
                    entity_id: 42n,
                    public_id: null,
                    display_name: "Pyay Road",
                    primary_name_my: null,
                    primary_name_en: "Pyay Road",
                    primary_name_und: null,
                    transport_mode: null,
                    review_status: null,
                    is_verified: false,
                    is_public: true,
                    is_active: true,
                    importance_score: 0,
                    confidence_score: 0,
                    indexed_at: new Date("2026-07-10T00:00:00.000Z"),
                    source_updated_at: new Date("2026-07-09T00:00:00.000Z"),
                },
            ],
            new Map([[entityKey("street_group", 42n), 1]]),
            null,
        );

        assert.equal(rows[0]?.sync_state, "current");
        assert.equal(rows[0]?.canonical_source_updated_at, null);
        assert.equal(rows[0]?.alias_count, 1);
    });

    it("marks ghost sync state when canonical row is absent and freshness was computed", () => {
        const rows = enrichIndexedDocumentRows(
            [
                {
                    search_document_id: 2n,
                    entity_type: "place",
                    entity_id: 99n,
                    public_id: null,
                    display_name: "Ghost",
                    primary_name_my: null,
                    primary_name_en: "Ghost",
                    primary_name_und: null,
                    transport_mode: null,
                    review_status: null,
                    is_verified: false,
                    is_public: true,
                    is_active: true,
                    importance_score: 0,
                    confidence_score: 0,
                    indexed_at: new Date("2026-07-10T00:00:00.000Z"),
                    source_updated_at: new Date("2026-07-10T00:00:00.000Z"),
                },
            ],
            new Map(),
            new Map(),
        );
        assert.equal(rows[0]?.sync_state, "ghost");
        assert.equal(rows[0]?.alias_count, 0);
    });

    it("uses a bounded number of queries for default unfiltered list (no N+1)", async () => {
        let queryCount = 0;
        const prisma = {
            $queryRaw: async () => {
                queryCount += 1;
                if (queryCount === 1) {
                    return [
                        {
                            search_document_id: 1n,
                            entity_type: "place",
                            entity_id: 1n,
                            public_id: null,
                            display_name: "A",
                            primary_name_my: null,
                            primary_name_en: "A",
                            primary_name_und: null,
                            transport_mode: null,
                            review_status: "verified",
                            is_verified: true,
                            is_public: true,
                            is_active: true,
                            importance_score: 1,
                            confidence_score: 1,
                            indexed_at: new Date("2026-07-10T00:00:00.000Z"),
                            source_updated_at: new Date("2026-07-10T00:00:00.000Z"),
                        },
                    ];
                }
                if (queryCount === 2) {
                    return [{ total: 1 }];
                }
                if (queryCount === 3) {
                    return [{ entity_type: "place", entity_id: 1n, alias_count: 2 }];
                }
                throw new Error("unexpected query");
            },
        };

        const repo = new SearchDocumentsRepository(prisma as never);
        const result = await repo.list({
            page: 1,
            pageSize: 25,
            sort: "indexed_at",
            order: "desc",
        });

        assert.equal(queryCount, 3);
        assert.equal(result.total, 1);
        assert.equal(result.items[0]?.alias_count, 2);
        assert.equal(result.items[0]?.sync_state, "current");
    });

    it("uses canonical join path when sync_state filter is set", async () => {
        let queryCount = 0;
        let sawCanonicalUnion = false;
        const prisma = {
            $queryRaw: async (query: { strings: string[] }) => {
                queryCount += 1;
                const rendered = query.strings.join("");
                if (rendered.includes("v_search_places_source")) {
                    sawCanonicalUnion = true;
                }
                if (queryCount === 1) {
                    return [];
                }
                return [{ total: 0 }];
            },
        };

        const repo = new SearchDocumentsRepository(prisma as never);
        await repo.list({
            page: 1,
            pageSize: 25,
            sort: "indexed_at",
            order: "desc",
            sync_state: "stale",
        });

        assert.equal(queryCount, 2);
        assert.equal(sawCanonicalUnion, true);
    });

    it("applies transport mode and review filters on the fast path", async () => {
        const captured: string[] = [];
        const prisma = {
            $queryRaw: async (query: { strings: string[] }) => {
                captured.push(query.strings.join(""));
                if (captured.length === 1) {
                    return [];
                }
                return [{ total: 0 }];
            },
        };

        const repo = new SearchDocumentsRepository(prisma as never);
        await repo.list({
            page: 1,
            pageSize: 25,
            sort: "indexed_at",
            order: "desc",
            transport_mode: "bus",
            review_status: "verified",
        });

        assert.match(captured[0] ?? "", /address_parts->>'mode'/);
        assert.match(captured[0] ?? "", /address_parts->>'review_status'/);
        assert.doesNotMatch(captured[0] ?? "", /v_search_street_groups_source/);
    });
});
