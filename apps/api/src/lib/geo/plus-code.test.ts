import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    decodeOrExpandPlusCode,
    decodePlusCode,
    expandPlusCode,
    generatePlusCode,
    isLikelyPlusCode,
    isLikelyShortPlusCode,
    normalizePlusCodeInput,
} from "./plus-code.js";

// "9FFW84J9+XG" -> ~ (59.332438, 18.118813) (matches generatePlusCode sample).
const FULL_CODE = "9FFW84J9+XG";
const SHORT_CODE = "84J9+XG";
const STOCKHOLM_REF = { lat: 59.332438, lng: 18.118813 };

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

describe("normalizePlusCodeInput", () => {
    it("trims, removes spaces, and uppercases", () => {
        assert.equal(normalizePlusCodeInput("  9ffw 84j9+xg "), FULL_CODE);
    });

    it("returns empty string for non-string input", () => {
        assert.equal(normalizePlusCodeInput(undefined as unknown as string), "");
    });
});

describe("isLikelyPlusCode / isLikelyShortPlusCode", () => {
    it("recognizes a full code", () => {
        assert.equal(isLikelyPlusCode(FULL_CODE), true);
        assert.equal(isLikelyShortPlusCode(FULL_CODE), false);
    });

    it("recognizes a short code", () => {
        assert.equal(isLikelyPlusCode(SHORT_CODE), true);
        assert.equal(isLikelyShortPlusCode(SHORT_CODE), true);
    });

    it("rejects non-codes", () => {
        assert.equal(isLikelyPlusCode("not a code"), false);
        assert.equal(isLikelyPlusCode("INVALID"), false);
        assert.equal(isLikelyShortPlusCode("INVALID"), false);
    });
});

describe("decodePlusCode", () => {
    it("decodes a valid full code", () => {
        const result = decodePlusCode(FULL_CODE);
        assert.ok(result, "expected a decode result");
        assert.equal(result!.normalizedCode, FULL_CODE);
        assert.ok(Math.abs(result!.lat - STOCKHOLM_REF.lat) < 0.01);
        assert.ok(Math.abs(result!.lng - STOCKHOLM_REF.lng) < 0.01);
    });

    it("decodes a lowercase code after normalization", () => {
        const result = decodePlusCode("9ffw84j9+xg");
        assert.ok(result);
        assert.equal(result!.normalizedCode, FULL_CODE);
    });

    it("decodes a code containing spaces", () => {
        const result = decodePlusCode("9FFW 84J9 + XG");
        assert.ok(result);
        assert.equal(result!.normalizedCode, FULL_CODE);
    });

    it("returns null for an invalid code", () => {
        assert.equal(decodePlusCode("INVALID"), null);
        assert.equal(decodePlusCode(""), null);
    });

    it("returns null for a short code (needs a reference)", () => {
        assert.equal(decodePlusCode(SHORT_CODE), null);
    });
});

describe("expandPlusCode", () => {
    it("expands a short code with a reference to the full code", () => {
        assert.equal(expandPlusCode(SHORT_CODE, STOCKHOLM_REF), FULL_CODE);
    });

    it("returns null for a non-finite reference", () => {
        assert.equal(expandPlusCode(SHORT_CODE, { lat: Number.NaN, lng: 0 }), null);
    });
});

describe("decodeOrExpandPlusCode", () => {
    it("resolves a full code without a reference", () => {
        const result = decodeOrExpandPlusCode(FULL_CODE);
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.wasShort, false);
            assert.ok(Math.abs(result.lat - STOCKHOLM_REF.lat) < 0.01);
        }
    });

    it("resolves a short code with a reference", () => {
        const result = decodeOrExpandPlusCode(SHORT_CODE, STOCKHOLM_REF);
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.wasShort, true);
            assert.equal(result.normalizedCode, FULL_CODE);
            assert.ok(Math.abs(result.lat - STOCKHOLM_REF.lat) < 0.01);
        }
    });

    it("returns REFERENCE_REQUIRED for a short code without a reference", () => {
        const result = decodeOrExpandPlusCode(SHORT_CODE);
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.reason, "REFERENCE_REQUIRED");
            assert.equal(result.normalizedCode, SHORT_CODE);
        }
    });

    it("returns INVALID_PLUS_CODE for unparseable input", () => {
        const result = decodeOrExpandPlusCode("definitely not a code");
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.reason, "INVALID_PLUS_CODE");
        }
    });
});
