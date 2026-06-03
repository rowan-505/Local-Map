import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY } from "./import-review-promotion-simple-config.js";
import {
    classifyPublishItemsForPromotion,
    type PublishItemValidationRow,
} from "./import-review-promotion-execution.js";
import {
    assertBusFamilyCannotPromote,
    assertPromotionNotBlocked,
    assertPromotionWarningConfirmationAllowed,
    buildPromotionPreflightFromItemSelection,
    getImportReviewPromotionTargetTable,
    promotionFamilyStagesForBatch,
    resolvePromotionWarningNote,
} from "./import-review-promotion-promote-api.js";

function itemRow(id: number, status: string): PublishItemValidationRow {
    return {
        publish_item_id: BigInt(id),
        validation_result: {
            status,
            errors: status === "blocked" ? [{ code: "x", message: "blocked", severity: "error" }] : [],
            warnings: status === "warning" ? [{ code: "w", message: "warn", severity: "warning" }] : [],
            issues: [],
        },
    };
}

describe("import-review-promotion-promote-api", () => {
    it("maps buildings promotion target to core.core_map_buildings", () => {
        assert.equal(getImportReviewPromotionTargetTable("buildings"), "core.core_map_buildings");
        assert.equal(
            IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.buildings.targetSchema,
            "core"
        );
        assert.equal(
            IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.buildings.targetTable,
            "core_map_buildings"
        );
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

    it("requires confirm_warnings and promotion_note when validation has warnings", () => {
        assert.throws(
            () =>
                assertPromotionWarningConfirmationAllowed(
                    {
                        outcome: "passed",
                        blocked_count: 0,
                        warning_count: 2,
                        ready_count: 0,
                        promotable_count: 2,
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
                        ready_count: 0,
                        promotable_count: 2,
                        can_promote: true,
                        requires_warning_confirmation: true,
                    },
                    { confirm_warnings: true }
                ),
            /promotion_note/
        );
        assert.doesNotThrow(() =>
            assertPromotionWarningConfirmationAllowed(
                {
                    outcome: "passed",
                    blocked_count: 0,
                    warning_count: 2,
                    ready_count: 0,
                    promotable_count: 2,
                    can_promote: true,
                    requires_warning_confirmation: true,
                },
                { confirm_warnings: true, promotion_note: "reviewed warnings" }
            )
        );
    });

    it("resolves promotion_note for warning confirmation", () => {
        assert.equal(
            resolvePromotionWarningNote({
                confirmation_text: "PROMOTE",
                chunk_size: 100,
                confirm_warnings: true,
                promotion_note: "note from batch create",
                warning_confirmation_note: undefined,
                review_note: undefined,
            }),
            "note from batch create"
        );
    });

    it("blocks promotion when validation has no promotable items", () => {
        assert.throws(
            () =>
                assertPromotionNotBlocked({
                    outcome: "blocked",
                    blocked_count: 3,
                    warning_count: 0,
                    ready_count: 0,
                    promotable_count: 0,
                    can_promote: false,
                    requires_warning_confirmation: false,
                }),
            /no promotable/
        );
    });

    it("allows promotion when validation is partial with promotable items", () => {
        assert.doesNotThrow(() =>
            assertPromotionNotBlocked({
                outcome: "partial",
                blocked_count: 2,
                warning_count: 0,
                ready_count: 35,
                promotable_count: 35,
                can_promote: true,
                requires_warning_confirmation: false,
            })
        );
    });

    it("allows promotion when stale summary has can_promote=false but items are ready", () => {
        const rows: PublishItemValidationRow[] = [];
        for (let i = 1; i <= 35; i += 1) {
            rows.push(itemRow(i, "ready"));
        }
        rows.push(itemRow(36, "blocked"), itemRow(37, "blocked"));
        const selection = classifyPublishItemsForPromotion(rows);
        const preflight = buildPromotionPreflightFromItemSelection(rows, selection);
        assert.equal(preflight.promotable_count, 35);
        assert.equal(preflight.blocked_count, 2);
        assert.equal(preflight.outcome, "partial");
        assert.doesNotThrow(() =>
            assertPromotionNotBlocked({
                ...preflight,
                can_promote: false,
                outcome: "blocked",
            })
        );
    });

    it("0 ready + 2 blocked cannot promote", () => {
        const rows = [itemRow(1, "blocked"), itemRow(2, "blocked")];
        const selection = classifyPublishItemsForPromotion(rows);
        const preflight = buildPromotionPreflightFromItemSelection(rows, selection);
        assert.equal(preflight.promotable_count, 0);
        assert.throws(() => assertPromotionNotBlocked(preflight), /no promotable/);
    });

    it("ready + warning + blocked promotes ready only without confirmation", () => {
        const rows = [itemRow(1, "ready"), itemRow(2, "warning"), itemRow(3, "blocked")];
        const selection = classifyPublishItemsForPromotion(rows, { confirm_warnings: false });
        assert.deepEqual(selection.promotableIds, [1n]);
        assert.equal(selection.skipped_blocked_count, 1);
        assert.equal(selection.skipped_warning_count, 1);
    });

    it("ready + warning + blocked promotes warning with confirmation note", () => {
        const rows = [itemRow(1, "ready"), itemRow(2, "warning"), itemRow(3, "blocked")];
        const selection = classifyPublishItemsForPromotion(rows, {
            confirm_warnings: true,
            promotion_note: "reviewed",
        });
        assert.deepEqual(selection.promotableIds.map(String), ["1", "2"]);
        const preflight = buildPromotionPreflightFromItemSelection(rows, selection);
        assert.doesNotThrow(() =>
            assertPromotionWarningConfirmationAllowed(preflight, {
                confirm_warnings: true,
                promotion_note: "reviewed",
            })
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
