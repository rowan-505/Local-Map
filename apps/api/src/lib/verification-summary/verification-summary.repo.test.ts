import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    effectiveVerificationStatusExpr,
    verificationSummaryCountSelect,
    verificationSummarySupport,
} from "./verification-summary.repo.js";
import type { VerificationSummaryCaps } from "./verification-summary.types.js";

function caps(input: {
    verificationStatus?: boolean;
    isVerified?: boolean;
    deletedAt?: boolean;
}): VerificationSummaryCaps {
    const columns = new Set<string>();
    if (input.verificationStatus) {
        columns.add("verification_status");
    }
    if (input.isVerified) {
        columns.add("is_verified");
    }
    if (input.deletedAt) {
        columns.add("deleted_at");
    }
    return {
        columns,
        hasVerificationStatus: input.verificationStatus === true,
        hasIsVerified: input.isVerified === true,
        hasDeletedAt: input.deletedAt === true,
        hasColumn: (column: string) => columns.has(column),
    };
}

describe("verification-summary.repo", () => {
    it("supports counting when verification_status is present", () => {
        const support = verificationSummarySupport(caps({ verificationStatus: true, isVerified: true }));
        assert.equal(support.verification_supported, true);
        assert.equal(support.unsupported_reason, null);
    });

    it("supports is_verified-only tables as legacy fallback", () => {
        const support = verificationSummarySupport(caps({ isVerified: true }));
        assert.equal(support.verification_supported, true);
        assert.ok(verificationSummaryCountSelect(caps({ isVerified: true })));
    });

    it("marks tables without verification columns unsupported", () => {
        const support = verificationSummarySupport(caps({}));
        assert.equal(support.verification_supported, false);
        assert.equal(verificationSummaryCountSelect(caps({})), null);
    });

    it("uses verification_status with is_verified fallback in effective status SQL", () => {
        const sql = effectiveVerificationStatusExpr(
            caps({ verificationStatus: true, isVerified: true })
        ).strings.join("");
        assert.match(sql, /verification_status/);
        assert.match(sql, /is_verified/);
        assert.match(sql, /COALESCE/);
    });

    it("counts all canonical verification_status buckets", () => {
        const sql = verificationSummaryCountSelect(
            caps({ verificationStatus: true, isVerified: true })
        )!.strings.join("");
        assert.match(sql, /needs_fix/);
        assert.match(sql, /questionable/);
        assert.match(sql, /rejected_after_core_review/);
        assert.doesNotMatch(sql, /is_verified IS TRUE/);
        assert.doesNotMatch(sql, /is_verified IS NOT TRUE/);
    });
});
