import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    assertCandidateEligibleForPromotion,
    ImportTransportPromotionBlockedError,
    ImportTransportPromotionWarningConfirmationRequiredError,
} from "./import-transport-promotion-eligibility.js";

describe("import-transport promotion eligibility", () => {
    it("allows promotion when validation_status is valid", () => {
        assert.doesNotThrow(() =>
            assertCandidateEligibleForPromotion({
                validation_status: "valid",
                review_note: null,
            })
        );
    });

    it("blocks promotion when validation_status is blocked", () => {
        assert.throws(
            () =>
                assertCandidateEligibleForPromotion({
                    validation_status: "blocked",
                    review_note: "Checked",
                }),
            (err: unknown) => {
                assert.ok(err instanceof ImportTransportPromotionBlockedError);
                assert.equal(err.validationStatus, "blocked");
                return true;
            }
        );
    });

    it("requires review note when validation_status is warning", () => {
        assert.throws(
            () =>
                assertCandidateEligibleForPromotion({
                    validation_status: "warning",
                    review_note: "",
                }),
            (err: unknown) => err instanceof ImportTransportPromotionWarningConfirmationRequiredError
        );
    });

    it("allows promotion when warning status has review note", () => {
        assert.doesNotThrow(() =>
            assertCandidateEligibleForPromotion({
                validation_status: "warning",
                review_note: "Accepted missing stop code for legacy feed.",
            })
        );
    });

    it("blocks promotion when validation_status is not_validated", () => {
        assert.throws(
            () =>
                assertCandidateEligibleForPromotion({
                    validation_status: "not_validated",
                }),
            (err: unknown) => err instanceof ImportTransportPromotionBlockedError
        );
    });
});
