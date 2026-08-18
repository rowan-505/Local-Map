import assert from "node:assert/strict";
import test from "node:test";

import {
    effectiveAdminAreaIdExpr,
    ImportReviewCandidateColumnRegistry,
    landAreaClassCodeEffectiveExpr,
} from "./import-review-candidate-column-registry.js";

test("land_area_candidates static registry has no admin_area_id column", async () => {
    const registry = new ImportReviewCandidateColumnRegistry({} as never);
    const caps = await registry.getCapabilities("import_review.land_area_candidates");
    assert.equal(caps.hasAdminAreaIdColumn, false);
    assert.equal(caps.hasLandAreaClassIdColumn, true);
});

test("building_candidates static registry has admin_area_id column", async () => {
    const registry = new ImportReviewCandidateColumnRegistry({} as never);
    const caps = await registry.getCapabilities("import_review.building_candidates");
    assert.equal(caps.hasAdminAreaIdColumn, true);
    assert.equal(caps.hasBuildingTypeIdColumn, true);
});

test("road_candidates static registry has admin_area_id and Phase 1b routing columns", async () => {
    const registry = new ImportReviewCandidateColumnRegistry({} as never);
    const columns = await registry.getColumns("import_review.road_candidates");
    assert.equal(columns.has("admin_area_id"), true);
    assert.equal(columns.has("name_mm"), true);
    assert.equal(columns.has("name_en"), true);
    assert.equal(columns.has("access"), true);
    assert.equal(columns.has("speed_kph"), true);
    const caps = await registry.getCapabilities("import_review.road_candidates");
    assert.equal(caps.hasAdminAreaIdColumn, true);
});

test("admin_area_candidates static registry exposes admin columns without admin_area_id", async () => {
    const registry = new ImportReviewCandidateColumnRegistry({} as never);
    const columns = await registry.getColumns("import_review.admin_area_candidates");
    assert.equal(columns.has("admin_level_id"), true);
    assert.equal(columns.has("parent_id"), true);
    assert.equal(columns.has("centroid"), true);
    assert.equal(columns.has("admin_area_id"), false);
});

test("routing_barrier_candidates static registry exposes barrier point geometry columns", async () => {
    const registry = new ImportReviewCandidateColumnRegistry({} as never);
    const columns = await registry.getColumns("import_review.routing_barrier_candidates");
    assert.equal(columns.has("barrier_type"), true);
    assert.equal(columns.has("point_geom"), true);
    assert.equal(columns.has("geom"), false);
});

test("effectiveAdminAreaIdExpr omits physical column when unavailable", () => {
    const withColumn = effectiveAdminAreaIdExpr("l", { hasAdminAreaColumn: true }).strings.join("?");
    const withoutColumn = effectiveAdminAreaIdExpr("l", { hasAdminAreaColumn: false }).strings.join("?");

    assert.match(withColumn, /l\.admin_area_id/);
    assert.doesNotMatch(withoutColumn, /l\.admin_area_id/);
    assert.match(withoutColumn, /normalized_data/);
});

test("landAreaClassCodeEffectiveExpr uses class_code and overrides only", () => {
    const expr = landAreaClassCodeEffectiveExpr("l").strings.join("?");
    assert.match(expr, /l\.class_code/);
    assert.doesNotMatch(expr, /admin_area_id/);
});
