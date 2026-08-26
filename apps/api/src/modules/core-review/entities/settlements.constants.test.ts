import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    SETTLEMENT_TYPE_CODES,
    SETTLEMENT_TYPE_LABELS,
    isSettlementTypeCode,
} from "./settlements.constants.js";

describe("settlement type codes", () => {
    it("keeps City, Town, Village, and Local Area codes stable", () => {
        assert.deepEqual([...SETTLEMENT_TYPE_CODES], ["city", "town", "village", "local_area"]);
        assert.equal(SETTLEMENT_TYPE_LABELS.city, "City");
        assert.equal(SETTLEMENT_TYPE_LABELS.town, "Town");
        assert.equal(SETTLEMENT_TYPE_LABELS.village, "Village");
        assert.equal(SETTLEMENT_TYPE_LABELS.local_area, "Local Area");
        assert.equal(isSettlementTypeCode("city"), true);
        assert.equal(isSettlementTypeCode("local_area"), true);
        assert.equal(isSettlementTypeCode("City"), false);
    });
});
