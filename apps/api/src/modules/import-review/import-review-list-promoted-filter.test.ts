import assert from "node:assert/strict";
import { test } from "node:test";

import { getImportReviewEntityConfig } from "./import-review-config.js";
import { buildCandidateWhereClause } from "./import-review-candidate-sql.js";
import {
    importReviewBuildingsQuerySchema,
    importReviewCandidatesListQuerySchema,
    importReviewPlacesQuerySchema,
    importReviewRoadsQuerySchema,
} from "./import-review.schema.js";

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

test("buildCandidateWhereClause excludes promoted rows when include_promoted is false", () => {
    const config = getImportReviewEntityConfig("buildings");
    const sql = buildCandidateWhereClause(config, 1n, { include_promoted: false }).strings.join(" ");
    assert.match(sql, /promotion_status.*promoted/i);
});

test("buildCandidateWhereClause includes promoted rows when include_promoted is true", () => {
    const config = getImportReviewEntityConfig("buildings");
    const sql = buildCandidateWhereClause(config, 1n, { include_promoted: true }).strings.join(" ");
    assert.doesNotMatch(sql, /IS DISTINCT FROM 'promoted'/);
});
