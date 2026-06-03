import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getPoiCategoryDisplayText, poiCategoryRowToFormOption } from "./poi-category-form-option.js";

describe("poiCategoryRowToFormOption", () => {
    it("maps ref row with parent_id and localized label", () => {
        const option = poiCategoryRowToFormOption({
            id: 3n,
            code: "food",
            name: "Food",
            name_mm: "အစားအသောက်",
            parent_id: null,
            sort_order: 10,
            is_public: true,
            is_searchable: true,
        });
        assert.equal(option.id, "3");
        assert.equal(option.code, "food");
        assert.equal(option.parent_id, null);
        assert.equal(option.label, "food — အစားအသောက်");
    });

    it("child row keeps parent_id for frontend star logic", () => {
        const option = poiCategoryRowToFormOption({
            id: 8n,
            code: "cafe",
            name: "Cafe",
            name_mm: null,
            parent_id: 3n,
            sort_order: 20,
            is_public: true,
            is_searchable: true,
        });
        assert.equal(option.parent_id, "3");
        assert.equal(getPoiCategoryDisplayText(option), "cafe — Cafe");
    });
});
