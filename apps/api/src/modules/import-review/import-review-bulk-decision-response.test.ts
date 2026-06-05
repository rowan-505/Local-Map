import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bulkImportReviewBuildingDecisionBodySchema } from "./import-review.schema.js";
import { ImportReviewBulkDuplicateApprovalError } from "./import-review-errors.js";
import { sendImportReviewError } from "./import-review-error-handler.js";

function mockReply() {
    let statusCode = 0;
    let payload: unknown;
    return {
        code(code: number) {
            statusCode = code;
            return this;
        },
        send(body: unknown) {
            payload = body;
            return this;
        },
        get statusCode() {
            return statusCode;
        },
        get payload() {
            return payload;
        },
    };
}

describe("bulkImportReviewBuildingDecisionBodySchema aliases", () => {
    const base = {
        review_batch_id: "2",
        review_decision: "approved" as const,
        ids: [1],
    };

    it("maps force_approval to force", () => {
        const parsed = bulkImportReviewBuildingDecisionBodySchema.parse({
            ...base,
            force_approval: true,
        });
        assert.equal(parsed.force, true);
    });

    it("accepts matching review_status", () => {
        const parsed = bulkImportReviewBuildingDecisionBodySchema.parse({
            ...base,
            review_status: "approved",
        });
        assert.equal(parsed.review_status, "approved");
    });

    it("rejects mismatched review_status", () => {
        assert.throws(() =>
            bulkImportReviewBuildingDecisionBodySchema.parse({
                ...base,
                review_status: "rejected",
            })
        );
    });
});

describe("ImportReviewBulkDuplicateApprovalError", () => {
    it("returns 409 with duplicate_ids via error handler", () => {
        const reply = mockReply();
        const err = new ImportReviewBulkDuplicateApprovalError([12, 34]);
        const sent = sendImportReviewError(reply as never, err);
        assert.equal(sent, true);
        assert.equal(reply.statusCode, 409);
        const body = reply.payload as {
            ok: false;
            error: string;
            message: string;
            details: { duplicate_ids: number[] };
        };
        assert.equal(body.error, "BULK_DUPLICATE_APPROVAL_REQUIRED");
        assert.deepEqual(body.details.duplicate_ids, [12, 34]);
        assert.match(body.message, /force approval/i);
    });
});
