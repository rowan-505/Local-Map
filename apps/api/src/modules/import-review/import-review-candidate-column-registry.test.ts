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

test("bus_route_candidates static registry exposes route metadata without geometry", async () => {
    const registry = new ImportReviewCandidateColumnRegistry({} as never);
    const columns = await registry.getColumns("import_review.bus_route_candidates");
    assert.equal(columns.has("route_code"), true);
    assert.equal(columns.has("public_name"), true);
    assert.equal(columns.has("operator_name"), true);
    assert.equal(columns.has("geom"), false);
});

test("bus_route_variant_candidates static registry exposes route dependency and line geometry columns", async () => {
    const registry = new ImportReviewCandidateColumnRegistry({} as never);
    const columns = await registry.getColumns("import_review.bus_route_variant_candidates");
    assert.equal(columns.has("route_id"), true);
    assert.equal(columns.has("route_code"), true);
    assert.equal(columns.has("variant_code"), true);
    assert.equal(columns.has("geom"), true);
    assert.equal(columns.has("distance_m"), true);
});

test("bus_route_stop_candidates static registry exposes relation dependency columns without geometry", async () => {
    const registry = new ImportReviewCandidateColumnRegistry({} as never);
    const columns = await registry.getColumns("import_review.bus_route_stop_candidates");
    assert.equal(columns.has("route_variant_id"), true);
    assert.equal(columns.has("stop_id"), true);
    assert.equal(columns.has("stop_sequence"), true);
    assert.equal(columns.has("distance_from_start_m"), true);
    assert.equal(columns.has("is_timing_point"), true);
    assert.equal(columns.has("geom"), false);
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
