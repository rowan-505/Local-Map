import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import type { ImportReviewOverrideFieldDef } from "../config/overrideFieldDefs";
import { buildColumnPatch, validateOverrideForm } from "./overrideEditorUtils.js";
import { overrideFieldDefsForEntity } from "../config/overrideFieldDefs.js";
import { getImportReviewEntityConfigBySlug } from "../config/importReviewEntityConfigs.js";

const categoryDef: ImportReviewOverrideFieldDef = {
    configKey: "category_id",
    patchKey: "category_id",
    label: "Category",
    type: "select",
    refSource: "ref_poi_categories",
    importedFrom: "normalized",
    importedKey: "category_id",
    section: "classification",
};

const nameEnDef: ImportReviewOverrideFieldDef = {
    configKey: "name_en",
    patchKey: "name_en",
    label: "Name (EN)",
    type: "text",
    importedFrom: "row",
    section: "names",
};

function placeRow(overrides: Partial<ImportReviewBuildingListItem> = {}): ImportReviewBuildingListItem {
    return {
        id: "cand-1",
        normalized_data: { category_id: 39 },
        ...overrides,
    } as ImportReviewBuildingListItem;
}

describe("buildColumnPatch", () => {
    it("includes category_id when the reviewer selects a category on an empty typed column", () => {
        const row = placeRow();
        const { patch, changedPatchKeys } = buildColumnPatch({
            defs: [categoryDef, nameEnDef],
            form: { category_id: "39", name_en: "" },
            row,
            clearedKeys: new Set(),
            userEditedConfigKeys: new Set(["category_id"]),
            apiFamily: "places",
        });

        assert.equal(patch.category_id, 39);
        assert.equal(changedPatchKeys.has("category_id"), true);
    });

    it("does not mark category_id as changed when only prefilled from source", () => {
        const row = placeRow();
        const { patch, changedPatchKeys } = buildColumnPatch({
            defs: [categoryDef, nameEnDef],
            form: { category_id: "39", name_en: "Updated" },
            row,
            clearedKeys: new Set(),
            userEditedConfigKeys: new Set(["name_en"]),
            apiFamily: "places",
        });

        assert.equal(changedPatchKeys.has("category_id"), false);
        assert.equal(patch.name_en, "Updated");
        assert.equal(patch.category_id, 39);
    });

    it("rejects non-numeric category form values", () => {
        const row = placeRow();
        assert.throws(
            () =>
                buildColumnPatch({
                    defs: [categoryDef],
                    form: { category_id: "retreat — ရိပ်သာ" },
                    row,
                    clearedKeys: new Set(),
                    userEditedConfigKeys: new Set(["category_id"]),
                    apiFamily: "places",
                }),
            /numeric id/i
        );
    });
});

describe("validateOverrideForm roads", () => {
    const roadsConfig = getImportReviewEntityConfigBySlug("roads");
    assert.ok(roadsConfig);
    const roadDefs = overrideFieldDefsForEntity(roadsConfig);

    it("allows empty admin_area_id and road_class_id", () => {
        const err = validateOverrideForm(
            roadDefs,
            {
                name_mm: "",
                name_en: "",
                admin_area_id: "",
                road_class_id: "",
                surface: "",
                is_oneway: "",
                access: "",
                speed_kph: "",
                bridge: "",
                tunnel: "",
                layer: "",
            },
            "roads"
        );
        assert.equal(err, null);
    });

    it("rejects non-numeric speed_kph", () => {
        const err = validateOverrideForm(
            roadDefs,
            {
                name_mm: "",
                name_en: "",
                admin_area_id: "",
                road_class_id: "",
                surface: "",
                is_oneway: "",
                access: "",
                speed_kph: "fast",
                bridge: "",
                tunnel: "",
                layer: "",
            },
            "roads"
        );
        assert.ok(err?.includes("Speed"));
    });

    it("rejects invalid admin_area_id format", () => {
        const err = validateOverrideForm(
            roadDefs,
            {
                name_mm: "",
                name_en: "",
                admin_area_id: "not-a-number",
                road_class_id: "",
                surface: "",
                is_oneway: "",
                access: "",
                speed_kph: "",
                bridge: "",
                tunnel: "",
                layer: "",
            },
            "roads"
        );
        assert.ok(err?.includes("admin area"));
    });
});
