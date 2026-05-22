import assert from "node:assert/strict";
import test from "node:test";

import {
    effectiveAdminAreaIdExpr,
    ImportReviewCandidateColumnRegistry,
    landuseClassCodeEffectiveExpr,
} from "./import-review-candidate-column-registry.js";

test("landuse_candidates static registry has no admin_area_id column", async () => {
    const registry = new ImportReviewCandidateColumnRegistry({} as never);
    const caps = await registry.getCapabilities("import_review.landuse_candidates");
    assert.equal(caps.hasAdminAreaIdColumn, false);
    assert.equal(caps.hasLanduseClassIdColumn, true);
});

test("building_candidates static registry has admin_area_id column", async () => {
    const registry = new ImportReviewCandidateColumnRegistry({} as never);
    const caps = await registry.getCapabilities("import_review.building_candidates");
    assert.equal(caps.hasAdminAreaIdColumn, true);
    assert.equal(caps.hasBuildingTypeIdColumn, true);
});

test("effectiveAdminAreaIdExpr omits physical column when unavailable", () => {
    const withColumn = effectiveAdminAreaIdExpr("l", { hasAdminAreaColumn: true }).strings.join("?");
    const withoutColumn = effectiveAdminAreaIdExpr("l", { hasAdminAreaColumn: false }).strings.join("?");

    assert.match(withColumn, /l\.admin_area_id/);
    assert.doesNotMatch(withoutColumn, /l\.admin_area_id/);
    assert.match(withoutColumn, /review_overrides/);
});

test("landuseClassCodeEffectiveExpr uses class_code and overrides only", () => {
    const expr = landuseClassCodeEffectiveExpr("l").strings.join("?");
    assert.match(expr, /l\.class_code/);
    assert.doesNotMatch(expr, /admin_area_id/);
});
