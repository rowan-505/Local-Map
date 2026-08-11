import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveBuildingDisplayNameFromPriority } from "./derive-display-name.js";

describe("deriveBuildingDisplayNameFromPriority", () => {
    it("prefers official primary over imported primary", () => {
        const name = deriveBuildingDisplayNameFromPriority([
            { name: "Imported", nameType: "imported", isPrimary: true, searchWeight: 100 },
            { name: "Official", nameType: "official", isPrimary: true, searchWeight: 50 },
        ]);
        assert.equal(name, "Official");
    });

    it("prefers local primary before imported primary", () => {
        const name = deriveBuildingDisplayNameFromPriority([
            { name: "Imported", nameType: "imported", isPrimary: true, searchWeight: 100 },
            { name: "Local", nameType: "local", isPrimary: true, searchWeight: 40 },
        ]);
        assert.equal(name, "Local");
    });

    it("returns null for empty input", () => {
        assert.equal(deriveBuildingDisplayNameFromPriority([]), null);
    });
});
