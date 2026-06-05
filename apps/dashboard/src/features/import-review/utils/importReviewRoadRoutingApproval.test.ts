import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import {
    buildRoadDecisionPatchBody,
    roadApprovalBlockingErrors,
} from "./importReviewRoadRoutingApproval.js";

function roadRow(overrides: Partial<ImportReviewBuildingListItem> = {}): ImportReviewBuildingListItem {
    return {
        id: "1",
        validation_errors: [],
        validation_warnings: [{ code: "routing_validation", message: "Endpoint not snapped" }],
        review_note: null,
        ...overrides,
    } as ImportReviewBuildingListItem;
}

describe("importReviewRoadRoutingApproval", () => {
    it("does not send confirm_routing_warnings on approve", () => {
        const body = buildRoadDecisionPatchBody({
            scopeBody: { review_batch_id: "2" },
            row: roadRow(),
            decision: "approved",
            isRoadFamily: true,
        });
        assert.equal(body.confirm_routing_warnings, undefined);
    });

    it("roadApprovalBlockingErrors reads validation_errors only", () => {
        const blocking = roadApprovalBlockingErrors(
            roadRow({
                validation_errors: [{ code: "GEOMETRY_MISSING", message: "missing" }],
                validation_warnings: [{ code: "ROAD_ISLAND", message: "island" }],
            })
        );
        assert.equal(blocking.length, 1);
        assert.match(blocking[0] ?? "", /missing/i);
    });
});
