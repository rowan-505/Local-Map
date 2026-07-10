import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildTransportRouteMetadata,
    readOperationDays,
    readRouteType,
    readTrainNumber,
} from "./transport-route-metadata.js";

const baseInput = {
    route_code: "TRAIN-11",
    mode: "train",
    route_kind: "intercity",
    origin_name: "Yangon",
    destination_name: "Mandalay",
    review_status: "needs_review",
    is_active: false,
    confidence_score: 72,
    normalized_data: {
        train_number: "11",
        train_type: "express",
        train_model: "AAR",
        operation_days: ["daily"],
        generation: "simple_train_system_v1",
    },
    name_mm: "၁၁",
    name_en: "Train 11",
    variant_count: 1,
    stop_count: 21,
    path_count: 1,
    source_links_count: 1,
    variants: [
        {
            headsign: "Mandalay",
            destination_name: "Mandalay Railway Station",
            estimated_duration_min: 870,
            stop_count: 21,
            normalized_data: {
                train_number: "11",
                total_stations: 21,
                travel_duration_seconds: 52200,
                is_circular_route: false,
                imported_route_stops: 21,
            },
        },
    ],
    diagnostics: {
        stops_missing_geom: false,
        has_placeholder_stop_name: false,
        has_stop_geometry_review_flag: false,
        sequence_incomplete: false,
    },
} as const;

describe("buildTransportRouteMetadata", () => {
    it("builds typed train metadata without exposing raw normalized_data", () => {
        const metadata = buildTransportRouteMetadata(baseInput);

        assert.equal(metadata.summary.mode, "train");
        assert.equal(metadata.summary.routeType, "express");
        assert.equal(metadata.summary.trainType, "express");
        assert.equal(metadata.summary.trainModel, "AAR");
        assert.deepEqual(metadata.summary.operationDays, ["daily"]);
        assert.equal(metadata.summary.sourceStatus, "linked");
        assert.equal(metadata.names.displayHeadsign, "Mandalay");
        assert.equal(metadata.counts.sourceLinksCount, 1);
        assert.equal(metadata.train.trainNumber, "11");
        assert.equal(metadata.train.totalStations, 21);
        assert.equal(metadata.train.estimatedDurationMin, 870);
        assert.equal(metadata.train.displayGroup, "11");
        assert.equal(metadata.summary.generation, "simple_train_system_v1");
        assert.equal(metadata.train.importedRouteStops, 21);
        assert.equal(metadata.train.isSourceFullLoop, false);
        assert.equal(metadata.diagnostics.hasPath, true);
        assert.equal(metadata.diagnostics.hasCompleteStopSequence, true);
        assert.equal("normalized_data" in metadata, false);
    });

    it("derives sourceStatus=imported when review_status is imported_unreviewed", () => {
        const metadata = buildTransportRouteMetadata({
            ...baseInput,
            review_status: "imported_unreviewed",
        });
        assert.equal(metadata.summary.sourceStatus, "imported");
    });

    it("derives sourceStatus=none when there are no source links", () => {
        const metadata = buildTransportRouteMetadata({
            ...baseInput,
            source_links_count: 0,
        });
        assert.equal(metadata.summary.sourceStatus, "none");
        assert.equal(metadata.diagnostics.hasSourceLinks, false);
    });

    it("marks Yangon circular train service from variant normalized_data", () => {
        const metadata = buildTransportRouteMetadata({
            ...baseInput,
            route_code: "TRAIN-GA-3",
            origin_name: "Yangon Central Railway Station",
            destination_name: "Yangon Central Railway Station",
            normalized_data: {
                train_number: "ga-3",
                train_type: "suburban",
            },
            variants: [
                {
                    headsign: null,
                    destination_name: "Yangon Central Railway Station",
                    estimated_duration_min: 60,
                    stop_count: 12,
                    normalized_data: {
                        is_circular_route: true,
                        total_stations: 12,
                    },
                },
            ],
        });

        assert.equal(metadata.train.isYangonUrbanService, true);
        assert.equal(metadata.train.isSourceFullLoop, true);
    });

    it("uses bus route_kind when route_type is absent", () => {
        const metadata = buildTransportRouteMetadata({
            ...baseInput,
            route_code: "YBS-36",
            mode: "bus",
            route_kind: "local_bus",
            normalized_data: {
                ybs_go: {
                    route_number: "36",
                },
            },
            variants: [
                {
                    headsign: "Downtown",
                    destination_name: "Terminal",
                    estimated_duration_min: null,
                    stop_count: 18,
                    normalized_data: null,
                },
            ],
        });

        assert.equal(metadata.summary.routeType, "local_bus");
        assert.equal(metadata.summary.trainType, null);
        assert.equal(metadata.train.trainNumber, null);
        assert.equal(metadata.train.displayGroup, null);
        assert.equal(metadata.names.displayHeadsign, "Downtown");
    });
});

describe("readOperationDays", () => {
    it("falls back to operation_day when operation_days is absent", () => {
        assert.deepEqual(readOperationDays({ operation_day: "Daily" }), ["Daily"]);
    });
});

describe("readTrainNumber", () => {
    it("falls back to route_code suffix", () => {
        assert.equal(readTrainNumber("TRAIN-141", null), "141");
    });
});

describe("readRouteType", () => {
    it("prefers train_type for train routes", () => {
        assert.equal(readRouteType("train", "intercity", { train_type: "express" }), "express");
    });
});
