import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IMPORT_REVIEW_PROMOTION_TARGETS } from "./import-review-promotion-config.js";
import {
    assertBusFamilyCannotPromote,
    assertPromotionNotBlocked,
    assertPromotionWarningConfirmationAllowed,
    getImportReviewPromotionTargetTable,
    promotionFamilyStagesForBatch,
    resolvePromotionWarningNote,
} from "./import-review-promotion-promote-api.js";

describe("import-review-promotion-promote-api", () => {
    it("maps buildings promotion target to core.core_map_buildings", () => {
        assert.equal(getImportReviewPromotionTargetTable("buildings"), "core.core_map_buildings");
        assert.equal(IMPORT_REVIEW_PROMOTION_TARGETS.buildings, "core.core_map_buildings");
    });

    it("maps places promotion target to core.core_places", () => {
        assert.equal(getImportReviewPromotionTargetTable("places"), "core.core_places");
    });

    it("maps routing_barriers promotion target to routing.routing_barriers", () => {
        assert.equal(
            getImportReviewPromotionTargetTable("routing_barriers"),
            "routing.routing_barriers"
        );
    });

    it("requires confirm_warnings and review_note when validation has warnings", () => {
        assert.throws(
            () =>
                assertPromotionWarningConfirmationAllowed(
                    {
                        outcome: "passed",
                        blocked_count: 0,
                        warning_count: 2,
                        can_promote: true,
                        requires_warning_confirmation: true,
                    },
                    { confirm_warnings: false, review_note: "looks ok" }
                ),
            /confirm_warnings=true/
        );
        assert.throws(
            () =>
                assertPromotionWarningConfirmationAllowed(
                    {
                        outcome: "passed",
                        blocked_count: 0,
                        warning_count: 2,
                        can_promote: true,
                        requires_warning_confirmation: true,
                    },
                    { confirm_warnings: true }
                ),
            /review_note/
        );
        assert.doesNotThrow(() =>
            assertPromotionWarningConfirmationAllowed(
                {
                    outcome: "passed",
                    blocked_count: 0,
                    warning_count: 2,
                    can_promote: true,
                    requires_warning_confirmation: true,
                },
                { confirm_warnings: true, review_note: "reviewed warnings" }
            )
        );
    });

    it("resolves review_note alias for warning confirmation", () => {
        assert.equal(
            resolvePromotionWarningNote({
                confirmation_text: "PROMOTE",
                chunk_size: 100,
                confirm_warnings: true,
                review_note: "note from batch create",
                warning_confirmation_note: undefined,
            }),
            "note from batch create"
        );
    });

    it("blocks promotion when validation has blocked items", () => {
        assert.throws(
            () =>
                assertPromotionNotBlocked({
                    outcome: "blocked",
                    blocked_count: 3,
                    warning_count: 0,
                    can_promote: false,
                    requires_warning_confirmation: false,
                }),
            /blocked/
        );
    });

    it("bus family cannot promote via publish batch", () => {
        assert.throws(() => assertBusFamilyCannotPromote("bus_stops"), /cannot be promoted/);
        assert.equal(getImportReviewPromotionTargetTable("bus_routes"), null);
    });

    it("promotionFamilyStagesForBatch only includes families present in batch", () => {
        const stages = promotionFamilyStagesForBatch(["buildings", "places", "bus_stops"]);
        assert.deepEqual(
            stages.map((s) => s.entityFamily),
            ["buildings", "places"]
        );
    });
});
