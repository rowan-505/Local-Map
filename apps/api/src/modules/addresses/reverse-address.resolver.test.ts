import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isLocalityHintAdmin, isOfficialAdmin } from "./reverse-address.constants.js";

describe("reverse address admin boundary rules", () => {
    it("treats settlement_extent + locality_hint as locality only", () => {
        assert.equal(isLocalityHintAdmin("settlement_extent", "locality_hint"), true);
        assert.equal(isOfficialAdmin("settlement_extent", "locality_hint"), false);
    });

    it("treats official boundary + official usage as official", () => {
        assert.equal(isOfficialAdmin("official", "official"), true);
        assert.equal(isLocalityHintAdmin("official", "official"), false);
    });

    it("does not treat approximate boundary as official even when usage is official", () => {
        assert.equal(isOfficialAdmin("approximate", "official"), false);
    });
});
