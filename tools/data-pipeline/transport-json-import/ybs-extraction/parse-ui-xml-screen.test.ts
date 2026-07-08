import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { detectYbsScreen, isRouteDetailScreen, isStopDetailScreen, parseXmlTextNodes } from "./parse-ui-xml.js";

const SCROLLED_ROUTE_DETAIL_FIXTURE_MY = path.resolve(
    "tmp/transport-imports/ybs-all/my/page-sources/YBS-2/outbound/001.xml",
);
const SCROLLED_ROUTE_DETAIL_FIXTURE_EN = path.resolve(
    "tmp/transport-imports/ybs-all/en/page-sources/YBS-2/outbound/001.xml.pre-swipe-live.xml",
);

describe("parse-ui-xml screen detection", () => {
    for (const [label, fixturePath] of [
        ["Myanmar", SCROLLED_ROUTE_DETAIL_FIXTURE_MY],
        ["English", SCROLLED_ROUTE_DETAIL_FIXTURE_EN],
    ] as const) {
        it(`treats scrolled ${label} route detail stop list as route_detail, not stop_detail`, () => {
            if (!fs.existsSync(fixturePath)) {
                return;
            }

            const xml = fs.readFileSync(fixturePath, "utf8");
            const nodes = parseXmlTextNodes(xml);

            assert.equal(isRouteDetailScreen(nodes), true);
            assert.equal(isStopDetailScreen(nodes, 2340), false);
            assert.equal(detectYbsScreen(xml, 2340), "route_detail");
        });
    }
});
