import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    coreVerificationFamilyRedirectTarget,
    coreVerificationOverviewRedirectTarget,
} from "./coreVerificationRedirects.js";

describe("coreVerificationRedirects", () => {
    it("redirects overview to core review", () => {
        assert.equal(coreVerificationOverviewRedirectTarget(), "/dashboard/core-review");
    });

    it("redirects mapped families to core review with unverified filter", () => {
        assert.equal(
            coreVerificationFamilyRedirectTarget("buildings"),
            "/dashboard/core-review/buildings?verification_status=unverified"
        );
        assert.equal(
            coreVerificationFamilyRedirectTarget("bus-stops"),
            "/dashboard/core-review/bus-stops?verification_status=unverified"
        );
    });

    it("redirects unmapped families to core review overview", () => {
        assert.equal(coreVerificationFamilyRedirectTarget("routing-barriers"), "/dashboard/core-review");
        assert.equal(coreVerificationFamilyRedirectTarget("bus-route-stops"), "/dashboard/core-review");
        assert.equal(coreVerificationFamilyRedirectTarget("unknown-family"), "/dashboard/core-review");
    });
});
