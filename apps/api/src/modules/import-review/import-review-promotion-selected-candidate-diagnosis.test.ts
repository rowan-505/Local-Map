import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import {
    diagnoseSelectedCandidateFromRow,
    type SelectedCandidateEligibilityRow,
} from "./import-review-promotion-selected-candidate-diagnosis.js";

const placesConfig = getImportReviewPublishFamilyConfig("places")!;

function baseRow(overrides: Partial<SelectedCandidateEligibilityRow> = {}): SelectedCandidateEligibilityRow {
    return {
        id: 59n,
        review_batch_id: 2n,
        review_status: "approved",
        review_decision: "approved",
        promotion_status: "ready",
        match_status: null,
        auto_action: null,
        review_note: null,
        validation_errors: null,
        validation_warnings: null,
        promoted_core_id: null,
        promoted_at: null,
        ...overrides,
    };
}

describe("diagnoseSelectedCandidateFromRow", () => {
    it("returns already_promoted with core id and target table", () => {
        const diagnosis = diagnoseSelectedCandidateFromRow({
            config: placesConfig,
            reviewBatchId: 2n,
            row: baseRow({
                promotion_status: "promoted",
                promoted_core_id: 1001n,
                promoted_at: new Date("2024-06-01T12:00:00.000Z"),
            }),
            filters: { review_decision: "approved", include_warnings: false },
            activePublishBatchId: null,
        });
        assert.ok(diagnosis);
        assert.equal(diagnosis.reason, "already_promoted");
        assert.equal(diagnosis.details.promoted_core_id, "1001");
        assert.equal(diagnosis.details.target_table, "core.core_places");
        assert.match(diagnosis.message, /already promoted/);
        assert.match(diagnosis.message, /1001/);
    });

    it("returns not_approved when review_decision is not approved", () => {
        const diagnosis = diagnoseSelectedCandidateFromRow({
            config: placesConfig,
            reviewBatchId: 2n,
            row: baseRow({ review_decision: "rejected" }),
            filters: { review_decision: "approved", include_warnings: false },
            activePublishBatchId: null,
        });
        assert.ok(diagnosis);
        assert.equal(diagnosis.reason, "not_approved");
        assert.equal(diagnosis.details.review_decision, "rejected");
        assert.match(diagnosis.message, /review_decision "rejected"/);
    });

    it("returns validation_blocked when validation_errors are present", () => {
        const diagnosis = diagnoseSelectedCandidateFromRow({
            config: placesConfig,
            reviewBatchId: 2n,
            row: baseRow({
                validation_errors: [{ code: "invalid_value", field: "name_en", message: "Invalid name" }],
            }),
            filters: { review_decision: "approved", include_warnings: false },
            activePublishBatchId: null,
        });
        assert.ok(diagnosis);
        assert.equal(diagnosis.reason, "validation_blocked");
        assert.ok(Array.isArray(diagnosis.details.validation_errors));
    });

    it("returns null for an eligible row", () => {
        const diagnosis = diagnoseSelectedCandidateFromRow({
            config: placesConfig,
            reviewBatchId: 2n,
            row: baseRow(),
            filters: { review_decision: "approved", include_warnings: false },
            activePublishBatchId: null,
        });
        assert.equal(diagnosis, null);
    });

    it("allows retry after failed promotion (promotion_failed + failed status)", () => {
        const diagnosis = diagnoseSelectedCandidateFromRow({
            config: placesConfig,
            reviewBatchId: 2n,
            row: baseRow({
                review_status: "promotion_failed",
                promotion_status: "failed",
            }),
            filters: { review_decision: "approved", include_warnings: false },
            activePublishBatchId: null,
        });
        assert.equal(diagnosis, null);
    });

    it("does not treat review_status=promoted without promoted_core_id as already promoted", () => {
        const diagnosis = diagnoseSelectedCandidateFromRow({
            config: placesConfig,
            reviewBatchId: 2n,
            row: baseRow({
                review_status: "promoted",
                promotion_status: "failed",
                promoted_core_id: null,
            }),
            filters: { review_decision: "approved", include_warnings: false },
            activePublishBatchId: null,
        });
        assert.ok(!diagnosis || diagnosis.reason !== "already_promoted");
    });
});
