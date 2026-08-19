import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    appendCoreReviewVerificationSets,
    isVerifiedFromVerificationStatus,
    resolveCoreReviewVerificationWrite,
} from "./core-review-verification-write.js";

describe("core-review verification write helpers", () => {
    it("isVerifiedFromVerificationStatus is true only for verified", () => {
        assert.equal(isVerifiedFromVerificationStatus("verified"), true);
        assert.equal(isVerifiedFromVerificationStatus("unverified"), false);
        assert.equal(isVerifiedFromVerificationStatus("needs_fix"), false);
        assert.equal(isVerifiedFromVerificationStatus("questionable"), false);
        assert.equal(isVerifiedFromVerificationStatus("rejected_after_core_review"), false);
    });

    it("resolveCoreReviewVerificationWrite derives is_verified from verification_status", () => {
        assert.deepEqual(resolveCoreReviewVerificationWrite({ verification_status: "verified" }), {
            verificationStatus: "verified",
            isVerified: true,
        });
        assert.deepEqual(resolveCoreReviewVerificationWrite({ verification_status: "unverified" }), {
            verificationStatus: "unverified",
            isVerified: false,
        });
        assert.deepEqual(resolveCoreReviewVerificationWrite({ verification_status: "needs_fix" }), {
            verificationStatus: "needs_fix",
            isVerified: false,
        });
        assert.deepEqual(resolveCoreReviewVerificationWrite({ verification_status: "questionable" }), {
            verificationStatus: "questionable",
            isVerified: false,
        });
        assert.deepEqual(
            resolveCoreReviewVerificationWrite({ verification_status: "rejected" }),
            {
                verificationStatus: "rejected_after_core_review",
                isVerified: false,
            },
        );
    });

    it("defaults to unverified when verification_status is omitted on create", () => {
        assert.deepEqual(resolveCoreReviewVerificationWrite({}), {
            verificationStatus: "unverified",
            isVerified: false,
        });
    });

    it("prefers verification_status over accidental is_verified in raw body", () => {
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

    it("appendCoreReviewVerificationSets writes only the authoritative status", () => {
        const sets: import("@prisma/client").Prisma.Sql[] = [];
        appendCoreReviewVerificationSets(sets, { verification_status: "verified" });
        assert.equal(sets.length, 1);
    });
});
