import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildRouteReviewChecklist,
    transportVariantFirstStopLabel,
} from "./TransportRouteDetailCards.js";
import type { TransportRouteDetail, TransportVariantSummary } from "./types.js";

function makeRoute(overrides: Partial<TransportRouteDetail> = {}): TransportRouteDetail {
    return {
        public_id: "00000000-0000-4000-8000-000000000001",
        route_code: "TRAIN-1",
        public_name: "Train One",
        name_mm: "ရထား ၁",
        name_en: "Train One",
        display_name: "ရထား ၁",
        mode: "train",
        route_kind: "intercity",
        origin_name: "Yangon",
        destination_name: "Mandalay",
        origin_admin_area_id: null,
        destination_admin_area_id: null,
        description: null,
        operator: null,
        confidence_score: 80,
        review_status: "needs_review",
        is_active: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        deleted_at: null,
        counts: { variants: 1, stops: 10, paths: 0 },
        names: [],
        sources: [{ source_name: "import", source_kind: "train_app", external_id: "1", source_url: null, is_primary: true }],
        routeMetadata: {
            summary: {
                mode: "train",
                routeKind: "intercity",
                routeType: "express",
                trainType: null,
                trainModel: null,
                operationDays: [],
                sourceStatus: "linked",
                reviewStatus: "needs_review",
                isActive: true,
                confidenceScore: 80,
                generation: null,
            },
            names: {
                routeCode: "TRAIN-1",
                nameMy: "ရထား ၁",
                nameEn: "Train One",
                originName: "Yangon",
                destinationName: "Mandalay",
                displayHeadsign: null,
            },
            counts: { variantCount: 1, stopCount: 10, pathCount: 0, sourceLinksCount: 1 },
            train: {
                trainNumber: "1",
                trainType: null,
                trainModel: null,
                operationDays: [],
                totalStations: 10,
                estimatedDurationMin: 600,
                displayGroup: null,
                isYangonUrbanService: false,
                isSourceFullLoop: true,
                closingDuplicateStopSkipped: true,
                importedRouteStops: 38,
            },
            diagnostics: {
                hasSourceLinks: true,
                hasPath: false,
                hasCompleteStopSequence: true,
                hasStopLocationWarnings: false,
            },
        },
        ...overrides,
    };
}

const variant: TransportVariantSummary = {
    public_id: "00000000-0000-4000-8000-000000000002",
    variant_code: "TRAIN-1-UP",
    direction_name: "up",
    direction_id: 0,
    headsign: "Mandalay",
    origin_name: "Yangon",
    destination_name: "Mandalay",
    first_stop_name: "Yangon Central",
    stop_count: 38,
    path_count: 0,
    path_status: "none",
    distance_m: null,
    estimated_duration_min: 600,
    review_status: "needs_review",
    confidence_score: 80,
    is_active: true,
};

describe("transportVariantFirstStopLabel", () => {
    it("shows the physical variant's first ordered stop instead of stale endpoint metadata", () => {
        assert.equal(
            transportVariantFirstStopLabel({
                ...variant,
                headsign: "Old headsign",
                destination_name: "Old destination",
                first_stop_name: "Actual first stop",
            }),
            "Actual first stop",
        );
    });
});

describe("buildRouteReviewChecklist", () => {
    it("returns six compact checklist items in the requested order", () => {
        const items = buildRouteReviewChecklist({
            route: makeRoute(),
            variants: [variant],
            stopsWithoutLocation: 0,
            stopsNeedingReview: 0,
            usesPlaceholderReviewPoints: false,
        });

        assert.deepEqual(
            items.map((item) => item.key),
            ["names", "sources", "sequence", "locations", "path", "public"],
        );
        assert.equal(items.length, 6);
    });

    it("shows train sequence guide and treats missing path as a soft warning", () => {
        const items = buildRouteReviewChecklist({
            route: makeRoute(),
            variants: [variant],
            stopsWithoutLocation: 0,
            stopsNeedingReview: 0,
            usesPlaceholderReviewPoints: false,
        });

        const sequence = items.find((item) => item.key === "sequence");
        const path = items.find((item) => item.key === "path");

        assert.equal(sequence?.status, "ok");
        assert.equal(sequence?.hint, "Stop sequence guide available.");
        assert.equal(path?.status, "attention");
        assert.match(path?.hint ?? "", /optional for train/i);
    });

    it("flags stop locations when any stop is needs_review", () => {
        const items = buildRouteReviewChecklist({
            route: makeRoute(),
            variants: [variant],
            stopsWithoutLocation: 0,
            stopsNeedingReview: 2,
            usesPlaceholderReviewPoints: false,
        });

        const locations = items.find((item) => item.key === "locations");
        assert.equal(locations?.status, "attention");
        assert.match(locations?.hint ?? "", /2 stops still need_review/i);
    });
});
