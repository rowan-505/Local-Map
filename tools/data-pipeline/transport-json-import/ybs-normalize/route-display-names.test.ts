import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildVariantCode } from "../ybs-db-prepare/stop-normalize.js";
import { actionBelongsToRoute } from "../ybs-supabase-import/lib/import-executor.js";
import type { PlanAction } from "../ybs-supabase-import/lib/import-plan-types.js";
import {
    buildYbsDisplayCode,
    buildYbsRouteCode,
    normalizeYbsRouteDisplayNames,
    routeCodeSuffix,
    validateStoredRouteDisplayNames,
} from "./route-display-names.js";

function makeRouteAction(externalId: string): PlanAction {
    return {
        action: "insert_route_stop",
        entity_type: "route_stop",
        external_id: externalId,
        entity_ref: externalId,
        payload: {},
    };
}

describe("route-display-names hyphenated A/B/C codes", () => {
    it("parses suffix from YBS-7-A and legacy YBS-7A", () => {
        assert.equal(routeCodeSuffix("YBS-7-A"), "A");
        assert.equal(routeCodeSuffix("YBS-7A"), "A");
        assert.equal(routeCodeSuffix("YBS-7"), "");
    });

    it("builds hyphenated route and display codes", () => {
        assert.equal(buildYbsRouteCode(7, "A"), "YBS-7-A");
        assert.equal(buildYbsDisplayCode(7, "A"), "YBS 7-A");
        assert.equal(buildYbsRouteCode(89, "C"), "YBS-89-C");
        assert.equal(buildYbsDisplayCode(89, "C"), "YBS 89-C");
    });

    it("keeps YBS-7-A and YBS-7-B as distinct route codes", () => {
        const routeA = normalizeYbsRouteDisplayNames({
            route_code: "YBS-7-A",
            route_number: 7,
            route_title_my: "Origin A - Destination A",
            route_title_en: "Origin A - Destination A",
        });
        const routeB = normalizeYbsRouteDisplayNames({
            route_code: "YBS-7-B",
            route_number: 7,
            route_title_my: "Origin B - Destination B",
            route_title_en: "Origin B - Destination B",
        });

        assert.equal(routeA.route_code, "YBS-7-A");
        assert.equal(routeA.display_code, "YBS 7-A");
        assert.equal(routeB.route_code, "YBS-7-B");
        assert.equal(routeB.display_code, "YBS 7-B");
        assert.notEqual(routeA.route_code, routeB.route_code);
    });

    it("keeps YBS-89-A/B/C as three distinct codes", () => {
        const codes = ["A", "B", "C"].map((suffix) =>
            normalizeYbsRouteDisplayNames({
                route_code: `YBS-89-${suffix}`,
                route_number: 89,
                route_title_my: `Stop ${suffix} - End ${suffix}`,
                route_title_en: `Stop ${suffix} - End ${suffix}`,
            }).route_code,
        );

        assert.deepEqual(codes, ["YBS-89-A", "YBS-89-B", "YBS-89-C"]);
    });

    it("validateStoredRouteDisplayNames accepts YBS-7-A", () => {
        const result = validateStoredRouteDisplayNames({
            route_code: "YBS-7-A",
            public_name: "YBS 7-A · Origin ↔ Destination",
            route_names: [
                {
                    language_code: "my",
                    name_type: "primary",
                    is_primary: true,
                    name: "YBS 7-A · Origin ↔ Destination",
                },
                {
                    language_code: "en",
                    name_type: "primary",
                    is_primary: true,
                    name: "YBS 7-A · Origin EN ↔ Destination EN",
                },
                {
                    language_code: "und",
                    name_type: "alias",
                    is_primary: false,
                    name: "YBS-7-A",
                },
            ],
        });

        assert.deepEqual(result.errors, []);
    });

    it("validateStoredRouteDisplayNames accepts TRIAL route codes with Myanmar suffix", () => {
        const result = validateStoredRouteDisplayNames({
            route_code: "TRIAL-SULA-DALA-(ကြိုဆိုပါ၏)",
            public_name:
                "TRIAL-SULA-DALA-(ကြိုဆိုပါ၏) · ဆူးလေမြို့တော်ခန်းမ ↔ ဆာပါချောင် (ကြိုဆိုပါ၏)",
            route_names: [
                {
                    language_code: "my",
                    name_type: "primary",
                    is_primary: true,
                    name: "TRIAL-SULA-DALA-(ကြိုဆိုပါ၏) · ဆူးလေမြို့တော်ခန်းမ ↔ ဆာပါချောင် (ကြိုဆိုပါ၏)",
                },
                {
                    language_code: "en",
                    name_type: "primary",
                    is_primary: true,
                    name: "TRIAL-SULA-DALA-(ကြိုဆိုပါ၏) · Sule City Hall ↔ Sarpachaung (Welcome)",
                },
                {
                    language_code: "und",
                    name_type: "alias",
                    is_primary: false,
                    name: "TRIAL-SULA-DALA-(ကြိုဆိုပါ၏)",
                },
            ],
        });

        assert.deepEqual(result.errors, []);
    });
});

describe("actionBelongsToRoute scoping", () => {
    it("does not match YBS-7-A when scoped to YBS-7", () => {
        const action = makeRouteAction("route:ybs_go:YBS-7-A");
        assert.equal(actionBelongsToRoute(action, "YBS-7"), false);
    });

    it("matches YBS-7-A when scoped to YBS-7-A", () => {
        const action = makeRouteAction("route:ybs_go:YBS-7-A");
        assert.equal(actionBelongsToRoute(action, "YBS-7-A"), true);
    });

    it("builds variant codes with hyphenated route codes", () => {
        assert.equal(buildVariantCode("YBS-7-A", "inbound"), "YBS-7-A-INBOUND");
        assert.equal(buildVariantCode("YBS-7-A", "outbound"), "YBS-7-A-OUTBOUND");
    });
});
