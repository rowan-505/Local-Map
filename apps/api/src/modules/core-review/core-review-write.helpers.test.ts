import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizePolygonGeoJsonForSave } from "../../lib/geo/normalize-polygon-geojson.js";
import {
    mapDatabaseWriteError,
    slugFromCanonicalName,
    validationMessageFromIssues,
} from "./core-review-write.helpers.js";

describe("normalizePolygonGeoJsonForSave", () => {
    it("closes an open triangle ring", () => {
        const input = {
            type: "Polygon",
            coordinates: [[[96.1, 16.8], [96.2, 16.8], [96.15, 16.9]]],
        };
        const out = normalizePolygonGeoJsonForSave(input) as {
            coordinates: [number, number][][];
        };
        const ring = out.coordinates[0]!;
        assert.equal(ring.length, 4);
        assert.deepEqual(ring[0], ring[3]);
    });
});

describe("slugFromCanonicalName", () => {
    it("derives a slug from a canonical name", () => {
        assert.equal(slugFromCanonicalName("Kyauktan Township"), "kyauktan-township");
    });
});

describe("validationMessageFromIssues", () => {
    it("uses the single issue message as headline", () => {
        assert.equal(
            validationMessageFromIssues([{ path: "adminLevelId", message: "Admin level is required" }]),
            "adminLevelId: Admin level is required",
        );
    });
});

describe("mapDatabaseWriteError", () => {
    it("maps Prisma NOT NULL failures on dashboard landuse staging columns", () => {
        const mapped = mapDatabaseWriteError({
            code: "P2010",
            meta: {
                code: "23502",
                message:
                    "Failing row contains (13, null, null, Test, urban, {}, {\"source\": \"dashboard\"}, geom, t, ts, ts, f, unverified, null, null, null, null).",
            },
        });
        assert.ok(mapped);
        assert.match(mapped!.message, /migration 036/i);
        assert.equal(mapped!.issues.length, 2);
    });

    it("maps explicit null column postgres errors", () => {
        const mapped = mapDatabaseWriteError(new Error('null value in column "external_id" violates not-null constraint'));
        assert.ok(mapped);
        assert.equal(mapped!.message, "external_id is required");
    });
});
