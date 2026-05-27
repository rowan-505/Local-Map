import assert from "node:assert/strict";
import test from "node:test";

import {
    IMPORT_REVIEW_ENTITY_FAMILIES,
    getImportReviewEntityConfig,
} from "./import-review-config.js";
import {
    buildLightweightListFromClause,
    buildLightweightListSelect,
    shouldUseLightweightListQuery,
} from "./import-review-list-query.js";
import { lightweightListContractForFamily } from "./import-review-list-query-contract.js";

function sqlText(parts: { strings: string[] }): string {
    return parts.strings.join("?");
}

test("all entity families use lightweight list by default", () => {
    for (const family of IMPORT_REVIEW_ENTITY_FAMILIES) {
        const config = getImportReviewEntityConfig(family);
        assert.equal(shouldUseLightweightListQuery(config, false), true);
        assert.equal(config.listSelectMode, "summary");
    }
});

test("lightweight list SELECT excludes GeoJSON and heavy JSON payloads", () => {
    for (const family of IMPORT_REVIEW_ENTITY_FAMILIES) {
        const config = getImportReviewEntityConfig(family);
        const select = sqlText(buildLightweightListSelect(config));
        assert.doesNotMatch(select, /ST_AsGeoJSON/i, `${family} list must not use ST_AsGeoJSON`);
        assert.match(
            select,
            /'\{\}'::jsonb AS normalized_data/,
            `${family} list must stub normalized_data`
        );
        assert.match(select, /'\{\}'::jsonb AS source_refs/, `${family} list must stub source_refs`);
        assert.match(
            select,
            /'\[\]'::jsonb AS validation_errors/,
            `${family} list must stub validation_errors`
        );
        assert.match(select, /is_list_projection/, `${family} list must flag projection`);
        const contract = lightweightListContractForFamily(config);
        assert.equal(contract.idColumn, "id");
        assert.ok(contract.displayNameColumns.includes("canonical_name"));
    }
});

test("lightweight list FROM is defined for every family", () => {
    for (const family of IMPORT_REVIEW_ENTITY_FAMILIES) {
        const config = getImportReviewEntityConfig(family);
        const from = sqlText(buildLightweightListFromClause(config));
        assert.match(from, new RegExp(config.importReviewTable), `${family} FROM must reference table`);
    }
});
