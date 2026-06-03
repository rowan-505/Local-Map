import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@prisma/client";

import {
    IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY,
    listPromotableFamilies,
} from "./import-review-promotion-simple-config.js";
import {
    buildPromotionValidationGeometryScalarsSql,
    buildPromotionValidationGeometrySelectSql,
    isPromotionValidationGeometryColumn,
    listPromotionValidationScalarColumnNames,
    promotionValidationGeometryMetricsKind,
    PROMOTION_VALIDATION_GEOMETRY_COLUMN_NAMES,
} from "./import-review-promotion-simple-validation-sql.js";

function sqlText(fragment: Prisma.Sql): string {
    return fragment.strings.join("?");
}

describe("promotion validation geometry SQL", () => {
    it("flags known geometry column names", () => {
        for (const col of PROMOTION_VALIDATION_GEOMETRY_COLUMN_NAMES) {
            assert.equal(isPromotionValidationGeometryColumn(col), true);
        }
        assert.equal(isPromotionValidationGeometryColumn("building_type_id"), false);
    });

    for (const family of listPromotableFamilies()) {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY[family];

        it(`${family}: scalar column list excludes raw geometry`, () => {
            const scalars = listPromotionValidationScalarColumnNames(config);
            for (const col of scalars) {
                assert.equal(
                    isPromotionValidationGeometryColumn(col),
                    false,
                    `scalar list must not include geometry column ${col}`
                );
            }
            if (config.geometry) {
                assert.equal(scalars.includes(config.geometry.column), false);
            }
            for (const col of config.promotionColumns) {
                if (isPromotionValidationGeometryColumn(col)) {
                    assert.equal(scalars.includes(col), false);
                }
            }
        });

        it(`${family}: geometry select uses scalar facts only`, () => {
            const sql = sqlText(buildPromotionValidationGeometrySelectSql(config));
            assert.match(sql, /has_geom/i);
            assert.match(sql, /geom_is_valid/i);
            assert.match(sql, /ST_GeometryType/i);
            assert.match(sql, /geom_srid/i);
            assert.match(sql, /geom_is_empty/i);
            assert.doesNotMatch(sql, /ST_AsGeoJSON/i);
            assert.doesNotMatch(sql, /::geometry\b/i);
            assert.doesNotMatch(sql, / AS geom\b/i);
            assert.doesNotMatch(sql, / AS point_geom\b/i);
            assert.doesNotMatch(sql, / AS centroid\b/i);

            if (!config.geometry) {
                return;
            }
            const kind = promotionValidationGeometryMetricsKind(config.geometry);
            if (kind === "line") {
                assert.match(sql, /ST_Length/i);
                assert.match(sql, /geom_length_m/i);
            }
            if (kind === "polygon") {
                assert.match(sql, /ST_Area/i);
                assert.match(sql, /geom_area_m2/i);
            }
        });
    }

    it("building geometry SQL uses polygon area and not raw geom select", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.buildings;
        const sql = sqlText(buildPromotionValidationGeometryScalarsSql("geom", "polygon"));
        assert.match(sql, /ST_Area\(geom::geography\)/);
        assert.match(sql, /geom_area_m2/);
        assert.doesNotMatch(sql, /\bgeom\b AS /);
    });

    it("road geometry SQL uses line length", () => {
        const sql = sqlText(buildPromotionValidationGeometryScalarsSql("geom", "line"));
        assert.match(sql, /ST_Length\(geom::geography\)/);
        assert.match(sql, /geom_length_m/);
    });
});
