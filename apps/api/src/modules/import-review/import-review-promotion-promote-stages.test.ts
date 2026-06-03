import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildPromotionStagePlan,
    PROMOTION_STAGE_FINAL,
    PROMOTION_STAGE_MARK_IMPORTED,
    PROMOTION_STAGE_PREFLIGHT,
    PROMOTION_STAGE_VERIFY_CORE,
    resolvePromotionStageFamilies,
} from "./import-review-promotion-promote-stages.js";

function row(id: number, status: string): { publish_item_id: bigint; validation_result: unknown } {
    return {
        publish_item_id: BigInt(id),
        validation_result: {
            status,
            errors: status === "blocked" ? [{ code: "x", message: "blocked", severity: "error" }] : [],
            warnings: [],
            issues: [],
        },
    };
}

describe("buildPromotionStagePlan", () => {
    it("places-only batch seeds only places promotion stage among family stages", () => {
        const plan = buildPromotionStagePlan(["places"]);
        const familyKeys = plan.familyStages.map((s) => s.key);
        assert.deepEqual(familyKeys, ["promote_places_to_core"]);
        assert.equal(plan.stages.some((s) => s.key === "promote_buildings_to_core"), false);
        assert.equal(plan.stages.some((s) => s.key === PROMOTION_STAGE_PREFLIGHT), true);
        assert.equal(plan.stages.some((s) => s.key === PROMOTION_STAGE_MARK_IMPORTED), true);
        assert.equal(plan.stages.some((s) => s.key === PROMOTION_STAGE_VERIFY_CORE), true);
        assert.equal(plan.stages.some((s) => s.key === PROMOTION_STAGE_FINAL), true);
        assert.equal(plan.stages.some((s) => s.key === "load_promotable_items"), false);
        assert.equal(plan.stages.some((s) => s.key === "write_publish_item_results"), false);
    });

    it("multi-family batch seeds only selected families in config order", () => {
        const plan = buildPromotionStagePlan(["places", "buildings"]);
        assert.deepEqual(
            plan.familyStages.map((s) => s.entityFamily),
            ["buildings", "places"]
        );
        assert.equal(plan.familyStages.length, 2);
    });

    it("zero-count family stage is not created", () => {
        const plan = buildPromotionStagePlan(["places"]);
        assert.equal(plan.stages.some((s) => s.key === "promote_landuse_to_core"), false);
        assert.equal(plan.stages.some((s) => s.key === "promote_roads_to_core"), false);
    });
});

describe("resolvePromotionStageFamilies", () => {
    it("includes only families with promotable pending items", () => {
        const pendingRows = [
            ...Array.from({ length: 3 }, (_, i) => row(i + 1, "ready")),
            row(4, "blocked"),
        ];
        const items = [
            { publish_item_id: 1n, entity_family: "places" },
            { publish_item_id: 2n, entity_family: "places" },
            { publish_item_id: 3n, entity_family: "places" },
            { publish_item_id: 4n, entity_family: "places" },
            { publish_item_id: 5n, entity_family: "buildings" },
        ];
        const families = resolvePromotionStageFamilies(pendingRows, items);
        assert.deepEqual(families, ["places"]);
    });
});
