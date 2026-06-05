import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import { buildFamilyEligibilityCountSql } from "./import-review-promotion-eligibility.js";
import { buildFamilyEligibilityReadonlyCountSql } from "./import-review-promotion-eligibility-readonly.js";
import {
    buildReadonlyPromotionEligibilityFamilyRow,
    buildReadonlyPromotionEligibilityResponse,
    isPrismaPoolTimeoutError,
    mapFamilyEligibilityReadonlyCounts,
} from "./import-review-promotion-eligibility-api.js";

describe("import-review promotion eligibility readonly", () => {
    it("readonly count SQL is SELECT-only and does not reference publish-item writes", () => {
        const cfg = getImportReviewPublishFamilyConfig("roads");
        assert.ok(cfg);
        const sql = buildFamilyEligibilityReadonlyCountSql(cfg, 2n).strings.join(" ");
        assert.match(sql, /SELECT/i);
        assert.doesNotMatch(sql, /\bUPDATE\b/i);
        assert.doesNotMatch(sql, /\bINSERT\b/i);
        assert.doesNotMatch(sql, /system_publish_items/i);
    });

    it("heavy eligibility SQL still exists for batch create but is not used by readonly builder", () => {
        const cfg = getImportReviewPublishFamilyConfig("roads");
        assert.ok(cfg);
        const heavy = buildFamilyEligibilityCountSql(cfg, 2n, {
            includeWarnings: false,
            includeMerged: false,
        }).strings.join(" ");
        assert.match(heavy, /system_publish_items/i);
    });

    it("maps stored readonly counts to API fields", () => {
        const mapped = mapFamilyEligibilityReadonlyCounts({
            entity_family: "places",
            table_name: "import_review.place_candidates",
            approved_count: 10n,
            ready_existing_count: 4n,
            blocked_existing_count: 1n,
            warning_existing_count: 2n,
            already_batched_count: 3n,
            already_promoted_count: 5n,
        });
        assert.equal(mapped.approved_count, 10);
        assert.equal(mapped.ready_existing_count, 4);
        assert.equal(mapped.ready, 4);
        assert.equal(mapped.already_promoted_count, 5);
    });

    it("returns per-family DB_POOL_TIMEOUT without failing the whole response builder", () => {
        const cfg = getImportReviewPublishFamilyConfig("roads");
        assert.ok(cfg);
        const row = buildReadonlyPromotionEligibilityFamilyRow({
            config: cfg,
            row: null,
            countError: {
                ok: false,
                code: "DB_POOL_TIMEOUT",
                message: "Database connection timed out while loading counts. Try one family or refresh.",
            },
        });
        assert.equal(row.counts_ok, false);
        assert.equal(row.count_error?.code, "DB_POOL_TIMEOUT");

        const response = buildReadonlyPromotionEligibilityResponse({
            reviewBatchId: 2n,
            familyRows: [row],
            includeWarnings: false,
        });
        assert.equal(response.families.length, 1);
        assert.equal(response.can_create_batch, false);
    });

    it("detects Prisma pool timeout code P2024", () => {
        assert.equal(isPrismaPoolTimeoutError({ code: "P2024" }), true);
        assert.equal(isPrismaPoolTimeoutError({ code: "P2002" }), false);
    });
});
