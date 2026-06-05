import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    classifyPublishItemsForPromotion,
    type PublishItemValidationRow,
} from "./import-review-promotion-execution.js";

function row(id: number, status: string, publishStatus = "pending"): PublishItemValidationRow & { publish_status?: string } {
    return {
        publish_item_id: BigInt(id),
        validation_result: {
            status,
            errors: status === "blocked" ? [{ code: "x", message: "blocked", severity: "error" }] : [],
            warnings: [],
            issues: [],
        },
        publish_status: publishStatus,
    };
}

describe("partial batch promotion selection", () => {
    it("promotes only pending ready items when 10 success, 2 failed, 10 blocked, 264 ready", () => {
        const rows: PublishItemValidationRow[] = [];
        for (let i = 1; i <= 264; i += 1) {
            rows.push(row(i, "ready"));
        }
        for (let i = 265; i <= 274; i += 1) {
            rows.push(row(i, "blocked"));
        }
        const selection = classifyPublishItemsForPromotion(rows);
        assert.equal(selection.promotableIds.length, 264);
        assert.equal(selection.skipped_blocked_count, 10);
    });

    it("does not include warning without confirm_warnings", () => {
        const selection = classifyPublishItemsForPromotion([row(1, "warning")], {
            confirm_warnings: false,
        });
        assert.equal(selection.promotableIds.length, 0);
        assert.equal(selection.skipped_warning_count, 1);
    });
});
