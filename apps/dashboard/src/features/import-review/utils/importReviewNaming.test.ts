import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import {
    formatCandidateName,
    getImportReviewDisplayName,
    getImportReviewNameColumns,
    getImportReviewSourceImportedName,
} from "./importReviewNaming.js";

describe("importReviewNaming", () => {
    it("getImportReviewNameColumns returns typed column keys only", () => {
        const cols = getImportReviewNameColumns();
        assert.equal(cols.length, 2);
        assert.equal(cols[0]?.key, "name_mm");
        assert.equal(cols[1]?.key, "name_en");
    });

    it("prefers typed name_en over canonical_name for display title", () => {
        const row = {
            id: "23",
            name_en: "test",
            name_mm: null,
            canonical_name: "Old OSM Name",
            normalized_data: { tags: { name: "Old OSM Name" } },
        } as ImportReviewBuildingListItem;

        assert.equal(getImportReviewDisplayName(row, { label: "Place" }), "test");
        assert.equal(formatCandidateName(row, "name_en"), "test");
        assert.equal(formatCandidateName(row, "name_mm"), "—");
    });

    it("uses source imported name helper without typed values", () => {
        const row = {
            id: "1",
            canonical_name: "Temple",
            normalized_data: { tags: { name: "Shwe Tag" } },
        } as ImportReviewBuildingListItem;

        assert.equal(getImportReviewSourceImportedName(row), "Shwe Tag");
        assert.equal(formatCandidateName(row, "name_en"), "—");
    });
});
