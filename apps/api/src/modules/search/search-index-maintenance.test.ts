import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRepairedByFamily, normalizeSearchIndexHealthRow } from "./search-index-health.js";
import { searchIndexRebuildLockKeys } from "./search-index-maintenance.lock.js";
import {
    reindexSearchEntityBodySchema,
    reindexSearchFamilyBodySchema,
} from "./search-index-maintenance.schema.js";

describe("search index maintenance schema", () => {
    it("accepts allowlisted families only", () => {
        assert.equal(
            reindexSearchFamilyBodySchema.safeParse({ entity_family: "places" }).success,
            true,
        );
        assert.equal(
            reindexSearchFamilyBodySchema.safeParse({ entity_family: "not_a_family" }).success,
            false,
        );
    });

    it("accepts incremental entity types with positive entity_id", () => {
        const parsed = reindexSearchEntityBodySchema.safeParse({
            entity_type: "place",
            entity_id: "42",
        });
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.entity_id, 42n);
        }
        assert.equal(
            reindexSearchEntityBodySchema.safeParse({ entity_type: "address", entity_id: "1" })
                .success,
            false,
        );
    });
});

describe("searchIndexRebuildLockKeys", () => {
    it("dedupes views that share the same lock key bucket", () => {
        const keys = searchIndexRebuildLockKeys(["places", "places"]);
        assert.equal(keys.length, 1);
    });
});

describe("buildRepairedByFamily", () => {
    it("marks unhealthy families repaired when issues clear", () => {
        const before = [
            normalizeSearchIndexHealthRow({
                entity_family: "places",
                search_entity_type: "place",
                canonical_count: 2n,
                indexed_count: 1n,
                missing_count: 1n,
                ghost_count: 0n,
                stale_count: 0n,
                latest_indexed_at: null,
                latest_source_updated_at: null,
            }),
        ];
        const after = [
            normalizeSearchIndexHealthRow({
                entity_family: "places",
                search_entity_type: "place",
                canonical_count: 2n,
                indexed_count: 2n,
                missing_count: 0n,
                ghost_count: 0n,
                stale_count: 0n,
                latest_indexed_at: new Date("2026-07-10T00:00:00.000Z"),
                latest_source_updated_at: new Date("2026-07-10T00:00:00.000Z"),
            }),
        ];

        const repaired = buildRepairedByFamily(before, after);
        assert.equal(repaired.get("places"), true);
    });
});
