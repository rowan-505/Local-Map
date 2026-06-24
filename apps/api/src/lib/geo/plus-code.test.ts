import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generatePlusCode } from "./plus-code.js";

describe("generatePlusCode", () => {
    it("returns a full 10-digit plus code for valid coordinates", () => {
        const code = generatePlusCode(16.123456, 96.123456);
        assert.ok(code, "expected a plus code");
        // Full code: 8 chars, '+', then 2+ chars.
        assert.match(code!, /^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,}$/);
    });

    it("matches the reference implementation sample", () => {
        assert.equal(generatePlusCode(59.332438, 18.118813), "9FFW84J9+XG");
    });

    it("returns null for out-of-range latitude", () => {
        assert.equal(generatePlusCode(91, 96), null);
        assert.equal(generatePlusCode(-90.01, 96), null);
    });

    it("returns null for out-of-range longitude", () => {
        assert.equal(generatePlusCode(16, 180.01), null);
        assert.equal(generatePlusCode(16, -181), null);
    });

    it("returns null for non-finite input", () => {
        assert.equal(generatePlusCode(Number.NaN, 96), null);
        assert.equal(generatePlusCode(16, Number.POSITIVE_INFINITY), null);
    });

    it("accepts boundary coordinates", () => {
        assert.ok(generatePlusCode(-90, -180));
        assert.ok(generatePlusCode(90, 180));
    });
});
