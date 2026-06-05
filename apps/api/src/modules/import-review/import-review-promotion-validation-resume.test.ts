import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    outcomeFromPersistedValidationResult,
    partitionPublishItemTargetsForResume,
    publishItemValidationResultIsComplete,
} from "./import-review-promotion-validation-resume.js";
import type { PublishItemValidationTarget } from "./import-review-promotion-simple-batch-validation.js";

function target(id: number): PublishItemValidationTarget {
    return {
        publish_item_id: BigInt(id),
        entity_family: "buildings",
        review_candidate_id: BigInt(1000 + id),
        review_batch_id: 2n,
    };
}

describe("import-review-promotion-validation-resume", () => {
    it("publishItemValidationResultIsComplete requires status", () => {
        assert.equal(publishItemValidationResultIsComplete({}), false);
        assert.equal(publishItemValidationResultIsComplete({ status: "ready", errors: [], warnings: [] }), true);
    });

    it("outcomeFromPersistedValidationResult maps stored JSON", () => {
        const outcome = outcomeFromPersistedValidationResult(target(1), {
            status: "warning",
            errors: [],
            warnings: [{ code: "low_confidence", message: "low" }],
        });
        assert.equal(outcome?.status, "warning");
        assert.equal(outcome?.result.status, "warning");
    });

    it("partitionPublishItemTargetsForResume splits pending vs prior", async () => {
        const targets = [target(1), target(2), target(3)];
        const prisma = {
            $queryRaw: async () => [
                {
                    publish_item_id: 1n,
                    validation_result: { status: "ready", errors: [], warnings: [] },
                },
                { publish_item_id: 2n, validation_result: {} },
                { publish_item_id: 3n, validation_result: { status: "blocked", errors: [{ code: "x", message: "y" }], warnings: [] } },
            ],
        };

        const { pendingTargets, priorOutcomes } = await partitionPublishItemTargetsForResume(
            prisma as never,
            17n,
            targets
        );

        assert.equal(pendingTargets.length, 1);
        assert.equal(pendingTargets[0]?.publish_item_id, 2n);
        assert.equal(priorOutcomes.length, 2);
    });
});
