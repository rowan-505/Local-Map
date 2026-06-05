import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getImportReviewEntityConfig } from "./import-review-config.js";
import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { buildCandidateWhereClause } from "./import-review-candidate-sql.js";

function whereSql(family: ImportReviewEntityFamilySlug, filters: Parameters<typeof buildCandidateWhereClause>[2]) {
    const config = getImportReviewEntityConfig(family);
    return buildCandidateWhereClause(config, 1n, filters).strings.join(" ");
}

describe("promotion_state list filters", () => {
    it("all_active hides promoted and stale batched but keeps not_ready", () => {
        const sql = whereSql("roads", { promotion_state: "all_active" });
        assert.match(sql, /promotion_status = 'promoted'/i);
        assert.match(sql, /promotion_status IS DISTINCT FROM 'batched'/i);
        assert.match(sql, /spb\.status IN/i);
    });

    it("retry_needed matches failed publish items and not promoted", () => {
        const sql = whereSql("places", { promotion_state: "retry_needed" });
        assert.match(sql, /publish_status = 'failed'/i);
        assert.doesNotMatch(sql, /promotion_status = 'not_ready'/);
    });

    it("active_locked requires batched and active batch status", () => {
        const sql = whereSql("buildings", { promotion_state: "active_locked" });
        assert.match(sql, /promotion_status.*=.*'batched'/i);
        assert.match(sql, /spb\.status IN/i);
    });

    it("promoted filter includes promoted rows only", () => {
        const sql = whereSql("addresses", { promotion_state: "promoted" });
        assert.match(sql, /promotion_status.*=.*'promoted'/i);
    });
});
