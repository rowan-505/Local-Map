import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    SHARE_CODE_ALPHABET,
    SHARE_CODE_REGEX,
    createShareLinkBodySchema,
    shareCodeParamSchema,
} from "./share.schema.js";

describe("createShareLinkBodySchema", () => {
    it("accepts a valid point payload", () => {
        const result = createShareLinkBodySchema.safeParse({
            target_type: "point",
            lat: 16.639454,
            lng: 96.322949,
            zoom: 17,
            address_line: "Kyauktan Township, Yangon Region, Myanmar",
            plus_code: "7M8RJ8QF+Q5",
        });

        assert.equal(result.success, true);
    });

    it("accepts a point payload without the optional snapshot fields", () => {
        const result = createShareLinkBodySchema.safeParse({
            target_type: "point",
            lat: 16.639454,
            lng: 96.322949,
        });

        assert.equal(result.success, true);
    });

    it("accepts a valid place payload", () => {
        const result = createShareLinkBodySchema.safeParse({
            target_type: "place",
            place_public_id: "1f3d2c4e-5a6b-4c8d-9e0f-1a2b3c4d5e6f",
        });

        assert.equal(result.success, true);
    });

    it("rejects out-of-range latitude", () => {
        const result = createShareLinkBodySchema.safeParse({
            target_type: "point",
            lat: 200,
            lng: 96.322949,
        });

        assert.equal(result.success, false);
    });

    it("rejects out-of-range longitude", () => {
        const result = createShareLinkBodySchema.safeParse({
            target_type: "point",
            lat: 16.639454,
            lng: -500,
        });

        assert.equal(result.success, false);
    });

    it("rejects a point payload missing coordinates", () => {
        const result = createShareLinkBodySchema.safeParse({
            target_type: "point",
            zoom: 17,
        });

        assert.equal(result.success, false);
    });

    it("rejects a place payload with a non-uuid place_public_id", () => {
        const result = createShareLinkBodySchema.safeParse({
            target_type: "place",
            place_public_id: "not-a-uuid",
        });

        assert.equal(result.success, false);
    });

    it("rejects an unknown target_type", () => {
        const result = createShareLinkBodySchema.safeParse({
            target_type: "external",
            lat: 16.6,
            lng: 96.3,
        });

        assert.equal(result.success, false);
    });
});

describe("shareCodeParamSchema", () => {
    it("accepts a well-formed code", () => {
        assert.equal(shareCodeParamSchema.safeParse({ code: "kT82Lm" }).success, true);
    });

    it("rejects codes that are too short or too long", () => {
        assert.equal(shareCodeParamSchema.safeParse({ code: "abcde" }).success, false);
        assert.equal(shareCodeParamSchema.safeParse({ code: "abcdefghi" }).success, false);
    });

    it("rejects codes containing excluded/confusing characters", () => {
        // 0, O, I, l, 1 are intentionally absent from the alphabet.
        for (const bad of ["abc0de", "abcOde", "abcIde", "abclde", "abc1de"]) {
            assert.equal(
                shareCodeParamSchema.safeParse({ code: bad }).success,
                false,
                `expected ${bad} to be rejected`,
            );
        }
    });
});

describe("SHARE_CODE_ALPHABET", () => {
    it("excludes visually confusing characters", () => {
        for (const ch of ["0", "O", "I", "l", "1"]) {
            assert.equal(SHARE_CODE_ALPHABET.includes(ch), false, `alphabet must not contain ${ch}`);
        }
    });

    it("regex matches only the alphabet at 6-8 length", () => {
        assert.equal(SHARE_CODE_REGEX.test("ABCDEF"), true);
        assert.equal(SHARE_CODE_REGEX.test("aB3kPq9"), true);
        assert.equal(SHARE_CODE_REGEX.test("aB3kPq9z"), true);
        assert.equal(SHARE_CODE_REGEX.test("aB3kPq9zX"), false);
    });
});
