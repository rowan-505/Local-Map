import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    appendSampleFailureHint,
    buildPromotionItemFailureRecord,
    buildPublishItemFailureAfterData,
    derivePromotionErrorCode,
    promotionFailureSampleFromRow,
    sanitizePromotionErrorMessage,
} from "./import-review-promotion-failure.js";
import { extractPromotionFailureCause } from "./import-review-promotion-failure-cause.js";

describe("derivePromotionErrorCode", () => {
    it("extracts known prefixed codes", () => {
        assert.equal(
            derivePromotionErrorCode("CATEGORY_REQUIRED: typed category_id is required."),
            "CATEGORY_REQUIRED"
        );
        assert.equal(
            derivePromotionErrorCode("INVALID_CATEGORY_ID: not in ref"),
            "INVALID_CATEGORY_ID"
        );
    });

    it("maps prisma transaction errors to system error", () => {
        assert.equal(
            derivePromotionErrorCode("Place promotion failed: this.prisma.$transaction is not a function"),
            "PROMOTION_SYSTEM_ERROR"
        );
    });
});

describe("sanitizePromotionErrorMessage", () => {
    it("strips prisma stack traces from operator message", () => {
        const msg = sanitizePromotionErrorMessage(
            "Invalid `prisma.$queryRaw()` invocation:\nthis.prisma.$transaction is not a function\n    at foo.ts:12"
        );
        assert.match(msg, /system error/i);
        assert.doesNotMatch(msg, /prisma/i);
    });

    it("keeps readable guard messages", () => {
        const msg = sanitizePromotionErrorMessage(
            "CATEGORY_REQUIRED: typed category_id or class_code must map to ref.ref_poi_categories."
        );
        assert.match(msg, /CATEGORY_REQUIRED/);
    });
});

describe("buildPromotionItemFailureRecord", () => {
    it("stores readable error for failed promotion item", () => {
        const record = buildPromotionItemFailureRecord({
            errorMessage: "CATEGORY_REQUIRED: missing category",
            entityFamily: "places",
            reviewCandidateId: 55n,
            publishItemId: 101n,
            externalId: "osm:node/1",
            targetSchema: "core",
            targetTable: "core_places",
            publishAction: "insert",
        });
        assert.equal(record.error_code, "CATEGORY_REQUIRED");
        assert.match(record.error_message, /category/i);
        assert.equal(record.review_candidate_id, "55");
        assert.equal(record.target_table, "core_places");
        assert.equal(record.external_id, "osm:node/1");
    });

    it("buildPublishItemFailureAfterData includes structured fields for dashboard/history", () => {
        const cause = extractPromotionFailureCause(
            new Error("CATEGORY_REQUIRED: missing category")
        );
        const record = buildPromotionItemFailureRecord({
            errorMessage: "CATEGORY_REQUIRED: missing category",
            entityFamily: "places",
            reviewCandidateId: 55n,
            publishItemId: 101n,
            targetSchema: "core",
            targetTable: "core_places",
            publishAction: "insert",
            failureCause: cause,
        });
        const after = buildPublishItemFailureAfterData(record, cause);
        assert.equal(after.status, "failed");
        assert.equal(after.error_code, "CATEGORY_REQUIRED");
        assert.equal(after.family, "places");
        assert.equal(after.candidate_id, "55");
        assert.equal(after.target_table, "core_places");
    });
});

describe("promotionFailureSampleFromRow", () => {
    it("reads error_code from after_data when present", () => {
        const sample = promotionFailureSampleFromRow({
            id: 10n,
            entity_family: "places",
            review_candidate_id: 55n,
            external_id: "osm:1",
            target_schema: "core",
            target_table: "core_places",
            error_message: "CATEGORY_REQUIRED: missing",
            after_data: {
                status: "failed",
                error_code: "CATEGORY_REQUIRED",
                error_message: "CATEGORY_REQUIRED: missing category",
                message: "CATEGORY_REQUIRED: missing category",
                family: "places",
                candidate_id: "55",
            },
        });
        assert.equal(sample.error_code, "CATEGORY_REQUIRED");
        assert.equal(sample.review_candidate_id, "55");
        assert.equal(sample.target_table, "core_places");
    });
});

describe("appendSampleFailureHint", () => {
    it("appends first sample to summary when failures exist", () => {
        const out = appendSampleFailureHint("Promotion failed. 35 item(s) failed.", [
            {
                publish_item_id: "1",
                entity_family: "places",
                review_candidate_id: "55",
                external_id: null,
                target_schema: "core",
                target_table: "core_places",
                error_code: "CATEGORY_REQUIRED",
                error_message: "missing category",
                reason: "missing category",
            },
        ]);
        assert.match(out, /Example: CATEGORY_REQUIRED/);
    });
});
