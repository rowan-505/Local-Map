import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    deriveAddressSourceContext,
    deriveAddressSourceContextFromCandidate,
} from "./import-review-address-source-context.js";

describe("import-review-address-source-context", () => {
    it("derives pagoda-style OSM source context", () => {
        const ctx = deriveAddressSourceContext({
            name: "Aung Myay Baw Di Pagoda အောင်မြေဗောဓိဘုရားစေတီတော်မြတ်",
            amenity: "place_of_worship",
            religion: "buddhist",
            "addr:city": "သံလျင်",
            denomination: "theravada",
        });

        assert.equal(ctx.source_name?.startsWith("Aung Myay Baw Di Pagoda"), true);
        assert.equal(ctx.source_type_hint, "place_of_worship");
        assert.equal(ctx.source_category_hint, "amenity=place_of_worship; religion=buddhist; denomination=theravada");
        assert.equal(ctx.raw_relevant_tags["addr:city"], undefined);
        assert.equal(ctx.raw_relevant_tags.amenity, "place_of_worship");
        assert.equal(ctx.raw_relevant_tags.religion, "buddhist");
    });

    it("prefers amenity over shop for type hint", () => {
        const ctx = deriveAddressSourceContext({
            shop: "convenience",
            amenity: "cafe",
        });
        assert.equal(ctx.source_type_hint, "cafe");
    });

    it("reads name:my and name:mm", () => {
        const ctx = deriveAddressSourceContext({ "name:mm": "မြန်မာ", "name:en": "English" });
        assert.equal(ctx.source_name_my, "မြန်မာ");
        assert.equal(ctx.source_name_en, "English");
    });

    it("returns empty context for non-object tags", () => {
        const ctx = deriveAddressSourceContext(null);
        assert.equal(ctx.source_name, null);
        assert.equal(ctx.source_type_hint, null);
        assert.deepEqual(ctx.raw_relevant_tags, {});
    });

    it("falls back to normalized_data.tags when source_tags.name is missing", () => {
        const ctx = deriveAddressSourceContextFromCandidate({
            source_tags: { "addr:city": "သံလျင်" },
            normalized_data: {
                tags: {
                    name: "Aung Myay Baw Di Pagoda",
                    amenity: "place_of_worship",
                },
            },
        });
        assert.equal(ctx.source_name, "Aung Myay Baw Di Pagoda");
        assert.equal(ctx.source_type_hint, "place_of_worship");
    });
});
