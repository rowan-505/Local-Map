import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getImportReviewPromotionTargetTable } from "./import-review-promotion-promote-api.js";
import {
    canPromotePublishItem,
    publishItemPromotionBlockReason,
} from "./import-review-promotion-publish-item-validation.js";
import {
    listAllSimplePromotionTargetMappings,
    resolveSimplePromotionTarget,
} from "./import-review-promotion-simple-promote.js";
import { IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY } from "./import-review-promotion-simple-config.js";

describe("import-review-promotion-simple-promote targets", () => {
    it("maps every simple promotion family to schema.table", () => {
        const mappings = listAllSimplePromotionTargetMappings();
        assert.equal(mappings.length, 9);
        for (const row of mappings) {
            assert.equal(row.target_qualified, `${row.target_schema}.${row.target_table}`);
            assert.match(row.candidate_table, /^import_review\./);
        }
    });

    it("places → core.core_places", () => {
        const t = resolveSimplePromotionTarget("places");
        assert.ok(t);
        assert.equal(t.target_qualified, "core.core_places");
        assert.equal(getImportReviewPromotionTargetTable("places"), "core.core_places");
    });

    it("buildings → core.core_buildings", () => {
        assert.equal(resolveSimplePromotionTarget("buildings")?.target_qualified, "core.core_buildings");
    });

    it("roads → core.core_streets", () => {
        assert.equal(resolveSimplePromotionTarget("roads")?.target_qualified, "core.core_streets");
    });

    it("landuse → core.core_land_areas", () => {
        assert.equal(resolveSimplePromotionTarget("land_areas")?.target_qualified, "core.core_land_areas");
    });

    it("water_lines → core.core_water_lines", () => {
        assert.equal(resolveSimplePromotionTarget("water_lines")?.target_qualified, "core.core_water_lines");
    });

    it("water_polygons → core.core_water_polygons", () => {
        assert.equal(
            resolveSimplePromotionTarget("water_polygons")?.target_qualified,
            "core.core_water_polygons"
        );
    });

    it("admin_areas → core.core_admin_areas", () => {
        assert.equal(resolveSimplePromotionTarget("admin_areas")?.target_qualified, "core.core_admin_areas");
    });

    it("routing_barriers → routing.routing_barriers", () => {
        const t = resolveSimplePromotionTarget("routing_barriers");
        assert.ok(t);
        assert.equal(t.target_schema, "routing");
        assert.equal(t.target_table, "routing_barriers");
        assert.equal(t.target_qualified, "routing.routing_barriers");
        assert.equal(getImportReviewPromotionTargetTable("routing_barriers"), "routing.routing_barriers");
        const cfg = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.routing_barriers;
        assert.equal(cfg.targetSchema, "routing");
        assert.equal(cfg.targetTable, "routing_barriers");
    });

    it("addresses → core.core_addresses", () => {
        assert.equal(resolveSimplePromotionTarget("addresses")?.target_qualified, "core.core_addresses");
    });
});

describe("import-review-promotion-simple-promote publish-item gate", () => {
    it("promotes ready items without note", () => {
        assert.equal(canPromotePublishItem({ status: "ready", errors: [], warnings: [] }), true);
    });

    it("blocks warning items without confirm_warnings and promotion_note", () => {
        const vr = { status: "warning", errors: [], warnings: [{ code: "x", message: "y" }] };
        assert.equal(canPromotePublishItem(vr, { confirm_warnings: false }), false);
        assert.match(
            publishItemPromotionBlockReason(vr, { confirm_warnings: false }) ?? "",
            /confirm_warnings/
        );
    });

    it("allows warning items with confirm_warnings and promotion_note", () => {
        const vr = { status: "warning", errors: [], warnings: [{ code: "x", message: "y" }] };
        assert.equal(
            canPromotePublishItem(vr, {
                confirm_warnings: true,
                promotion_note: "reviewed",
            }),
            true
        );
    });

    it("blocks blocked items", () => {
        const vr = { status: "blocked", errors: [{ code: "x", message: "y" }], warnings: [] };
        assert.equal(canPromotePublishItem(vr), false);
    });
});
