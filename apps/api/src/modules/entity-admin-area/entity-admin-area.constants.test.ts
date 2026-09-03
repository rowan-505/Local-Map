import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    canOverrideEntityAdminAreaGeometryMismatch,
    ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES,
} from "./entity-admin-area.constants.js";

describe("entity admin area constants", () => {
    it("forbids country/region/district/ward level codes for entity assignment", () => {
        assert.ok(ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES.has("myanmar"));
        assert.ok(ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES.has("region"));
        assert.ok(ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES.has("district"));
        assert.ok(ENTITY_ADMIN_AREA_FORBIDDEN_LEVEL_CODES.has("ward"));
    });

    it("only admin role may override geometry mismatch", () => {
        assert.equal(canOverrideEntityAdminAreaGeometryMismatch(["viewer"]), false);
        assert.equal(canOverrideEntityAdminAreaGeometryMismatch(["admin"]), true);
    });
});
