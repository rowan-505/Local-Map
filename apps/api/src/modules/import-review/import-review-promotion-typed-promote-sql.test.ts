import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    promotionBuildingNamesUpsertSql,
    promotionTypedBuildingNameExpr,
    promotionTypedPlaceAdminAreaIdExpr,
    promotionTypedPlaceCategoryIdExpr,
    promotionTypedPlaceNameLocalExpr,
    promotionTypedPlacePrimaryNameExpr,
} from "./import-review-promotion-typed-promote-sql.js";

function sqlText(fragment: { strings: readonly string[]; values: readonly unknown[] }): string {
    let out = "";
    for (let i = 0; i < fragment.strings.length; i += 1) {
        out += fragment.strings[i];
        if (i < fragment.values.length) {
            out += `$${i + 1}`;
        }
    }
    return out;
}

describe("promotionTypedPlaceCategoryIdExpr", () => {
    it("validates typed category_id against ref.ref_poi_categories", () => {
        const sql = sqlText(promotionTypedPlaceCategoryIdExpr("pc") as never);
        assert.match(sql, /ref\.ref_poi_categories/);
        assert.match(sql, /pc\.category_id/);
        assert.match(sql, /coalesce\(c\.is_public, true\)/);
        assert.doesNotMatch(sql, /normalized_data/);
    });

    it("falls back to typed class_code only", () => {
        const sql = sqlText(promotionTypedPlaceCategoryIdExpr("pc") as never);
        assert.match(sql, /pc\.class_code/);
    });
});

describe("promotionTypedPlaceAdminAreaIdExpr", () => {
    it("requires active core.core_admin_areas row when admin_area_id is set", () => {
        const sql = sqlText(promotionTypedPlaceAdminAreaIdExpr("pc") as never);
        assert.match(sql, /core\.core_admin_areas/);
        assert.match(sql, /pc\.admin_area_id/);
        assert.doesNotMatch(sql, /normalized_data/);
    });
});

describe("promotionTypedPlaceNameLocalExpr", () => {
    it("reads name_mm only for core name_local", () => {
        const sql = sqlText(promotionTypedPlaceNameLocalExpr("pc") as never);
        assert.match(sql, /pc\.name_mm/);
        assert.doesNotMatch(sql, /normalized_data/);
    });
});

describe("promotionTypedPlacePrimaryNameExpr", () => {
    it("uses typed name columns before legacy display fields", () => {
        const sql = sqlText(promotionTypedPlacePrimaryNameExpr("pc") as never);
        assert.match(sql, /pc\.name_en/);
        assert.match(sql, /pc\.name_mm/);
    });
});

describe("promotionTypedBuildingNameExpr", () => {
    it("returns NULL::text because legacy buildings.name is unused", () => {
        const sql = sqlText(promotionTypedBuildingNameExpr("g") as never);
        assert.match(sql, /NULL::text/);
        assert.doesNotMatch(sql, /name_en/);
        assert.doesNotMatch(sql, /name_mm/);
        assert.doesNotMatch(sql, /canonical_name/);
    });
});

describe("promotionBuildingNamesUpsertSql", () => {
    it("upserts into core_map_building_names with identity ON CONFLICT DO NOTHING", () => {
        const sql = sqlText(
            promotionBuildingNamesUpsertSql({
                buildingId: 42n,
                publishItemId: 7n,
            }) as never
        );
        assert.match(sql, /INSERT INTO core\.core_map_building_names/);
        assert.match(sql, /normalized_data->'names'/);
        assert.match(sql, /'imported'/);
        assert.match(
            sql,
            /ON CONFLICT \(building_id, language_code, name_type, \(lower\(btrim\(name\)\)\)\) DO NOTHING/
        );
        assert.match(sql, /is_primary IS TRUE/);
        assert.match(sql, /name_mm/);
    });

    it("prefers normalized_data names and falls back to typed columns", () => {
        const sql = sqlText(
            promotionBuildingNamesUpsertSql({
                buildingId: 1n,
                publishItemId: 2n,
            }) as never
        );
        assert.match(sql, /jsonb_array_elements/);
        assert.match(sql, /NOT EXISTS \(SELECT 1 FROM from_json\)/);
        assert.match(sql, /'my'::text/);
        assert.match(sql, /'en'::text/);
        assert.match(sql, /'und'::text/);
    });
});
