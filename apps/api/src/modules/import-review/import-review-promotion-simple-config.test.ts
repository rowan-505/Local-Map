import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DISABLED_IMPORT_REVIEW_PROMOTION_FAMILIES } from "./import-review-promotion-config.js";
import {
    IMPORT_REVIEW_SIMPLE_PROMOTION_FAMILIES,
    IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY,
    assertPromotableFamily,
    getPromotionFamilyConfig,
    listPromotableFamilies,
    promotionTargetQualifiedTable,
} from "./import-review-promotion-simple-config.js";
import { ImportReviewTransportPromotionDeprecatedError } from "./import-review-promotion.errors.js";

describe("import-review-promotion-simple-config", () => {
    it("lists nine promotable families in contract order", () => {
        assert.deepEqual(listPromotableFamilies(), [...IMPORT_REVIEW_SIMPLE_PROMOTION_FAMILIES]);
        assert.equal(listPromotableFamilies().length, 9);
    });

    it("targets routing_barriers at routing.routing_barriers", () => {
        const cfg = getPromotionFamilyConfig("routing_barriers");
        assert.ok(cfg);
        assert.equal(promotionTargetQualifiedTable(cfg), "routing.routing_barriers");
    });

    it("requires dry-run for roads and routing_barriers only", () => {
        const dryRunFamilies = listPromotableFamilies().filter(
            (f) => IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY[f].requiresDryRun
        );
        assert.deepEqual(dryRunFamilies.sort(), ["roads", "routing_barriers"]);
    });

    it("marks admin_areas and addresses as high risk", () => {
        const highRisk = listPromotableFamilies().filter(
            (f) => IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY[f].highRisk
        );
        assert.deepEqual(highRisk.sort(), ["addresses", "admin_areas"]);
    });

    it("rejects bus families", () => {
        for (const family of DISABLED_IMPORT_REVIEW_PROMOTION_FAMILIES) {
            assert.equal(getPromotionFamilyConfig(family), null);
            assert.throws(
                () => assertPromotableFamily(family),
                (err: unknown) => err instanceof ImportReviewTransportPromotionDeprecatedError
            );
        }
    });

    it("does not reference review_overrides in column lists", () => {
        for (const family of listPromotableFamilies()) {
            const cfg = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY[family];
            const all = [...cfg.requiredFields, ...cfg.warningFields, ...cfg.promotionColumns];
            assert.equal(all.includes("review_overrides"), false, family);
        }
    });
});
