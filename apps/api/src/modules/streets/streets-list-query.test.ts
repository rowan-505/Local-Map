import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    parseStreetsListSearchInput,
    resolveStreetsCoreReviewSortColumn,
} from "./streets-list-query.js";

describe("parseStreetsListSearchInput", () => {
    it("detects numeric id exact search", () => {
        const parsed = parseStreetsListSearchInput("12345");
        assert.equal(parsed.numericId, 12345n);
        assert.equal(parsed.textPattern, "%12345%");
    });

    it("does not treat non-numeric text as id", () => {
        const parsed = parseStreetsListSearchInput("Kyauktan");
        assert.equal(parsed.numericId, null);
        assert.equal(parsed.textPattern, "%Kyauktan%");
    });

    it("supports partial public_id search pattern", () => {
        const parsed = parseStreetsListSearchInput("a1b2c3d4");
        assert.equal(parsed.publicIdPattern, "%a1b2c3d4%");
        assert.equal(parsed.exactPublicId, null);
    });

    it("detects a complete public_id for indexed equality", () => {
        const publicId = "2f0e7e1a-5ad2-4d73-9706-18ce4e3dd420";
        const parsed = parseStreetsListSearchInput(publicId);
        assert.equal(parsed.exactPublicId, publicId);
    });
});

describe("resolveStreetsCoreReviewSortColumn", () => {
    it("allowlists known sort columns", () => {
        assert.equal(resolveStreetsCoreReviewSortColumn("id"), "id");
        assert.equal(resolveStreetsCoreReviewSortColumn("created_at"), "created_at");
        assert.equal(resolveStreetsCoreReviewSortColumn("updated_at"), "updated_at");
        assert.equal(resolveStreetsCoreReviewSortColumn("name"), "name");
    });

    it("rejects unknown sort strings", () => {
        assert.equal(resolveStreetsCoreReviewSortColumn("geom;drop"), "updated_at");
        assert.equal(resolveStreetsCoreReviewSortColumn("updated_at", "id"), "updated_at");
    });
});
