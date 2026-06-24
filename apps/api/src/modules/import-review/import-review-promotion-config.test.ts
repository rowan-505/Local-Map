import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    HIGH_RISK_PROMOTION_FAMILIES,
    IMPORT_REVIEW_PROMOTION_ALLOWED_FAMILIES,
    IMPORT_REVIEW_PROMOTION_TARGETS,
    NORMAL_PROMOTION_FAMILIES,
    VALIDATABLE_PUBLISH_FAMILIES,
    PROMOTABLE_PUBLISH_FAMILIES,
    assertImportReviewPromotionFamilyAllowed,
    isHighRiskPromotionFamily,
    isImportReviewPromotionAllowedFamily,
    isValidatablePublishFamily,
} from "./import-review-promotion-config.js";

describe("import-review-promotion-config", () => {
    it("maps routing_barriers to routing.routing_barriers", () => {
        assert.equal(IMPORT_REVIEW_PROMOTION_TARGETS.routing_barriers, "routing.routing_barriers");
    });

    it("maps all normal families to core.* targets", () => {
        for (const family of NORMAL_PROMOTION_FAMILIES) {
            const target = IMPORT_REVIEW_PROMOTION_TARGETS[family];
            assert.match(target, /^core\./, `${family} must target core.*`);
        }
    });

    it("maps high-risk core families to core.* (except routing_barriers)", () => {
        for (const family of HIGH_RISK_PROMOTION_FAMILIES) {
            if (family === "routing_barriers") {
                continue;
            }
            const target = IMPORT_REVIEW_PROMOTION_TARGETS[family];
            assert.match(target, /^core\./, `${family} must target core.*`);
        }
    });

    it("detects high-risk families", () => {
        assert.equal(isHighRiskPromotionFamily("roads"), true);
        assert.equal(isHighRiskPromotionFamily("routing_barriers"), true);
        assert.equal(isHighRiskPromotionFamily("buildings"), false);
    });

    it("allows normal families", () => {
        assert.doesNotThrow(() => assertImportReviewPromotionFamilyAllowed("places"));
        assert.equal(isImportReviewPromotionAllowedFamily("water_polygons"), true);
    });

    it("validates all allowed promotion families", () => {
        assert.deepEqual(VALIDATABLE_PUBLISH_FAMILIES, IMPORT_REVIEW_PROMOTION_ALLOWED_FAMILIES);
        assert.equal(isValidatablePublishFamily("roads"), true);
        assert.equal(isValidatablePublishFamily("addresses"), true);
    });

    it("includes addresses in promotable publish families", () => {
        assert.equal(
            (PROMOTABLE_PUBLISH_FAMILIES as readonly string[]).includes("addresses"),
            true
        );
    });
});
