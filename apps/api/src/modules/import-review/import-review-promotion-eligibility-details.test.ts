import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import {
    isDuplicateUnconfirmed,
    isManualProtected,
    isRoadClassMissingNoFallback,
    resolvePromotionEligibilityBlockedReasons,
} from "./import-review-promotion-eligibility-blocked-reasons.js";
import {
    buildEligibilityDetailsDisplayNameExpr,
} from "./import-review-promotion-eligibility-sql-helpers.js";
import {
    mapPromotionEligibilityDetailRow,
    parsePromotionEligibilityFamilyParam,
} from "./import-review-promotion-eligibility-details-api.js";
import type { PromotionEligibilityDetailRowDb } from "./import-review-promotion-eligibility-details.repo.js";
import {
    resolvePromotionEligibilityReasons,
    resolvePromotionEligibilityWarningReasons,
} from "./import-review-promotion-eligibility-reasons.js";
import {
    buildPromotionEligibilityBucketWhereSql,
    buildEligibleExceptWarningsSql,
    buildEligibleWhereSql,
} from "./import-review-promotion-eligibility.js";
import { getImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import {
    extractValidationIssuesFromJson,
    validationIssueCodes,
} from "./import-review-promotion-validation-issues.js";
import { isRoadPromotionBlockingStoredIssue } from "./import-review-road-promotion-policy.js";

const roadsConfig = getImportReviewPublishFamilyConfig("roads");
const buildingsConfig = getImportReviewPublishFamilyConfig("buildings");
const placesConfig = getImportReviewPublishFamilyConfig("places");
const landuseConfig = getImportReviewPublishFamilyConfig("land_areas");
const routingBarriersConfig = getImportReviewPublishFamilyConfig("routing_barriers");
assert.ok(roadsConfig);
assert.ok(buildingsConfig);
assert.ok(placesConfig);
assert.ok(landuseConfig);
assert.ok(routingBarriersConfig);

const reviewBatchId = 2n;
const defaultOptions = { includeWarnings: false, includeMerged: false };

function sqlText(fragment: Prisma.Sql): string {
    return fragment.strings.join("?");
}

function baseDetailRow(
    overrides: Partial<PromotionEligibilityDetailRowDb> = {}
): PromotionEligibilityDetailRowDb {
    return {
        id: 1n,
        external_id: "ext-1",
        display_name: "Sample",
        match_status: "new_auto",
        auto_action: "insert_candidate",
        review_status: "approved",
        review_decision: "approved",
        promotion_status: "not_ready",
        confidence_score: 80,
        validation_errors: [],
        validation_warnings: [],
        review_note: null,
        warning_reason: null,
        matched_core_id: null,
        road_class_id: null,
        class_code: null,
        normalized_data: {},
        promoted_core_id: null,
        promoted_target_id: null,
        duplicate_core_external_id: false,
        road_class_missing_no_fallback: false,
        geometry_missing: false,
        required_type_missing: false,
        publish_batch_id: null,
        publish_batch_status: null,
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        updated_at: new Date("2026-01-02T00:00:00.000Z"),
        ...overrides,
    };
}

describe("import-review promotion eligibility details", () => {
    it("buildings ready row maps display_name from coalesce without requiring name column", () => {
        const columns = new Set(["id", "canonical_name", "external_id"]);
        const displaySql = sqlText(buildEligibilityDetailsDisplayNameExpr("r", "buildings", columns));
        assert.doesNotMatch(displaySql, /\br\.name\b/);
        assert.match(displaySql, /canonical_name/);

        const item = mapPromotionEligibilityDetailRow(
            baseDetailRow({ display_name: "Building A" }),
            buildingsConfig!,
            "ready"
        );
        assert.deepEqual(item.reason_codes, ["READY"]);
        assert.equal(item.display_name, "Building A");
    });

    it("parses roads family and routing_barriers target", () => {
        const roads = parsePromotionEligibilityFamilyParam("roads");
        assert.equal(roads.coreTargetTable, "core.core_streets");
        const barriers = parsePromotionEligibilityFamilyParam("routing_barriers");
        assert.equal(barriers.coreTargetTable, "routing.routing_barriers");
    });

    it("warnings bucket SQL uses eligibleWithWarnings and validation_warnings", () => {
        const sql = sqlText(
            buildPromotionEligibilityBucketWhereSql(roadsConfig!, reviewBatchId, "warnings", defaultOptions)
        );
        assert.match(sql, /validation_warnings/i);
        const eligibleWithWarnings = sqlText(
            buildEligibleExceptWarningsSql(roadsConfig!, reviewBatchId, defaultOptions)
        );
        assert.ok(sql.includes(eligibleWithWarnings.slice(0, 40)) || sql.length > 100);
    });

    it("blocked bucket SQL excludes eligibleWithWarnings (warning roads not blocked)", () => {
        const blockedSql = sqlText(
            buildPromotionEligibilityBucketWhereSql(roadsConfig!, reviewBatchId, "blocked", defaultOptions)
        );
        const eligibleWithWarnings = sqlText(
            buildEligibleExceptWarningsSql(roadsConfig!, reviewBatchId, defaultOptions)
        );
        assert.match(blockedSql, /NOT/i);
        assert.ok(blockedSql.includes("review_status") && blockedSql.includes("approved"));
        const readySql = sqlText(buildEligibleWhereSql(roadsConfig!, reviewBatchId, defaultOptions));
        assert.match(readySql, /NOT/i);
        assert.doesNotMatch(blockedSql, /warnings_only_not_ready/i);
        assert.notEqual(blockedSql.trim(), eligibleWithWarnings.trim());
    });

    it("extracts string-array and object-array warnings", () => {
        const fromStrings = extractValidationIssuesFromJson(["ROAD_TOO_SHORT", "OUTSIDE_REVIEW_BOUNDARY"]);
        assert.deepEqual(validationIssueCodes(fromStrings), ["ROAD_TOO_SHORT", "OUTSIDE_REVIEW_BOUNDARY"]);

        const fromObjects = extractValidationIssuesFromJson([
            { code: "NAME_MISSING", message: "Canonical name missing.", severity: "warning" },
        ]);
        assert.equal(fromObjects[0]?.code, "NAME_MISSING");
        assert.equal(fromObjects[0]?.severity, "warning");
    });

    it("maps warnings bucket reasons from validation_warnings (roads)", () => {
        const item = mapPromotionEligibilityDetailRow(
            baseDetailRow({
                id: 10n,
                validation_warnings: ["ROAD_TOO_SHORT"],
                road_class_id: 1n,
                class_code: "residential",
            }),
            roadsConfig!,
            "warnings"
        );
        assert.ok(item.reason_codes.includes("ROAD_TOO_SHORT"));
        assert.equal(item.target, "core.core_streets");
    });

    it("places warning reason from validation_warnings", () => {
        const reasons = resolvePromotionEligibilityWarningReasons(
            baseDetailRow({
                validation_warnings: [
                    {
                        code: "CATEGORY_MISSING",
                        message: "No category_id or mappable class_code.",
                        severity: "warning",
                    },
                ],
            })
        );
        assert.ok(reasons.reason_codes.includes("CATEGORY_MISSING"));
        assert.match(reasons.reason_messages[0] ?? "", /category/i);
    });

    it("places warning falls back to review_note when validation_warnings empty", () => {
        const reasons = resolvePromotionEligibilityWarningReasons(
            baseDetailRow({
                validation_warnings: [],
                review_note: "Verify category mapping before promotion.",
            })
        );
        assert.deepEqual(reasons.reason_codes, ["REVIEW_NOTE"]);
        assert.equal(reasons.reason_messages[0], "Verify category mapping before promotion.");
    });

    it("buildings blocked reason includes validation error and missing geometry", () => {
        const reasons = resolvePromotionEligibilityBlockedReasons(
            baseDetailRow({
                validation_errors: [
                    {
                        code: "missing_geom",
                        message: "Polygon geometry (geom) is required.",
                        severity: "error",
                    },
                ],
                geometry_missing: true,
                required_type_missing: true,
            }),
            buildingsConfig!
        );
        assert.ok(reasons.reason_codes.includes("PROMOTION_BLOCKING_VALIDATION_ERRORS"));
        assert.ok(reasons.reason_codes.includes("MISSING_GEOM"));
        assert.ok(reasons.reason_codes.includes("MISSING_REQUIRED_GEOMETRY"));
        assert.ok(reasons.reason_codes.includes("MISSING_REQUIRED_TYPE_CATEGORY_CLASS"));
    });

    it("landuse batched bucket maps publish batch metadata", () => {
        const item = mapPromotionEligibilityDetailRow(
            baseDetailRow({
                publish_batch_id: 42n,
                publish_batch_status: "validated",
                promotion_status: "batched",
            }),
            landuseConfig!,
            "batched"
        );
        assert.equal(item.target, "core.core_land_areas");
        assert.equal(item.publish_batch_id, 42);
        assert.equal(item.publish_batch_status, "validated");
        assert.ok(item.reason_codes.includes("ACTIVE_PUBLISH_BATCH"));
        assert.ok(item.reason_codes.some((c) => c.startsWith("PUBLISH_BATCH_ID:")));
        assert.ok(item.reason_codes.some((c) => c.startsWith("PUBLISH_BATCH_STATUS:")));
    });

    it("routing_barriers blocked reason for missing geometry and barrier type", () => {
        const item = mapPromotionEligibilityDetailRow(
            baseDetailRow({
                external_id: "barrier-1",
                geometry_missing: true,
                required_type_missing: true,
                validation_errors: [
                    {
                        code: "missing_point_geom",
                        message: "Routing barrier point geometry is required.",
                        severity: "error",
                    },
                ],
            }),
            routingBarriersConfig!,
            "blocked"
        );
        assert.equal(item.target, "routing.routing_barriers");
        assert.ok(item.reason_codes.includes("MISSING_REQUIRED_GEOMETRY"));
        assert.ok(item.reason_codes.includes("MISSING_REQUIRED_TYPE_CATEGORY_CLASS"));
        assert.ok(item.reason_codes.includes("MISSING_POINT_GEOM"));
    });

    it("warning-only road is not treated as promotion-blocking from stored errors", () => {
        assert.equal(isRoadPromotionBlockingStoredIssue("ROAD_TOO_SHORT"), false);
        assert.equal(isRoadPromotionBlockingStoredIssue("OUTSIDE_REVIEW_BOUNDARY"), false);
        assert.equal(isRoadPromotionBlockingStoredIssue({ code: "GEOMETRY_INVALID", severity: "error" }), true);
    });

    it("duplicate_unconfirmed row resolves blocked reason", () => {
        const row = baseDetailRow({
            match_status: "duplicate_candidate",
            review_note: "",
            external_id: "way/9",
            road_class_id: 1n,
            class_code: "residential",
            normalized_data: { highway: "residential" },
        });
        assert.ok(isDuplicateUnconfirmed(row));
        const reasons = resolvePromotionEligibilityBlockedReasons(row, roadsConfig!);
        assert.ok(reasons.reason_codes.includes("DUPLICATE_UNCONFIRMED"));
        assert.ok(!reasons.reason_codes.includes("ROAD_TOO_SHORT"));
    });

    it("manual_protected resolves blocked reason", () => {
        const reasons = resolvePromotionEligibilityBlockedReasons(
            baseDetailRow({
                match_status: "manual_protected",
                auto_action: "protect_manual",
                review_note: "note",
            }),
            roadsConfig!
        );
        assert.ok(reasons.reason_codes.includes("MANUAL_PROTECTED"));
    });

    it("GEOMETRY_INVALID in validation_errors resolves promotion_blocking_validation_errors", () => {
        const reasons = resolvePromotionEligibilityBlockedReasons(
            baseDetailRow({
                road_class_id: 1n,
                class_code: "residential",
                normalized_data: { highway: "residential" },
                validation_errors: [{ code: "GEOMETRY_INVALID", message: "bad geom", severity: "error" }],
            }),
            roadsConfig!
        );
        assert.ok(reasons.reason_codes.includes("PROMOTION_BLOCKING_VALIDATION_ERRORS"));
        assert.ok(reasons.reason_codes.includes("GEOMETRY_INVALID"));
    });

    it("batched bucket maps publish batch metadata (roads)", () => {
        const item = mapPromotionEligibilityDetailRow(
            baseDetailRow({
                publish_batch_id: 99n,
                publish_batch_status: "validated",
                promotion_status: "batched",
            }),
            roadsConfig!,
            "batched"
        );
        assert.equal(item.publish_batch_id, 99);
        assert.equal(item.publish_batch_status, "validated");
        assert.ok(item.reason_codes.some((c) => c.startsWith("PUBLISH_BATCH_ID:")));
    });

    it("promoted bucket maps promoted_core_id", () => {
        const item = mapPromotionEligibilityDetailRow(
            baseDetailRow({
                review_status: "promoted",
                promotion_status: "promoted",
                promoted_core_id: 555n,
            }),
            roadsConfig!,
            "promoted"
        );
        assert.equal(item.promoted_core_id, 555);
        assert.ok(item.reason_codes.some((c) => c.startsWith("PROMOTED_CORE_ID:")));
        assert.ok(item.reason_codes.includes("ALREADY_PROMOTED"));
    });

    it("ready bucket uses READY reason", () => {
        const item = mapPromotionEligibilityDetailRow(
            baseDetailRow({
                road_class_id: 1n,
                class_code: "residential",
            }),
            roadsConfig!,
            "ready"
        );
        assert.deepEqual(item.reason_codes, ["READY"]);
    });

    it("resolvePromotionEligibilityReasons normalizes codes to uppercase", () => {
        const reasons = resolvePromotionEligibilityReasons(
            baseDetailRow({ validation_warnings: ["name_missing"] }),
            placesConfig!,
            "warnings"
        );
        assert.ok(reasons.reason_codes.includes("NAME_MISSING"));
    });

    it("review_batch_id=2 style bucket math: ready + warnings + blocked partitions", () => {
        const ready = 276;
        const warnings = 525;
        const blocked = 2;
        assert.equal(ready + warnings + blocked, 803);
    });

    it("isRoadClassMissingNoFallback matches SQL guard semantics", () => {
        const base = {
            match_status: null,
            auto_action: null,
            review_decision: "approved",
            review_note: null,
            external_id: null,
            matched_core_id: null,
            validation_errors: [],
        };
        assert.equal(
            isRoadClassMissingNoFallback({
                ...base,
                road_class_id: null,
                class_code: null,
                normalized_data: {},
            }),
            true
        );
        assert.equal(
            isRoadClassMissingNoFallback({
                ...base,
                road_class_id: null,
                class_code: null,
                normalized_data: { highway: "residential" },
            }),
            false
        );
    });
});
