import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    filterPromotionStageLogs,
    hasUnsettledPromotionStageLogs,
} from "./promotionStageLogs";

describe("promotionStageLogs", () => {
    it("detects unsettled promotion stages only", () => {
        const items = [
            { stage_key: "validate_candidate_state", stage_status: "running" },
            { stage_key: "promote_places_to_core", stage_status: "pending" },
            { stage_key: "update_batch_summary", stage_status: "success" },
        ];
        assert.equal(hasUnsettledPromotionStageLogs(items), true);
        assert.equal(
            hasUnsettledPromotionStageLogs(
                filterPromotionStageLogs(items).map((item) =>
                    item.stage_key === "promote_places_to_core"
                        ? { ...item, stage_status: "success" }
                        : item
                )
            ),
            false
        );
    });
});
