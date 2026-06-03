import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildPoiCategoryDropdownOptions,
    dedupePoiCategoryDropdownOptions,
    filterPoiCategoryDropdownOptions,
    getPoiCategoryDisplayText,
    isPoiParentCategory,
    normalizePoiCategoryDropdownOption,
    withMissingPoiCategorySelection,
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

    it("falls back to code then Category #id without Unknown category", () => {
        assert.equal(
            getPoiCategoryDisplayText({
                code: "office",
                name: null,
                name_mm: null,
            }),
            "office"
        );
        assert.equal(
            getPoiCategoryDisplayText({
                id: "42",
                code: null,
                name: null,
                name_mm: null,
            }),
            "Category #42"
        );
        assert.equal(
            getPoiCategoryDisplayText({
                code: "unknown",
                name: "Unknown category",
                name_mm: null,
            }),
            "unknown — Unknown category"
        );
    });

    it("shows star only when parent_id is explicitly null", () => {
        assert.equal(isPoiParentCategory({ parent_id: null }), true);
        assert.equal(isPoiParentCategory({ parent_id: "12" }), false);
        assert.equal(isPoiParentCategory({}), false);
        assert.equal(isPoiParentCategory({ parent_id: undefined }), false);
    });

    it("parent categories show star and children do not", () => {
        const options = buildPoiCategoryDropdownOptions([
            {
                id: "1",
                code: "food",
                name: "Food",
                name_mm: "အစားအသောက်",
                parent_id: null,
            },
            {
                id: "2",
                code: "restaurant",
                name: "Restaurant",
                name_mm: "စားသောက်ဆိုင်",
                parent_id: "1",
            },
        ]);
        const parent = options.find((option) => option.value === "1");
        const child = options.find((option) => option.value === "2");
        assert.ok(parent);
        assert.ok(child);
        assert.equal(isPoiParentCategory(parent), true);
        assert.equal(isPoiParentCategory(child), false);
    });

    it("does not duplicate unknown fallback labels for sparse rows", () => {
        const options = buildPoiCategoryDropdownOptions([
            { id: "10", code: null, name: null, name_mm: null, parent_id: null },
            { id: "11", code: null, name: null, name_mm: null, parent_id: null },
            { id: "12", code: "cafe", name: "Cafe", name_mm: null, parent_id: "10" },
        ]);
        const labels = options.map((option) => option.label);
        assert.equal(labels.filter((label) => label === "Unknown category").length, 0);
        assert.deepEqual(labels, ["Category #10", "Category #11", "cafe — Cafe"]);
    });

    it("dedupes dropdown option values", () => {
        const normalized = [
            normalizePoiCategoryDropdownOption({
                value: "5",
                code: "dup",
                name: "One",
                parent_id: null,
            }),
            normalizePoiCategoryDropdownOption({
                value: "5",
                code: "dup",
                name: "Two",
                parent_id: null,
            }),
        ];
        const deduped = dedupePoiCategoryDropdownOptions(normalized);
        assert.equal(deduped.length, 1);
        assert.equal(deduped[0]?.value, "5");
    });

    it("selected category_id resolves to matching option", () => {
        const options = buildPoiCategoryDropdownOptions(
            [{ id: "9", code: "hotel", name: "Hotel", name_mm: null, parent_id: null }],
            { selectedValue: "9" }
        );
        assert.equal(options.some((option) => option.value === "9" && option.label.includes("hotel")), true);
    });

    it("dropdown loads more than one category when filter query is empty", () => {
        const options = buildPoiCategoryDropdownOptions([
            {
                id: "1",
                code: "religion",
                name: "Religion",
                name_mm: "ဘာသာရေး",
                parent_id: null,
            },
            {
                id: "2",
                code: "food",
                name: "Food",
                name_mm: "အစားအသောက်",
                parent_id: null,
            },
            {
                id: "3",
                code: "restaurant",
                name: "Restaurant",
                name_mm: null,
                parent_id: "2",
            },
        ]);
        assert.equal(options.length, 3);
        assert.equal(filterPoiCategoryDropdownOptions(options, "").length, 3);
    });

    it("selected category label does not hide other options when filter is cleared on open", () => {
        const options = buildPoiCategoryDropdownOptions(
            [
                {
                    id: "1",
                    code: "religion",
                    name: "Religion",
                    name_mm: "ဘာသာရေး",
                    parent_id: null,
                },
                {
                    id: "2",
                    code: "food",
                    name: "Food",
                    name_mm: "အစားအသောက်",
                    parent_id: null,
                },
            ],
            { selectedValue: "1" }
        );
        const selected = options.find((option) => option.value === "1");
        assert.ok(selected);
        const narrowed = filterPoiCategoryDropdownOptions(
            options,
            getPoiCategoryDisplayText(selected!)
        );
        assert.equal(narrowed.length, 1);
        assert.equal(filterPoiCategoryDropdownOptions(options, "").length, 2);
    });

    it("search filters across code, name, and name_mm", () => {
        const options = buildPoiCategoryDropdownOptions([
            {
                id: "1",
                code: "religion",
                name: "Religion",
                name_mm: "ဘာသာရေး",
                parent_id: null,
            },
            {
                id: "2",
                code: "food",
                name: "Food",
                name_mm: "အစားအသောက်",
                parent_id: null,
            },
        ]);
        assert.equal(filterPoiCategoryDropdownOptions(options, "food").length, 1);
        assert.equal(filterPoiCategoryDropdownOptions(options, "အစားအသောက်").length, 1);
        assert.equal(filterPoiCategoryDropdownOptions(options, "religion").length, 1);
    });

    it("missing category_id displays one Missing category placeholder", () => {
        const options = withMissingPoiCategorySelection(
            buildPoiCategoryDropdownOptions([
                { id: "1", code: "food", name: "Food", name_mm: null, parent_id: null },
            ]),
            "404"
        );
        const missing = options.filter((option) => option.value === "404");
        assert.equal(missing.length, 1);
        assert.equal(missing[0]?.label, "Missing category #404");
        assert.equal(isPoiParentCategory(missing[0]!), false);
    });
});
