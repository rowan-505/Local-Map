import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatPromotionSelectedCandidateErrorDetails } from "./formatPromotionSelectedCandidateError.js";

describe("formatPromotionSelectedCandidateErrorDetails", () => {
    it("formats already_promoted details", () => {
        const text = formatPromotionSelectedCandidateErrorDetails({
            reason: "already_promoted",
            promoted_core_id: "1001",
            promoted_at: "2024-06-01T12:00:00.000Z",
            target_table: "core.core_places",
        });
        assert.ok(text);
        assert.match(text, /already promoted/i);
        assert.match(text, /1001/);
        assert.match(text, /core\.core_places/);
    });
});
