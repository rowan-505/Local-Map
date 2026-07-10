import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    assertNoSummaryFieldOverlap,
    buildRouteMoreMetadataFields,
    ROUTE_SUMMARY_FIELD_KEYS,
} from "./transportRouteMetadataFields.js";
import type { TransportRouteDetail } from "./types.js";

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
        operator: { id: 1, name: "Myanmar Railways" },
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
                trainType: "Express",
                trainModel: "RCF",
                operationDays: ["monday", "friday"],
                sourceStatus: "linked",
                reviewStatus: "needs_review",
                isActive: true,
                confidenceScore: 80,
                generation: "v2",
            },
            names: {
                routeCode: "TRAIN-1",
                nameMy: "ရထား ၁",
                nameEn: "Train One",
                originName: "Yangon",
                destinationName: "Mandalay",
                displayHeadsign: "Mandalay Express",
            },
            counts: { variantCount: 1, stopCount: 10, pathCount: 0, sourceLinksCount: 1 },
            train: {
                trainNumber: "1",
                trainType: "Express",
                trainModel: "RCF",
                operationDays: ["monday", "friday"],
                totalStations: 10,
                estimatedDurationMin: 600,
                displayGroup: "Main line",
                isYangonUrbanService: true,
                isSourceFullLoop: true,
                closingDuplicateStopSkipped: false,
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

describe("buildRouteMoreMetadataFields", () => {
    it("does not repeat route summary field keys", () => {
        const route = makeRoute();
        const { commonFields, modeFields } = buildRouteMoreMetadataFields(route);
        const keys = [...commonFields, ...modeFields].map((field) => field.key);

        for (const key of keys) {
            assert.equal(
                ROUTE_SUMMARY_FIELD_KEYS.has(key),
                false,
                `unexpected summary overlap: ${key}`,
            );
        }

        assert.doesNotThrow(() => assertNoSummaryFieldOverlap([...commonFields, ...modeFields]));
    });

    it("includes only additional common fields for train routes", () => {
        const { commonFields } = buildRouteMoreMetadataFields(makeRoute());
        assert.deepEqual(
            commonFields.map((field) => field.key),
            ["operator", "confidence_score", "generation", "source_links_count"],
        );
    });

    it("includes train-only supplemental fields", () => {
        const { modeFields } = buildRouteMoreMetadataFields(makeRoute());
        assert.deepEqual(modeFields.map((field) => field.key), [
            "train_number",
            "display_group",
            "display_headsign",
            "is_yangon_urban_service",
            "is_source_full_loop",
            "total_source_stations",
            "imported_route_stops",
        ]);
    });

    it("hides empty supplemental fields for bus routes", () => {
        const busRoute = makeRoute({
            mode: "bus",
            route_kind: "local_bus",
            routeMetadata: {
                ...makeRoute().routeMetadata!,
                summary: {
                    ...makeRoute().routeMetadata!.summary,
                    mode: "bus",
                    trainType: null,
                    trainModel: null,
                    operationDays: [],
                },
                train: {
                    trainNumber: null,
                    trainType: null,
                    trainModel: null,
                    operationDays: [],
                    totalStations: null,
                    estimatedDurationMin: null,
                    displayGroup: null,
                    isYangonUrbanService: false,
                    isSourceFullLoop: false,
                    closingDuplicateStopSkipped: false,
                    importedRouteStops: null,
                },
            },
        });

        const { modeFields, modeLabel } = buildRouteMoreMetadataFields(busRoute);
        assert.equal(modeLabel, null);
        assert.equal(modeFields.length, 0);
    });
});
