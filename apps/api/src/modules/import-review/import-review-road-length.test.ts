import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRoadAdminAreaJoins, roadsExplicitAdminAreaIdExpr } from "./import-review-road-admin-area-sql.js";
import { effectiveRoadLengthMExpr, geomSourceExpr } from "./import-review-promotion-promote-sql.js";

describe("import-review road admin area SQL helpers", () => {
    it("does not reference road_candidates.admin_area_id column", () => {
        const explicitSql = roadsExplicitAdminAreaIdExpr("r").strings.join(" ");
        const joinSql = buildRoadAdminAreaJoins("r").strings.join(" ");

        assert.doesNotMatch(explicitSql, /\br\.admin_area_id\b/);
        assert.doesNotMatch(joinSql, /\br\.admin_area_id\b/);
        assert.match(joinSql, /LEFT JOIN LATERAL/i);
        assert.match(joinSql, /ST_Intersects/i);
        assert.match(joinSql, /ST_Area/i);
    });
});

describe("import-review road length SQL helpers", () => {
    it("exports effectiveRoadLengthMExpr using geography length in meters", () => {
        const lengthSql = effectiveRoadLengthMExpr("r").strings.join(" ");
        const geomSql = geomSourceExpr("r").strings.join(" ");

        assert.match(lengthSql, /ST_Length/);
        assert.match(lengthSql, /geography/);
        assert.match(lengthSql, /ROUND/);
        assert.match(geomSql, /review_overrides/);
        assert.match(geomSql, /ST_GeomFromGeoJSON/);
    });
});
