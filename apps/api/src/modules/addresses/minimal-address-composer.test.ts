import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composeMinimalAddressLine } from "./minimal-address-composer.js";

describe("composeMinimalAddressLine", () => {
    it("composes nearby + full admin hierarchy", () => {
        assert.equal(
            composeMinimalAddressLine({
                nearbyName: "Kyauktan Market",
                township: "Kyauktan Township",
                district: "Yangon South District",
                regionState: "Yangon Region",
            }),
            "Near Kyauktan Market, Kyauktan Township, Yangon South District, Yangon Region, Myanmar"
        );
    });

    it("starts with township when nearby name is missing", () => {
        assert.equal(
            composeMinimalAddressLine({
                township: "Kyauktan Township",
                district: "Yangon South District",
                regionState: "Yangon Region",
            }),
            "Kyauktan Township, Yangon South District, Yangon Region, Myanmar"
        );
    });

    it("omits district when missing", () => {
        assert.equal(
            composeMinimalAddressLine({
                nearbyName: "Kyauktan Market",
                township: "Kyauktan Township",
                regionState: "Yangon Region",
            }),
            "Near Kyauktan Market, Kyauktan Township, Yangon Region, Myanmar"
        );
    });

    it("appends Myanmar when only township is known", () => {
        assert.equal(
            composeMinimalAddressLine({ township: "Kyauktan Township" }),
            "Kyauktan Township, Myanmar"
        );
    });

    it("defaults country to Myanmar with no input at all", () => {
        assert.equal(composeMinimalAddressLine({}), "Myanmar");
    });

    it("uses provided country when present", () => {
        assert.equal(
            composeMinimalAddressLine({ township: "Tachileik Township", country: "Myanmar" }),
            "Tachileik Township, Myanmar"
        );
    });

    it("removes duplicate adjacent admin parts", () => {
        assert.equal(
            composeMinimalAddressLine({
                township: "Yangon",
                district: "Yangon",
                regionState: "Yangon Region",
            }),
            "Yangon, Yangon Region, Myanmar"
        );
    });

    it("trims whitespace and skips blank parts (no double commas)", () => {
        assert.equal(
            composeMinimalAddressLine({
                nearbyName: "  ",
                township: "  Kyauktan Township  ",
                district: "",
                regionState: "Yangon Region",
            }),
            "Kyauktan Township, Yangon Region, Myanmar"
        );
    });
});
