import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    computeSearchDocumentSyncState,
    normalizeSearchDocumentEntityType,
    resolveSearchDocumentEntityTypesForFilter,
} from "./search-canonical-source.js";

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
