import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import {
    buildEligibilityDetailsDisplayNameExpr,
    duplicateCoreExternalIdSql,
    ELIGIBILITY_DETAILS_DISPLAY_NAME_COLUMNS,
} from "./import-review-promotion-eligibility-sql-helpers.js";
import {
    buildEligibilityDetailsReasonCodeSql,
    buildEligibilityDetailsSearchSql,
} from "./import-review-promotion-eligibility-details-filters.js";
import { parsePromotionEligibilityFamilyParam } from "./import-review-promotion-eligibility-details-api.js";
import { getImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import { ImportReviewTransportPromotionDeprecatedError } from "./import-review-promotion.errors.js";
import { TRANSPORT_PROMOTION_DEPRECATED_MESSAGE } from "./import-review-promotion.errors.js";
import { duplicateCoreExternalIdSql as duplicateGuardSql } from "./import-review-promotion-eligibility-family-guards.js";

function sqlText(fragment: Prisma.Sql): string {
    return fragment.strings.join("?");
}

const buildingsConfig = getImportReviewPublishFamilyConfig("buildings");
const placesConfig = getImportReviewPublishFamilyConfig("places");
const roadsConfig = getImportReviewPublishFamilyConfig("roads");
assert.ok(buildingsConfig);
assert.ok(placesConfig);
assert.ok(roadsConfig);

describe("import-review promotion eligibility details SQL", () => {
    it("buildings display_name uses only existing columns", () => {
        const columns = new Set([
            "id",
            "canonical_name",
            "building_type",
            "external_id",
            "public_id",
        ]);
        const sql = sqlText(buildEligibilityDetailsDisplayNameExpr("r", "buildings", columns));
        assert.match(sql, /canonical_name/i);
        assert.doesNotMatch(sql, /\br\.name\b/);
    });

    it("places blocked duplicate check does not reference r.name or core_row.is_active", () => {
        const columns = new Set([
            "id",
            "external_id",
            "matched_core_id",
            "primary_name",
            "display_name",
        ]);
        const display = sqlText(buildEligibilityDetailsDisplayNameExpr("r", "places", columns));
        assert.doesNotMatch(display, /\br\.name\b/);
        assert.match(display, /primary_name|display_name/);

        const dup = sqlText(duplicateCoreExternalIdSql("core.core_places", "r", columns));
        assert.doesNotMatch(dup, /core_row\.is_active/);
        assert.match(dup, /deleted_at IS NULL/);
    });

    it("roads warnings display_name does not reference r.name when column absent", () => {
        const columns = new Set([
            "id",
            "canonical_name",
            "road_name",
            "class_code",
            "external_id",
            "validation_warnings",
        ]);
        const sql = sqlText(buildEligibilityDetailsDisplayNameExpr("r", "roads", columns));
        assert.doesNotMatch(sql, /\br\.name\b/);
        assert.match(sql, /canonical_name|road_name/);
    });

    it("roads blocked DUPLICATE_UNCONFIRMED reason filter does not require missing review_note column", () => {
        const columns = new Set([
            "id",
            "match_status",
            "review_decision",
            "external_id",
        ]);
        const sql = sqlText(
            buildEligibilityDetailsReasonCodeSql(
                roadsConfig!,
                "r",
                "blocked",
                "DUPLICATE_UNCONFIRMED",
                columns
            )
        );
        assert.match(sql, /duplicate_candidate|possible_duplicate/i);
        assert.doesNotMatch(sql, /review_note/);
    });

    it("roads duplicate guard uses core_streets active predicate without generic core_row alias mistakes", () => {
        const columns = new Set(["external_id", "matched_core_id"]);
        const dup = sqlText(duplicateGuardSql(roadsConfig!, "r", columns));
        assert.match(dup, /core_streets/);
        assert.doesNotMatch(dup, /core_row\.is_active/);
    });

    it("places search SQL skips review_note when column missing", () => {
        const columns = new Set(["id", "external_id", "primary_name"]);
        const display = buildEligibilityDetailsDisplayNameExpr("r", "places", columns);
        const sql = sqlText(buildEligibilityDetailsSearchSql("r", display, "foo", columns));
        assert.doesNotMatch(sql, /review_note/);
    });

    it("disabled bus family returns TRANSPORT_PROMOTION_DEPRECATED", () => {
        assert.throws(
            () => parsePromotionEligibilityFamilyParam("bus_routes"),
            (err: unknown) => {
                assert.ok(err instanceof ImportReviewTransportPromotionDeprecatedError);
                assert.equal(err.message, TRANSPORT_PROMOTION_DEPRECATED_MESSAGE);
                return true;
            }
        );
    });

    it("ELIGIBILITY_DETAILS_DISPLAY_NAME_COLUMNS lists family-specific fields", () => {
        assert.ok(ELIGIBILITY_DETAILS_DISPLAY_NAME_COLUMNS.places.includes("primary_name"));
        assert.ok(ELIGIBILITY_DETAILS_DISPLAY_NAME_COLUMNS.roads.includes("road_name"));
        assert.ok(ELIGIBILITY_DETAILS_DISPLAY_NAME_COLUMNS.addresses.includes("full_address"));
    });
});
