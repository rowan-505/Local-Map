import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    canPromotePublishItem,
    parsePublishItemValidationResult,
    publishItemPromotionBlockReason,
} from "./import-review-promotion-publish-item-validation.js";

describe("import-review-promotion-publish-item-validation authority", () => {
    it("stale candidate validation_errors do not block when publish item validation_result is ready", () => {
        const staleCandidateErrors = [
            { code: "GEOMETRY_INVALID", message: "bad geom", severity: "error" },
        ];
        assert.equal(staleCandidateErrors.length > 0, true);

        const publishValidation = {
            status: "ready",
            errors: [],
            warnings: [],
            issues: [],
        };
        assert.equal(canPromotePublishItem(publishValidation), true);
        assert.equal(
            publishItemPromotionBlockReason(publishValidation),
            null
        );
    });

    it("blocked publish item cannot promote", () => {
        const publishValidation = {
            status: "blocked",
            errors: [{ code: "missing_geom", message: "geom required", severity: "error" }],
            warnings: [],
        };
        assert.equal(canPromotePublishItem(publishValidation), false);
        assert.match(
            publishItemPromotionBlockReason(publishValidation) ?? "",
            /blocked/
        );
    });

    it("warning publish item needs confirmation and promotion note", () => {
        const publishValidation = {
            status: "warning",
            errors: [],
            warnings: [{ code: "low_confidence", message: "low", severity: "warning" }],
        };
        assert.equal(canPromotePublishItem(publishValidation), false);
        assert.match(
            publishItemPromotionBlockReason(publishValidation) ?? "",
            /confirm_warnings/
        );
        assert.equal(
            canPromotePublishItem(publishValidation, { confirm_warnings: true }),
            false
        );
        assert.match(
            publishItemPromotionBlockReason(publishValidation, { confirm_warnings: true }) ?? "",
            /promotion note/
        );
        assert.equal(
            canPromotePublishItem(publishValidation, {
                confirm_warnings: true,
                promotion_note: "Reviewed warnings",
            }),
            true
        );
    });

    it("ready publish item promotes without confirmation", () => {
        const publishValidation = {
            status: "ready",
            errors: [],
            warnings: [],
        };
        assert.equal(canPromotePublishItem(publishValidation), true);
        assert.equal(
            canPromotePublishItem(publishValidation, { confirm_warnings: false }),
            true
        );
    });

    it("legacy valid status is treated as ready", () => {
        const parsed = parsePublishItemValidationResult({ status: "valid", errors: [], warnings: [] });
        assert.equal(parsed.status, "valid");
        assert.equal(canPromotePublishItem({ status: "valid", errors: [], warnings: [] }), true);
    });
});
