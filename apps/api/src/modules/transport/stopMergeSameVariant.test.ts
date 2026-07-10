import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TransportReviewGuardError } from "./transport.errors.js";
import {
    assertSameVariantMergeAcknowledged,
    buildSameVariantMergeWarning,
    STOP_MERGE_SAME_VARIANT_WARNING,
} from "./stopMergeSameVariant.js";

describe("buildSameVariantMergeWarning", () => {
    it("returns warning text when conflicts exist", () => {
        assert.equal(buildSameVariantMergeWarning(2), STOP_MERGE_SAME_VARIANT_WARNING);
    });

    it("returns null when there are no conflicts", () => {
        assert.equal(buildSameVariantMergeWarning(0), null);
    });
});

describe("assertSameVariantMergeAcknowledged", () => {
    it("allows merge when conflicts exist and acknowledgment is true", () => {
        assert.doesNotThrow(() => assertSameVariantMergeAcknowledged(1, true));
    });

    it("blocks merge when conflicts exist without acknowledgment", () => {
        assert.throws(
            () => assertSameVariantMergeAcknowledged(1, false),
            (error: unknown) => {
                assert.ok(error instanceof TransportReviewGuardError);
                assert.equal(error.code, "MERGE_VARIANT_ACK_REQUIRED");
                return true;
            },
        );
    });

    it("does nothing when there are no conflicts", () => {
        assert.doesNotThrow(() => assertSameVariantMergeAcknowledged(0, false));
    });
});
