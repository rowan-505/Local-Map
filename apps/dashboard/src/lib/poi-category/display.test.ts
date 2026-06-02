import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    getPoiCategoryDisplayText,
    isPoiParentCategory,
    normalizePoiCategoryDropdownOption,
} from "./display.js";

describe("poi category display", () => {
    it("prefers Myanmar name in label", () => {
        assert.equal(
            getPoiCategoryDisplayText({
                code: "restaurant",
                name: "Restaurant",
                name_mm: "စားသောက်ဆိုင်",
            }),
            "restaurant — စားသောက်ဆိုင်"
        );
    });

    it("falls back to English name without duplicating code", () => {
        assert.equal(
            getPoiCategoryDisplayText({
                code: "office",
                name: "Office",
                name_mm: null,
            }),
            "office — Office"
        );
    });

    it("shows star only when parent_id is explicitly null", () => {
        assert.equal(isPoiParentCategory({ parent_id: null }), true);
        assert.equal(isPoiParentCategory({ parent_id: "12" }), false);
        assert.equal(isPoiParentCategory({}), false);
        assert.equal(isPoiParentCategory({ parent_id: undefined }), false);
    });

    it("normalizes import-review row with parent and child shapes", () => {
        const parent = normalizePoiCategoryDropdownOption({
            value: "1",
            code: "food",
            name: "Food",
            name_mm: "အစားအသောက်",
            parent_id: null,
        });
        assert.equal(parent.label, "food — အစားအသောက်");
        assert.equal(isPoiParentCategory(parent), true);

        const child = normalizePoiCategoryDropdownOption({
            value: "2",
            code: "restaurant",
            name: "Restaurant",
            name_mm: "စားသောက်ဆိုင်",
            parent_id: "1",
        });
        assert.equal(child.label, "restaurant — စားသောက်ဆိုင်");
        assert.equal(isPoiParentCategory(child), false);
        assert.match(child.searchText, /restaurant/);
        assert.match(child.searchText, /စားသောက်ဆိုင်/);
    });
});
