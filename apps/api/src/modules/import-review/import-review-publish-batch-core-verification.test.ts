import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    CORE_VERIFICATION_ENTITY_FAMILIES,
    coreVerificationExistsSql,
} from "./import-review-publish-batch-core-verification.js";

describe("publish batch core verification SQL", () => {
    it("covers all promotable entity families without legacy bs.name columns", () => {
        assert.deepEqual(CORE_VERIFICATION_ENTITY_FAMILIES, [
            "buildings",
            "places",
            "landuse",
            "water_lines",
            "water_polygons",
            "roads",
            "admin_areas",
            "routing_barriers",
        ]);
        for (const family of CORE_VERIFICATION_ENTITY_FAMILIES) {
            const sql = coreVerificationExistsSql(family).strings.join("");
            assert.match(sql, /source_refs->>'publish_batch_id'/);
            assert.match(sql, /source_refs->>'review_candidate_id'/);
            assert.doesNotMatch(sql, /\bbs\.name\b/);
        }
        const adminSql = coreVerificationExistsSql("admin_areas").strings.join("");
        assert.match(adminSql, /core_admin_areas/);
        assert.match(adminSql, /core_admin_area_names/);
        const barrierSql = coreVerificationExistsSql("routing_barriers").strings.join("");
        assert.match(barrierSql, /routing_barriers/);
        assert.match(barrierSql, /routing_barrier_dry_run/);
    });
});
