import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    coreReviewCreateSettlementSchema,
    coreReviewPatchSettlementSchema,
} from "./core-review-write.schema.js";

describe("core-review settlement write schema", () => {
    it("requires type, canonical name, and a point on create", () => {
        const parsed = coreReviewCreateSettlementSchema.safeParse({
            canonicalName: "Kyauktan",
            settlementType: "village",
            geometry: { type: "Point", coordinates: [96.32, 16.73] },
        });
        assert.equal(parsed.success, true);
    });

    it("rejects create without a point", () => {
        const parsed = coreReviewCreateSettlementSchema.safeParse({
            canonical_name: "Kyauktan",
            settlement_type: "village",
        });
        assert.equal(parsed.success, false);
    });

    it("allows a patch of names and verification only", () => {
        const parsed = coreReviewPatchSettlementSchema.safeParse({
            name_mm: "ကျောက်တန်း",
            verification_status: "verified",
        });
        assert.equal(parsed.success, true);
    });
});
