import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

import { getImportReviewEntityConfig } from "./import-review-config.js";
import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { buildCandidateWhereClause } from "./import-review-candidate-sql.js";
import {
    importReviewBuildingsQuerySchema,
    importReviewCandidatesListQuerySchema,
    importReviewPlacesQuerySchema,
    importReviewRoadsQuerySchema,
} from "./import-review.schema.js";

const PROMOTED_ENTITY_FAMILIES: ImportReviewEntityFamilySlug[] = [
    "buildings",
    "places",
    "roads",
    "landuse",
    "water_lines",
    "water_polygons",
    "admin_areas",
    "routing_barriers",
    "addresses",
];

function whereSql(family: ImportReviewEntityFamilySlug, filters: Parameters<typeof buildCandidateWhereClause>[2]) {
    const config = getImportReviewEntityConfig(family);
    return buildCandidateWhereClause(config, 1n, filters).strings.join(" ");
}

test("list query schemas default include_promoted to false", () => {
    const buildings = importReviewBuildingsQuerySchema.parse({ review_batch_id: "1" });
    assert.equal(buildings.include_promoted, false);

    const places = importReviewPlacesQuerySchema.parse({ review_batch_id: "1" });
    assert.equal(places.include_promoted, false);

    const roads = importReviewRoadsQuerySchema.parse({ review_batch_id: "1" });
    assert.equal(roads.include_promoted, false);

    const generic = importReviewCandidatesListQuerySchema.parse({
        review_batch_id: "1",
    });
    assert.equal(generic.include_promoted, false);
});

describe("default candidate list excludes promoted", () => {
    it("places default active list hides promoted and stale batched", () => {
        const sql = whereSql("places", { promotion_state: "all_active" });
        assert.match(sql, /promotion_status = 'promoted'/i);
        assert.match(sql, /promotion_status IS DISTINCT FROM 'batched'/i);
    });

    for (const family of PROMOTED_ENTITY_FAMILIES) {
        it(`${family} default active list hides promoted`, () => {
            const sql = whereSql(family, { promotion_state: "all_active" });
            assert.match(sql, /promotion_status = 'promoted'/i);
        });
    }
});

describe("include_promoted=true includes promoted rows", () => {
    it("places list does not apply default promoted exclusion", () => {
        const sql = whereSql("places", { include_promoted: true });
        assert.doesNotMatch(sql, /IS DISTINCT FROM 'promoted'/);
    });

    it("schema parse include_promoted=true passes through to filters", () => {
        const places = importReviewPlacesQuerySchema.parse({
            review_batch_id: "1",
            include_promoted: "true",
        });
        assert.equal(places.include_promoted, true);
        const sql = whereSql("places", { include_promoted: places.include_promoted });
        assert.doesNotMatch(sql, /IS DISTINCT FROM 'promoted'/);
    });
});

describe("blocked unpromoted candidates remain visible", () => {
    it("does not exclude promotion_status=blocked by default", () => {
        const sql = whereSql("places", { include_promoted: false });
        assert.doesNotMatch(sql, /promotion_status.*blocked/i);
        assert.doesNotMatch(sql, /IS DISTINCT FROM 'blocked'/i);
    });

    it("still returns blocked rows when promotion_status filter is blocked", () => {
        const sql = whereSql("places", {
            include_promoted: false,
            promotion_status: "blocked",
        });
        assert.match(sql, /promotion_status\s*=/i);
        assert.doesNotMatch(sql, /IS DISTINCT FROM 'promoted'/);
    });

    it("explicit promotion_status=promoted filter overrides default exclusion", () => {
        const sql = whereSql("places", {
            include_promoted: false,
            promotion_status: "promoted",
        });
        assert.match(sql, /promotion_status\s*=/i);
        assert.doesNotMatch(sql, /IS DISTINCT FROM 'promoted'/);
    });
});
