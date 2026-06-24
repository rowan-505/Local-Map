import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyReply } from "fastify";

import { buildApiErrorResponse } from "../../lib/api-error-response.js";
import { sendImportReviewError } from "./import-review-error-handler.js";
import {
    buildPromotionEligibilityResponse,
    mapFamilyEligibilityCounts,
    parsePromotionEligibilityFamiliesParam,
} from "./import-review-promotion-eligibility-api.js";
import { isRoadPromotionBlockingStoredIssue } from "./import-review-road-promotion-policy.js";
import type { FamilyEligibilityCountDb } from "./import-review-promotion-eligibility.js";
import { IMPORT_REVIEW_PROMOTION_TARGETS } from "./import-review-promotion-config.js";
import {
    coercePromotionFamiliesQuery,
    importReviewPromotionEligibilityQuerySchema,
} from "./import-review-promotion.schema.js";
import {
    ImportReviewPromotionUnknownFamilyError,
} from "./import-review-promotion.errors.js";
import { getImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";

function sampleCountRow(
    entityFamily: string,
    overrides: Partial<FamilyEligibilityCountDb> = {}
): FamilyEligibilityCountDb {
    return {
        entity_family: entityFamily,
        table_name: `import_review.${entityFamily}_candidates`,
        approved_ready: 10n,
        with_warnings: 2n,
        blocked: 1n,
        already_promoted: 3n,
        excluded: 4n,
        has_validation_errors: 1n,
        manual_protected: 0n,
        duplicate_unconfirmed: 1n,
        rejected_decision: 2n,
        ...overrides,
    };
}

describe("import-review promotion eligibility API", () => {
    it("parses comma-separated families query", () => {
        assert.deepEqual(coercePromotionFamiliesQuery("buildings,places"), ["buildings", "places"]);
        assert.deepEqual(coercePromotionFamiliesQuery(" buildings , places "), ["buildings", "places"]);
    });

    it("requires families in query schema", () => {
        const missing = importReviewPromotionEligibilityQuerySchema.safeParse({
            review_batch_id: "2",
        });
        assert.equal(missing.success, false);

        const empty = importReviewPromotionEligibilityQuerySchema.safeParse({
            review_batch_id: "2",
            families: "",
        });
        assert.equal(empty.success, false);
    });

    it("resolves buildings only", () => {
        const configs = parsePromotionEligibilityFamiliesParam(["buildings"]);
        assert.deepEqual(
            configs.map((c) => c.entityFamily),
            ["buildings"]
        );
        assert.equal(configs[0]?.coreTargetTable, IMPORT_REVIEW_PROMOTION_TARGETS.buildings);
    });

    it("resolves buildings and places", () => {
        const configs = parsePromotionEligibilityFamiliesParam(["buildings", "places"]);
        assert.deepEqual(
            configs.map((c) => c.entityFamily),
            ["buildings", "places"]
        );
    });

    it("maps routing_barriers target to routing.routing_barriers", () => {
        const configs = parsePromotionEligibilityFamiliesParam(["routing_barriers"]);
        assert.equal(configs[0]?.coreTargetTable, "routing.routing_barriers");

        const response = buildPromotionEligibilityResponse({
            reviewBatchId: 2n,
            familyConfigs: configs,
            countRows: [sampleCountRow("routing_barriers")],
            includeWarnings: false,
        });
        assert.equal(response.families[0]?.target, "routing.routing_barriers");
        assert.match(response.messages.join(" "), /routing\.routing_barriers/);
    });

    it("maps normal families to core.* targets in response", () => {
        const configs = parsePromotionEligibilityFamiliesParam(["buildings", "places"]);
        const response = buildPromotionEligibilityResponse({
            reviewBatchId: 2n,
            familyConfigs: configs,
            countRows: [
                sampleCountRow("buildings"),
                sampleCountRow("places", { approved_ready: 5n }),
            ],
            includeWarnings: false,
        });
        for (const row of response.families) {
            assert.match(row.target, /^core\./);
        }
    });

    it("rejects unknown family with typed error", () => {
        assert.throws(
            () => parsePromotionEligibilityFamiliesParam(["not_a_real_family"]),
            (err: unknown) => err instanceof ImportReviewPromotionUnknownFamilyError
        );
    });

    it("rejects empty families selection", () => {
        assert.throws(() => parsePromotionEligibilityFamiliesParam([]), /families is required/);
    });

    it("maps SQL counts to ready, warnings, batched, promoted, and blocked buckets", () => {
        const mapped = mapFamilyEligibilityCounts(sampleCountRow("buildings"));
        assert.equal(mapped.ready, 10);
        assert.equal(mapped.warnings, 2);
        assert.equal(mapped.batched, 1);
        assert.equal(mapped.promoted, 3);
        assert.equal(mapped.blocked, 4);
    });

    it("maps roads blocked to excluded only (review_batch_id=2 style buckets)", () => {
        const mapped = mapFamilyEligibilityCounts({
            entity_family: "roads",
            table_name: "import_review.road_candidates",
            approved_ready: 276n,
            with_warnings: 525n,
            blocked: 0n,
            already_promoted: 0n,
            excluded: 2n,
            has_validation_errors: 0n,
            manual_protected: 0n,
            duplicate_unconfirmed: 2n,
            rejected_decision: 0n,
        });
        assert.equal(mapped.ready, 276);
        assert.equal(mapped.warnings, 525);
        assert.equal(mapped.blocked, 2);
        assert.equal(mapped.ready + mapped.warnings + mapped.blocked, 803);
    });

    it("does not count warning-only validation_errors strings as blocked", () => {
        assert.equal(isRoadPromotionBlockingStoredIssue("ROAD_TOO_SHORT"), false);
        assert.equal(isRoadPromotionBlockingStoredIssue("OUTSIDE_REVIEW_BOUNDARY"), false);
        assert.equal(isRoadPromotionBlockingStoredIssue("GEOMETRY_INVALID"), true);
    });

    it("include_warnings=false surfaces warning exclusion in messages", () => {
        const cfg = getImportReviewPublishFamilyConfig("buildings");
        assert.ok(cfg);
        const response = buildPromotionEligibilityResponse({
            reviewBatchId: 2n,
            familyConfigs: [cfg],
            countRows: [sampleCountRow("buildings", { with_warnings: 7n })],
            includeWarnings: false,
        });
        assert.equal(response.totals.warnings, 7);
        assert.match(response.messages.join(" "), /include_warnings=true/);
    });

    it("include_warnings=true notes warnings are included in ready", () => {
        const cfg = getImportReviewPublishFamilyConfig("buildings");
        assert.ok(cfg);
        const response = buildPromotionEligibilityResponse({
            reviewBatchId: 2n,
            familyConfigs: [cfg],
            countRows: [sampleCountRow("buildings", { approved_ready: 12n, with_warnings: 4n })],
            includeWarnings: true,
        });
        assert.match(response.messages.join(" "), /include_warnings=true/);
        assert.equal(response.can_create_batch, true);
    });

    it("maps unknown family error to PROMOTION_UNKNOWN_ENTITY_FAMILY API response", () => {
        let status = 0;
        let body: unknown;
        const reply = {
            code(code: number) {
                status = code;
                return {
                    send(payload: unknown) {
                        body = payload;
                    },
                };
            },
        } as FastifyReply;

        const sent = sendImportReviewError(reply, new ImportReviewPromotionUnknownFamilyError("nope"));

        assert.equal(sent, true);
        assert.equal(status, 400);
        assert.deepEqual(
            body,
            buildApiErrorResponse("PROMOTION_UNKNOWN_ENTITY_FAMILY", "Unknown import review promotion entity family: nope", {
                family: "nope",
            })
        );
    });
});
