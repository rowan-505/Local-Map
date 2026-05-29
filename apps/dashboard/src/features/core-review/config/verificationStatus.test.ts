import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    CORE_REVIEW_VERIFICATION_STATUSES,
    formatVerificationStatusLabel,
    getVerificationStatusBadgeVariant,
    isVerifiedFromStatus,
    normalizeVerificationStatus,
    parseVerificationStatusInput,
    verificationStatusOptions,
} from "./verificationStatus.js";

describe("verificationStatus helpers", () => {
    it("defines five canonical statuses with dropdown labels", () => {
        assert.equal(CORE_REVIEW_VERIFICATION_STATUSES.length, 5);
        assert.deepEqual(
            verificationStatusOptions.map((option) => option.label),
            ["Unverified", "Verified", "Needs fix", "Questionable", "Rejected"],
        );
    });

    it("parseVerificationStatusInput accepts rejected alias", () => {
        assert.equal(parseVerificationStatusInput("rejected"), "rejected_after_core_review");
        assert.equal(parseVerificationStatusInput("needs_fix"), "needs_fix");
        assert.equal(parseVerificationStatusInput("invalid"), undefined);
    });

    it("normalizeVerificationStatus prefers valid status over fallback", () => {
        assert.equal(normalizeVerificationStatus("needs_fix", true), "needs_fix");
        assert.equal(normalizeVerificationStatus("", true), "verified");
        assert.equal(normalizeVerificationStatus(null, false), "unverified");
        assert.equal(normalizeVerificationStatus(undefined, undefined), "unverified");
    });

    it("isVerifiedFromStatus is true only for verified", () => {
        assert.equal(isVerifiedFromStatus("verified"), true);
        assert.equal(isVerifiedFromStatus("needs_fix"), false);
        assert.equal(isVerifiedFromStatus(null, true), true);
        assert.equal(isVerifiedFromStatus(null, false), false);
    });

    it("formatVerificationStatusLabel uses normalized status", () => {
        assert.equal(formatVerificationStatusLabel("rejected"), "Rejected");
        assert.equal(formatVerificationStatusLabel(null, true), "Verified");
        assert.equal(formatVerificationStatusLabel(undefined), "Unverified");
    });

    it("getVerificationStatusBadgeVariant maps review lifecycle tones", () => {
        assert.equal(getVerificationStatusBadgeVariant("verified"), "verified");
        assert.equal(getVerificationStatusBadgeVariant("needs_fix"), "confidence-medium");
        assert.equal(getVerificationStatusBadgeVariant("rejected"), "deleted");
        assert.equal(getVerificationStatusBadgeVariant(null), "unverified");
    });
});
