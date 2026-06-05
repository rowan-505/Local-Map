import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ROAD_PROMOTE_GEOM_COLUMN,
    ROAD_PROMOTE_SRC_ALIAS,
    roadReadyFieldExprs,
} from "./import-review-promotion-promote-roads-sql.js";

describe("roadReadyFieldExprs publish promotion SQL", () => {
    it("uses src/ready alias and candidate_geom for promotion CTEs", () => {
        const sql = roadReadyFieldExprs(24n, ROAD_PROMOTE_SRC_ALIAS, "safe_to_promote", "{}").strings.join(
            " "
        );
        assert.match(sql, /\bs\.candidate_geom\b/);
        assert.match(sql, /\bs\.road_class_id\b/);
        assert.doesNotMatch(sql, /\br\.geom\b/);
        assert.doesNotMatch(sql, /\br\.road_class_id\b/);
        assert.equal(ROAD_PROMOTE_GEOM_COLUMN, "candidate_geom");
    });
});
