import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isGeneratedOsmTransportName, normalizeTransportNameInput } from "../../modules/transport/transport-naming.js";
import { enrichTransportStopPrimaryNames } from "./transport-stop-primary-names.js";
import { mapTransportStopNameFields } from "./transport-stop-detail-select-sql.js";

function publicSafeTransportName(value: string | null | undefined): string | null {
    const normalized = normalizeTransportNameInput(value);
    if (normalized === null || isGeneratedOsmTransportName(normalized)) {
        return null;
    }
    return normalized;
}

describe("enrichTransportStopPrimaryNames", () => {
    it("fills name_mm from Myanmar canonical when stop_names my row is missing", () => {
        const result = enrichTransportStopPrimaryNames({
            name_mm: null,
            name_en: "Zarmani",
            name_und: null,
            canonical_name: "ဇာမနီ",
        });

        assert.equal(result.name_mm, "ဇာမနီ");
        assert.equal(result.name_en, "Zarmani");
    });

    it("fills name_mm from Myanmar und row before canonical", () => {
        const result = enrichTransportStopPrimaryNames({
            name_mm: null,
            name_en: "Transliteration",
            name_und: "ထမနီကုမ္ဘေး",
            canonical_name: "raw-cache",
        });

        assert.equal(result.name_mm, "ထမနီကုမ္ဘေး");
    });

    it("does not promote OSM-generated canonical into language fields", () => {
        const mapped = mapTransportStopNameFields(
            {
                name_mm: null,
                name_en: null,
                name_und: null,
                canonical_name: "bus_stop osm:N:5293807821",
            },
            { typeFallback: "Unnamed bus stop", sanitize: publicSafeTransportName },
        );

        assert.equal(mapped.name_mm, null);
        assert.equal(mapped.name_en, null);
        assert.equal(mapped.display_name, "Unnamed bus stop");
    });
});

describe("mapTransportStopNameFields", () => {
    it("returns name_my alias and lang-aware display_name", () => {
        const mapped = mapTransportStopNameFields(
            {
                name_mm: null,
                name_en: "Yay Leone Kyauk Tan pagoda",
                name_und: null,
                canonical_name: "ရေလည်ကျောက်တန်းဘုရား",
            },
            { lang: "my", typeFallback: "Unnamed bus stop" },
        );

        assert.equal(mapped.name_my, "ရေလည်ကျောက်တန်းဘုရား");
        assert.equal(mapped.name_mm, "ရေလည်ကျောက်တန်းဘုရား");
        assert.equal(mapped.display_name, "ရေလည်ကျောက်တန်းဘုရား");
        assert.equal(mapped.name_en, "Yay Leone Kyauk Tan pagoda");
    });

    it("prefers English display when lang=en", () => {
        const mapped = mapTransportStopNameFields(
            {
                name_mm: "ထမနီကုမ္ဘေး",
                name_en: "Htamanikome",
                name_und: null,
                canonical_name: "Htamanikomehtate",
            },
            { lang: "en", typeFallback: "Unnamed bus stop" },
        );

        assert.equal(mapped.display_name, "Htamanikome");
        assert.equal(mapped.name_en, "Htamanikome");
    });
});
