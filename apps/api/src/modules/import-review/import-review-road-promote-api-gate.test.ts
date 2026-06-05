import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ROAD_API_BULK_PROMOTION_ENV_VAR } from "./import-review-config.js";
import { resolveRoadPromoteApiAllowed } from "./import-review-road-promotion-gates.js";

describe("resolveRoadPromoteApiAllowed", () => {
    const okRequest = {
        allow_high_risk_families: true,
        confirm_large_batch: true,
    };

    it("allows when all env flags and confirmations are satisfied", () => {
        const result = resolveRoadPromoteApiAllowed({
            envEnabled: true,
            apiBulkAllowed: true,
            sqlBulkRecommended: true,
            validationPassed: true,
            batchDryRunDone: true,
            promoteRequest: okRequest,
        });
        assert.equal(result.allowed, true);
        assert.equal(result.message, null);
    });

    it("blocks when dry-run not passed", () => {
        const result = resolveRoadPromoteApiAllowed({
            envEnabled: true,
            apiBulkAllowed: true,
            sqlBulkRecommended: true,
            validationPassed: true,
            batchDryRunDone: false,
            promoteRequest: okRequest,
        });
        assert.equal(result.allowed, false);
        assert.equal(result.message, "Run batch dry-run after validation before promotion.");
    });

    it("blocks when high-risk confirmation missing", () => {
        const result = resolveRoadPromoteApiAllowed({
            envEnabled: true,
            apiBulkAllowed: true,
            sqlBulkRecommended: true,
            validationPassed: true,
            batchDryRunDone: true,
            promoteRequest: { allow_high_risk_families: false, confirm_large_batch: true },
        });
        assert.equal(result.allowed, false);
        assert.equal(result.message, "Check high-risk confirmation.");
    });

    it("blocks when large-batch confirmation missing", () => {
        const result = resolveRoadPromoteApiAllowed({
            envEnabled: true,
            apiBulkAllowed: true,
            sqlBulkRecommended: true,
            validationPassed: true,
            batchDryRunDone: true,
            promoteRequest: { allow_high_risk_families: true, confirm_large_batch: false },
        });
        assert.equal(result.allowed, false);
        assert.equal(result.message, "Check large-batch confirmation.");
    });

    it("blocks large batch when API bulk env flag is off", () => {
        const result = resolveRoadPromoteApiAllowed({
            envEnabled: true,
            apiBulkAllowed: false,
            sqlBulkRecommended: true,
            validationPassed: true,
            batchDryRunDone: true,
            promoteRequest: okRequest,
        });
        assert.equal(result.allowed, false);
        assert.match(result.message ?? "", /SQL bulk scripts/i);
        assert.match(result.message ?? "", new RegExp(ROAD_API_BULK_PROMOTION_ENV_VAR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });
});
