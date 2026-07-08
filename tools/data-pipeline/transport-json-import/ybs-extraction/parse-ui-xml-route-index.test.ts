import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { assignRouteIdentities } from "./route-identity.js";
import { mergeRouteIndexRows, parseRouteIndexRows } from "./parse-ui-xml.js";

const TRIAL_ROUTE_INDEX_FIXTURE = path.resolve(
    "tmp/transport-imports/ybs-all/route-index/page-sources/042.xml",
);

describe("parseRouteIndexRows trial routes", () => {
    it("parses (စမ်းသပ်) titles and descriptive badges from a real route list dump", () => {
        if (!fs.existsSync(TRIAL_ROUTE_INDEX_FIXTURE)) {
            return;
        }

        const xml = fs.readFileSync(TRIAL_ROUTE_INDEX_FIXTURE, "utf8");
        const rows = parseRouteIndexRows(xml);

        assert.ok(rows.length >= 8, `expected at least 8 rows, got ${rows.length}`);

        const trialTitles = rows
            .map((row) => row.route_title_my)
            .filter((title): title is string => Boolean(title?.includes("စမ်းသပ်")));

        assert.equal(trialTitles.length, 5);

        const sulaDala = rows.find((row) => row.route_display_code === "Sula - Dala");
        assert.ok(sulaDala);
        assert.equal(sulaDala.route_title_my, "(စမ်းသပ်) ဆူးလေ - ဒလ");
        assert.equal(sulaDala.operator_name, "YBPC");

        const identities = assignRouteIdentities(
            rows.map((row, index) => ({
                list_order: index + 1,
                route_display_code: row.route_display_code,
                route_number: row.route_number,
                route_title_my: row.route_title_my,
                route_title_en: row.route_title_en,
                operator_name: row.operator_name,
                badge_is_truncated: row.badge_is_truncated,
                raw_card_text: row.raw_card_text,
                card_bounds: row.card_bounds,
            })),
        );

        const trialCodes = identities
            .filter((route) => route.identity_status === "trial_route_candidate")
            .map((route) => route.route_code_candidate);

        assert.equal(trialCodes.length, 5);
        assert.ok(trialCodes.every((code) => code?.startsWith("TRIAL-")));
        assert.ok(new Set(trialCodes).size === trialCodes.length);
    });

    it("merges trial routes across overlapping scroll dumps", () => {
        if (!fs.existsSync(TRIAL_ROUTE_INDEX_FIXTURE)) {
            return;
        }

        const xml = fs.readFileSync(TRIAL_ROUTE_INDEX_FIXTURE, "utf8");
        const rows = parseRouteIndexRows(xml);
        const merged = mergeRouteIndexRows([rows.slice(0, 3), rows]);

        assert.equal(merged.length, rows.length);
    });
});
