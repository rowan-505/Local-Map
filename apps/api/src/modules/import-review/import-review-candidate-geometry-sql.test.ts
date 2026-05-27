import assert from "node:assert/strict";
import test from "node:test";

import {
    IMPORT_REVIEW_ENTITY_FAMILIES,
    getImportReviewEntityConfig,
} from "./import-review-config.js";
import { buildCandidateGeometrySelect } from "./import-review-candidate-geometry-sql.js";
import { buildCandidateDetailSelect } from "./import-review-candidate-detail-sql.js";

function sqlText(sql: { strings: string[] }): string {
    return sql.strings.join("?");
}

/** Rejects `… AS id CASE` (missing comma before CASE) from the geometry-select bug. */
function assertValidSelectList(select: string, family: string): void {
    assert.doesNotMatch(
        select,
        /\bAS\s+id\s+CASE/i,
        `${family}: SELECT list must comma-separate id from CASE geometry expression`
    );
    assert.match(select, /AS\s+id,/i, `${family}: id column must be followed by a comma`);
    assert.match(select, /\bAS\s+geometry\b/i, `${family}: must project geometry alias`);
    assert.match(select, /\bAS\s+centroid\b/i, `${family}: must project centroid alias`);
}

test("geometry SELECT is comma-separated for all entity families", () => {
    for (const family of IMPORT_REVIEW_ENTITY_FAMILIES) {
        const config = getImportReviewEntityConfig(family);
        const select = sqlText(buildCandidateGeometrySelect(config));
        assertValidSelectList(select, family);
    }
});

test("detail SELECT without geometry does not produce id CASE syntax error", () => {
    const families = [
        "buildings",
        "places",
        "roads",
        "bus_stops",
        "admin_areas",
        "landuse",
        "water_lines",
        "water_polygons",
        "addresses",
    ] as const;

    for (const family of families) {
        const config = getImportReviewEntityConfig(family);
        const select = sqlText(buildCandidateDetailSelect(config));
        assert.doesNotMatch(
            select,
            /\bupdated_at\s+CASE/i,
            `${family} detail: updated_at must be comma-separated from geometry CASE`
        );
    }
});

test("geometry SELECT references configured geom columns", () => {
    const buildings = sqlText(buildCandidateGeometrySelect(getImportReviewEntityConfig("buildings")));
    assert.match(buildings, /ST_AsGeoJSON/i);
    assert.match(buildings, /\.geom/);

    const places = sqlText(buildCandidateGeometrySelect(getImportReviewEntityConfig("places")));
    assert.match(places, /point_geom/);

    const addresses = sqlText(buildCandidateGeometrySelect(getImportReviewEntityConfig("addresses")));
    assert.match(addresses, /point_geom/);
    assert.match(addresses, /entrance_geom/);

    const busRoutes = sqlText(buildCandidateGeometrySelect(getImportReviewEntityConfig("bus_routes")));
    assert.match(busRoutes, /NULL::json AS geometry/);
});
