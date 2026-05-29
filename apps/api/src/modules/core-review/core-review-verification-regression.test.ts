import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    coreReviewVerificationFilterCondition,
    normalizeCoreReviewVerificationStatus,
    resolveCoreReviewVerificationFilter,
} from "./core-review-verification-filter.js";
import { resolveCoreReviewVerificationWrite } from "./core-review-verification-write.js";
import {
    mapCoreReviewBuildingPatch,
    mapCoreReviewPlacePatch,
} from "./core-review-write.mappers.js";
import { sanitizeCoreReviewWriteBody } from "./core-review-write.schema.js";

describe("core-review verification regression", () => {
    it("saving verification_status verified derives is_verified true", () => {
        const result = resolveCoreReviewVerificationWrite({ verification_status: "verified" });
        assert.equal(result.verificationStatus, "verified");
        assert.equal(result.isVerified, true);
    });

    it("saving verification_status needs_fix derives is_verified false", () => {
        const result = resolveCoreReviewVerificationWrite({ verification_status: "needs_fix" });
        assert.equal(result.verificationStatus, "needs_fix");
        assert.equal(result.isVerified, false);
    });

    it("verification_status filter resolves supported list statuses", () => {
        for (const status of [
            "unverified",
            "verified",
            "needs_fix",
            "questionable",
            "rejected_after_core_review",
        ] as const) {
            assert.deepEqual(resolveCoreReviewVerificationFilter({ verificationStatus: status }), {
                verificationStatus: status,
            });
        }
    });

    it("verification_status filter normalizes rejected alias", () => {
        assert.equal(normalizeCoreReviewVerificationStatus("rejected"), "rejected_after_core_review");
        assert.deepEqual(
            resolveCoreReviewVerificationFilter({
                verificationStatus: normalizeCoreReviewVerificationStatus("rejected"),
            }),
            { verificationStatus: "rejected_after_core_review" }
        );
    });

    it("verification_status filter generates SQL conditions", () => {
        const verified = coreReviewVerificationFilterCondition("b", { verificationStatus: "verified" });
        const needsFix = coreReviewVerificationFilterCondition("b", { verificationStatus: "needs_fix" });
        const rejected = coreReviewVerificationFilterCondition("b", {
            verificationStatus: "rejected_after_core_review",
        });

        assert.ok(verified);
        assert.ok(needsFix);
        assert.ok(rejected);

        const verifiedSql = verified!.strings.join("");
        const needsFixSql = needsFix!.strings.join("");
        const rejectedSql = rejected!.strings.join("");

        assert.match(verifiedSql, /verification_status|is_verified/);
        assert.match(needsFixSql, /\.verification_status =/);
        assert.match(rejectedSql, /\.verification_status =/);
        assert.equal(resolveCoreReviewVerificationFilter({}), undefined);
    });

    it("write mappers map verification_status only, not user is_verified", () => {
        const buildingPatch = mapCoreReviewBuildingPatch({
            is_verified: true,
            verification_status: "needs_fix",
        });
        assert.equal("is_verified" in buildingPatch, false);
        assert.equal(buildingPatch.verification_status, "needs_fix");

        const placePatch = mapCoreReviewPlacePatch({
            isVerified: true,
            verificationStatus: "verified",
        });
        assert.equal("isVerified" in placePatch, false);
        assert.equal("is_verified" in placePatch, false);
        assert.equal(placePatch.verificationStatus, "verified");
    });

    it("sanitizeCoreReviewWriteBody strips direct is_verified writes", () => {
        const sanitized = sanitizeCoreReviewWriteBody({
            verification_status: "verified",
            is_verified: true,
            isVerified: false,
        }) as Record<string, unknown>;
        assert.equal("is_verified" in sanitized, false);
        assert.equal("isVerified" in sanitized, false);
        assert.equal(sanitized.verification_status, "verified");
    });

    it("resolveCoreReviewVerificationWrite ignores user is_verified when status is present", () => {
        assert.deepEqual(
            resolveCoreReviewVerificationWrite({
                verification_status: "needs_fix",
                is_verified: true,
            }),
            {
                verificationStatus: "needs_fix",
                isVerified: false,
            },
        );
    });
});
