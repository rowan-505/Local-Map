import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composeAddress } from "./address-composer.js";
import type { AddressComposerComponent } from "./address-composer.types.js";

function comp(
    partial: AddressComposerComponent & { language_code?: string }
): AddressComposerComponent {
    return {
        ...partial,
        language_code: partial.language_code ?? "und",
    };
}

describe("composeAddress", () => {
    it("composes Kyauktan sample English line from mixed components", () => {
        const result = composeAddress({
            components: [
                comp({ component_type_code: "house_number", component_value: "No.A1", language_code: "und" }),
                comp({
                    component_type_code: "street",
                    component_value: "Thanlyin-KyaukTan Road",
                    language_code: "en",
                }),
                comp({
                    component_type_code: "township",
                    component_value: "Kyauktan Township",
                    language_code: "en",
                }),
                comp({
                    component_type_code: "region",
                    component_value: "Yangon Region",
                    language_code: "en",
                }),
                comp({ component_type_code: "postcode", component_value: "11301", language_code: "und" }),
                comp({ component_type_code: "country", component_value: "MM", language_code: "und" }),
            ],
            displayLanguage: "en",
        });

        assert.equal(
            result.full_address_en,
            "No.A1, Thanlyin-KyaukTan Road, Kyauktan Township, Yangon Region, 11301, MM"
        );
        assert.equal(result.display_full_address, result.full_address_en);
        assert.equal(result.components_by_type.house_number?.used_in_en, "No.A1");
        assert.equal(result.components_by_type.street?.used_in_en, "Thanlyin-KyaukTan Road");
        assert.equal(result.warnings.length, 0);
    });

    it("Myanmar line uses my then und; skips en-only locality lines", () => {
        const result = composeAddress({
            components: [
                comp({ component_type_code: "house_number", component_value: "No.A1", language_code: "und" }),
                comp({
                    component_type_code: "street",
                    component_value: "Thanlyin-KyaukTan Road",
                    language_code: "en",
                }),
                comp({
                    component_type_code: "township",
                    component_value: "Kyauktan Township",
                    language_code: "en",
                }),
                comp({ component_type_code: "postcode", component_value: "11301", language_code: "und" }),
                comp({ component_type_code: "country", component_value: "MM", language_code: "und" }),
            ],
            displayLanguage: "my",
        });

        assert.equal(result.full_address_my, "No.A1၊ 11301၊ MM");
        assert.equal(result.display_full_address, result.full_address_my);
        assert.equal(result.components_by_type.street?.used_in_my, null);
        assert.equal(result.components_by_type.township?.used_in_my, null);
    });

    it("prefers my script street for Myanmar and en for English", () => {
        const result = composeAddress({
            components: [
                comp({ component_type_code: "street", component_value: "Main Road", language_code: "en" }),
                comp({ component_type_code: "street", component_value: "လမ်းကြီး", language_code: "my" }),
            ],
        });

        assert.equal(result.full_address_en, "Main Road");
        assert.equal(result.full_address_my, "လမ်းကြီး");
    });

    it("skips duplicate road when same as street", () => {
        const result = composeAddress({
            components: [
                comp({ component_type_code: "street", component_value: "Main St", language_code: "en" }),
                comp({ component_type_code: "road", component_value: "Main St", language_code: "en" }),
            ],
        });

        assert.equal(result.full_address_en, "Main St");
        assert.ok(result.warnings.some((w) => w.includes("duplicate road")));
    });

    it("skips duplicate adjacent segments", () => {
        const result = composeAddress({
            components: [
                comp({ component_type_code: "city", component_value: "Yangon", language_code: "en" }),
                comp({ component_type_code: "township", component_value: "Yangon", language_code: "en" }),
            ],
        });

        assert.equal(result.full_address_en, "Yangon");
        assert.ok(result.warnings.some((w) => w.includes("duplicate adjacent")));
    });

    it("display_language en falls back to my when en empty", () => {
        const result = composeAddress({
            components: [
                comp({ component_type_code: "village", component_value: "ကျေးရွာ", language_code: "my" }),
            ],
            displayLanguage: "en",
        });

        assert.equal(result.full_address_en, null);
        assert.equal(result.full_address_my, "ကျေးရွာ");
        assert.equal(result.display_full_address, "ကျေးရွာ");
    });

    it("returns null addresses for empty components", () => {
        const result = composeAddress({ components: [] });
        assert.equal(result.full_address_en, null);
        assert.equal(result.full_address_my, null);
        assert.equal(result.display_full_address, null);
    });

    it("warns and skips unknown component types", () => {
        const result = composeAddress({
            components: [
                comp({ component_type_code: "unknown_type", component_value: "X", language_code: "und" }),
                comp({ component_type_code: "country", component_value: "MM", language_code: "und" }),
            ],
        });

        assert.equal(result.full_address_en, "MM");
        assert.ok(result.warnings.some((w) => w.includes("unknown_type")));
    });
});
