import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { importReviewEntityNavTabs } from "@/src/lib/dashboardNavigation.js";
import { listImportReviewEntityConfigs, listImportReviewNavEntityConfigs } from "../config/importReviewEntityConfigs.js";
import {
    DEPRECATED_CORE_BUS_API_FAMILIES,
    DEPRECATED_CORE_BUS_PROMOTION_BANNER,
    DEPRECATED_IMPORT_REVIEW_BUS_SLUGS,
    IMPORT_REVIEW_TRANSPORT_MOVED_MESSAGE,
    IMPORT_REVIEW_TRANSPORT_PROMOTION_MOVED_MESSAGE,
    isDeprecatedCoreBusImportReviewFamily,
    isDeprecatedImportReviewBusSlug,
    isImportReviewNavEntitySlug,
} from "./deprecatedCoreBusPromotion.js";

describe("deprecatedCoreBusPromotion dashboard helper", () => {
    it("marks all legacy bus API families as deprecated for promotion", () => {
        assert.deepEqual([...DEPRECATED_CORE_BUS_API_FAMILIES].sort(), [
            "bus_route_stops",
            "bus_route_variants",
            "bus_routes",
            "bus_stops",
        ]);
    });

    it("lists deprecated import-review bus URL slugs", () => {
        assert.deepEqual([...DEPRECATED_IMPORT_REVIEW_BUS_SLUGS].sort(), [
            "bus-route-stops",
            "bus-route-variants",
            "bus-routes",
            "bus-stops",
        ]);
    });

    it("detects deprecated bus families and slugs", () => {
        assert.equal(isDeprecatedCoreBusImportReviewFamily("bus_stops"), true);
        assert.equal(isDeprecatedCoreBusImportReviewFamily("buildings"), false);
        assert.equal(isDeprecatedImportReviewBusSlug("bus-routes"), true);
        assert.equal(isDeprecatedImportReviewBusSlug("buildings"), false);
        assert.equal(isImportReviewNavEntitySlug("roads"), true);
        assert.equal(isImportReviewNavEntitySlug("bus-stops"), false);
    });

    it("excludes bus configs from nav entity list only", () => {
        const all = listImportReviewEntityConfigs();
        const nav = listImportReviewNavEntityConfigs();
        assert.ok(all.length > nav.length);
        assert.ok(nav.every((config) => isImportReviewNavEntitySlug(config.slug)));
        assert.ok(all.some((config) => isDeprecatedImportReviewBusSlug(config.slug)));
    });

    it("excludes legacy bus pages from import-review top nav tabs", () => {
        const navSegments = importReviewEntityNavTabs().map((tab) => tab.segment);
        for (const slug of DEPRECATED_IMPORT_REVIEW_BUS_SLUGS) {
            assert.equal(
                navSegments.includes(slug),
                false,
                `import-review nav must not include deprecated slug ${slug}`
            );
        }
    });

    it("uses Import Transport promotion message for legacy publish batches", () => {
        assert.equal(
            IMPORT_REVIEW_TRANSPORT_PROMOTION_MOVED_MESSAGE,
            "Transport promotion moved to Import Transport."
        );
        assert.equal(DEPRECATED_CORE_BUS_PROMOTION_BANNER, IMPORT_REVIEW_TRANSPORT_PROMOTION_MOVED_MESSAGE);
        assert.match(IMPORT_REVIEW_TRANSPORT_MOVED_MESSAGE, /import-transport/);
    });
});
