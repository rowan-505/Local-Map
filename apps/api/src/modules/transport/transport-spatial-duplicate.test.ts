import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DUPLICATE_NEARBY_RADIUS_M,
    approxExpandDegreesFromMeters,
    isNearbyDuplicateCandidate,
    nearbyDuplicateBboxAndDistanceSql,
} from "./transport-spatial.js";

describe("approxExpandDegreesFromMeters", () => {
    it("matches stop-quality meters/90000 convention", () => {
        assert.equal(approxExpandDegreesFromMeters(50), 50 / 90000);
        assert.equal(approxExpandDegreesFromMeters(30), 30 / 90000);
    });
});

describe("nearbyDuplicateBboxAndDistanceSql", () => {
    it("includes GiST bbox prefilter and geography ST_DWithin", () => {
        const sql = nearbyDuplicateBboxAndDistanceSql();
        assert.match(sql, /s2\.geom && ST_Expand\(s\.geom,/);
        assert.match(sql, /ST_DWithin\(s\.geom::geography, s2\.geom::geography, 50\)/);
        assert.ok(sql.includes(String(approxExpandDegreesFromMeters(DUPLICATE_NEARBY_RADIUS_M))));
    });

    it("supports alternate geom expressions (list has_nearby_duplicate)", () => {
        const sql = nearbyDuplicateBboxAndDistanceSql({
            sourceGeomExpr: "base.geom",
            candidateGeomExpr: "s2.geom",
        });
        assert.match(sql, /s2\.geom && ST_Expand\(base\.geom,/);
        assert.match(sql, /ST_DWithin\(base\.geom::geography, s2\.geom::geography, 50\)/);
    });
});

describe("isNearbyDuplicateCandidate", () => {
    const base = {
        sourceStopId: "1",
        candidateStopId: "2",
        candidateDeleted: false,
        candidateActive: true,
        distanceMeters: 25,
    };

    it("detects duplicate within radius", () => {
        assert.equal(isNearbyDuplicateCandidate(base), true);
        assert.equal(isNearbyDuplicateCandidate({ ...base, distanceMeters: 50 }), true);
    });

    it("excludes outside radius", () => {
        assert.equal(isNearbyDuplicateCandidate({ ...base, distanceMeters: 50.1 }), false);
        assert.equal(isNearbyDuplicateCandidate({ ...base, distanceMeters: 200 }), false);
    });

    it("excludes same stop", () => {
        assert.equal(
            isNearbyDuplicateCandidate({ ...base, candidateStopId: "1" }),
            false,
        );
    });

    it("excludes deleted stop", () => {
        assert.equal(
            isNearbyDuplicateCandidate({ ...base, candidateDeleted: true }),
            false,
        );
    });

    it("excludes inactive when requireActive (default)", () => {
        assert.equal(
            isNearbyDuplicateCandidate({ ...base, candidateActive: false }),
            false,
        );
    });

    it("preserves different-mode behavior when requireSameMode", () => {
        assert.equal(
            isNearbyDuplicateCandidate({
                ...base,
                sourceMode: "bus",
                candidateMode: "ferry",
                requireSameMode: true,
            }),
            false,
        );
        assert.equal(
            isNearbyDuplicateCandidate({
                ...base,
                sourceMode: "bus",
                candidateMode: "bus",
                requireSameMode: true,
            }),
            true,
        );
        // Readiness does not filter by mode — without requireSameMode, mode is ignored.
        assert.equal(
            isNearbyDuplicateCandidate({
                ...base,
                sourceMode: "bus",
                candidateMode: "ferry",
            }),
            true,
        );
    });

    it("excludes null distance (missing geom)", () => {
        assert.equal(
            isNearbyDuplicateCandidate({ ...base, distanceMeters: null }),
            false,
        );
    });
});

describe("generated readiness/list SQL shape", () => {
    it("documents the required bbox+distance clause used in repos", () => {
        // Repos inject ${deg} / ${meters} via Prisma; the semantic fragment must
        // always include ST_Expand before ST_DWithin (audit: ~911ms → ~20ms).
        const fragment = nearbyDuplicateBboxAndDistanceSql();
        const expandIdx = fragment.indexOf("ST_Expand");
        const dwithinIdx = fragment.indexOf("ST_DWithin");
        assert.ok(expandIdx >= 0 && dwithinIdx > expandIdx);
    });
});
