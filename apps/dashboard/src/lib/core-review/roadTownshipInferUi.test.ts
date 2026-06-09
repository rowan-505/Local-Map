import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    formatCommonParentContextLine,
    formatIntersectingTownshipLine,
    formatNearestFallbackLine,
    roadTownshipInferBannerLabel,
    shouldShowIntersectingTownshipList,
    shouldShowRoadRecommendedTownship,
} from "./roadTownshipInferUi.js";

describe("roadTownshipInferBannerLabel", () => {
    it("returns green valid copy for valid_existing", () => {
        assert.equal(
            roadTownshipInferBannerLabel({
                status: "valid_existing",
                currentAdminArea: {
                    id: "42",
                    name: "Kyauktan",
                    level_code: "township",
                    is_active: true,
                },
            }),
            "Current township assignment is valid",
        );
    });

    it("returns multi-overlap headline", () => {
        assert.equal(
            roadTownshipInferBannerLabel({
                status: "recommendation_found",
                currentAdminArea: { id: null, name: null, level_code: null, is_active: null },
                recommendationMode: "multi_overlap",
            }),
            "Road intersects multiple townships — recommended best overlap",
        );
    });

    it("returns debug-specific no_match copy", () => {
        assert.match(
            roadTownshipInferBannerLabel({
                status: "no_match",
                currentAdminArea: { id: null, name: null, level_code: null, is_active: null },
                debugReason: "outside_all_townships",
            }) ?? "",
            /outside_all_townships/,
        );
    });

    it("warns when stored township differs from geometry recommendation", () => {
        assert.equal(
            roadTownshipInferBannerLabel({
                status: "recommendation_found",
                currentAdminArea: {
                    id: "42",
                    name: "Stored Township",
                    level_code: "township",
                    is_active: true,
                },
            }),
            "Stored township does not match geometry — recommended township found",
        );
    });

    it("warns when current assignment is ward/region/country-level", () => {
        assert.equal(
            roadTownshipInferBannerLabel({
                status: "recommendation_found",
                currentAdminArea: {
                    id: "3",
                    name: "Yangon Region",
                    level_code: "region",
                    is_active: true,
                },
            }),
            "Current assignment is region-level, not township — recommended township found",
        );
    });
});

describe("shouldShowRoadRecommendedTownship", () => {
    it("hides recommendation when current township is valid", () => {
        assert.equal(
            shouldShowRoadRecommendedTownship("valid_existing", {
                id: "99",
                canonical_name: "Other",
                name_mm: null,
                name_en: null,
            }),
            false,
        );
    });
});

describe("shouldShowIntersectingTownshipList", () => {
    it("shows list only for multi-intersection recommendations", () => {
        const matches = [
            {
                id: "1",
                canonical_name: "A",
                name_mm: null,
                name_en: null,
                admin_level_code: "township",
                overlap_m: 100,
                overlap_pct: 0.6,
            },
            {
                id: "2",
                canonical_name: "B",
                name_mm: null,
                name_en: null,
                admin_level_code: "township",
                overlap_m: 40,
                overlap_pct: 0.24,
            },
        ];
        assert.equal(shouldShowIntersectingTownshipList("recommendation_found", matches), true);
        assert.equal(shouldShowIntersectingTownshipList("valid_existing", matches), false);
    });
});

describe("formatIntersectingTownshipLine", () => {
    it("includes overlap meters and percent", () => {
        const line = formatIntersectingTownshipLine({
            id: "1",
            canonical_name: "Kyauktan",
            name_mm: null,
            name_en: null,
            admin_level_code: "township",
            overlap_m: 1234.6,
            overlap_pct: 0.678,
        });
        assert.match(line, /Kyauktan/);
        assert.match(line, /1235m overlap/);
        assert.match(line, /67\.8% of road/);
    });
});

describe("formatCommonParentContextLine", () => {
    it("marks broader parent as context only", () => {
        const line = formatCommonParentContextLine({
            id: "9",
            canonical_name: "Yangon District",
            admin_level_code: "district",
            name_mm: null,
            name_en: null,
        });
        assert.match(line ?? "", /context only, not saved/);
    });
});

describe("formatNearestFallbackLine", () => {
    it("formats sub-km distances in meters", () => {
        assert.equal(formatNearestFallbackLine(850), "Nearest township fallback · 850m from road");
    });
});
