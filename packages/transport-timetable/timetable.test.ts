import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    calculateVariantTimetableOffsets,
    calculateVariantTimetableSchedule,
    offsetSecondsToClockTime,
    resolveRouteStopClockTimes,
    resolveVariantDepartureAnchor,
    supportsVariantTimetable,
    variantTimetableScheduleToOffsets,
} from "./timetable.js";

describe("calculateVariantTimetableOffsets", () => {
    it("handles first, middle, and final stops", () => {
        const calculated = calculateVariantTimetableOffsets([
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 1560, waiting_time_seconds: 300 },
            { travel_time_from_previous_seconds: 900, waiting_time_seconds: null },
        ]);

        assert.deepEqual(calculated, [
            { arrival_offset_seconds: null, departure_offset_seconds: 0 },
            { arrival_offset_seconds: 1560, departure_offset_seconds: 1860 },
            { arrival_offset_seconds: 2760, departure_offset_seconds: null },
        ]);
    });

    it("uses zero when waiting is null on middle stops without writing waiting to DB", () => {
        const calculated = calculateVariantTimetableOffsets([
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 600, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 300, waiting_time_seconds: 0 },
        ]);

        assert.deepEqual(calculated[1], {
            arrival_offset_seconds: 600,
            departure_offset_seconds: 600,
        });
    });

    it("keeps arrival and departure null when travel is missing", () => {
        const calculated = calculateVariantTimetableOffsets([
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: null, waiting_time_seconds: 120 },
            { travel_time_from_previous_seconds: 600, waiting_time_seconds: null },
        ]);

        assert.deepEqual(calculated[1], {
            arrival_offset_seconds: null,
            departure_offset_seconds: null,
        });
        assert.deepEqual(calculated[2], {
            arrival_offset_seconds: null,
            departure_offset_seconds: null,
        });
    });

    it("applies first-stop rules for a single stop", () => {
        assert.deepEqual(
            calculateVariantTimetableOffsets([
                { travel_time_from_previous_seconds: 999, waiting_time_seconds: 999 },
            ]),
            [{ arrival_offset_seconds: null, departure_offset_seconds: 0 }],
        );
    });
});

describe("calculateVariantTimetableSchedule", () => {
    it("calculates offsets and display clocks for all stops", () => {
        const schedule = calculateVariantTimetableSchedule({
            departureTimeText: "05:00",
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: 1560, waiting_time_seconds: 300 },
                { travel_time_from_previous_seconds: 900, waiting_time_seconds: null },
            ],
        });

        assert.equal(schedule.length, 3);
        assert.equal(schedule[0]?.calculatedDepartureTime, "05:00 AM");
        assert.equal(schedule[0]?.departureOffsetSeconds, 0);
        assert.equal(schedule[1]?.calculatedArrivalTime, "05:26 AM");
        assert.equal(schedule[1]?.calculatedDepartureTime, "05:31 AM");
        assert.equal(schedule[2]?.calculatedArrivalTime, "05:46 AM");
        assert.equal(schedule[2]?.calculatedDepartureTime, null);
    });

    it("returns null clocks when departure anchor is missing", () => {
        const schedule = calculateVariantTimetableSchedule({
            departureTimeText: null,
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: 600, waiting_time_seconds: 0 },
            ],
        });

        assert.equal(schedule[0]?.calculatedDepartureTime, null);
        assert.equal(schedule[1]?.calculatedArrivalTime, null);
        assert.equal(schedule[1]?.arrivalOffsetSeconds, 600);
    });

    it("handles midnight crossing with day offsets", () => {
        const schedule = calculateVariantTimetableSchedule({
            departureTimeText: "23:50",
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: 1200, waiting_time_seconds: 0 },
            ],
        });

        assert.equal(schedule[1]?.calculatedArrivalTime, "12:10 AM");
        assert.equal(schedule[1]?.arrivalDayOffset, 1);
        assert.equal(schedule[1]?.arrivalOffsetSeconds, 1200);
    });

    it("extracts offset rows for routing preparation", () => {
        const schedule = calculateVariantTimetableSchedule({
            departureTimeText: "16:45",
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: 180, waiting_time_seconds: 0 },
                { travel_time_from_previous_seconds: 300, waiting_time_seconds: null },
            ],
        });

        assert.deepEqual(variantTimetableScheduleToOffsets(schedule), [
            { arrival_offset_seconds: null, departure_offset_seconds: 0 },
            { arrival_offset_seconds: 180, departure_offset_seconds: 180 },
            { arrival_offset_seconds: 480, departure_offset_seconds: null },
        ]);
    });
});

describe("resolveVariantDepartureAnchor", () => {
    it("returns canonical departure_time_text only", () => {
        assert.equal(resolveVariantDepartureAnchor("05:00"), "05:00");
        assert.equal(resolveVariantDepartureAnchor("16:45"), "16:45");
    });

    it("ignores non-canonical and missing values", () => {
        assert.equal(resolveVariantDepartureAnchor(null), null);
        assert.equal(resolveVariantDepartureAnchor("04:45 PM"), null);
        assert.equal(resolveVariantDepartureAnchor(""), null);
        assert.equal(resolveVariantDepartureAnchor("  "), null);
    });
});

describe("resolveRouteStopClockTimes", () => {
    it("uses variant departure anchor for the first stop", () => {
        const clocks = resolveRouteStopClockTimes(
            { departure_offset_seconds: 0, travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { departureTimeText: "05:00", isFirst: true, isLast: false },
        );

        assert.equal(clocks.primaryClockTime, "05:00 AM");
        assert.equal(clocks.departureClockTime, "05:00 AM");
        assert.equal(clocks.hasPrimaryClockData, true);
    });

    it("calculates middle-stop arrival and departure clocks", () => {
        const clocks = resolveRouteStopClockTimes(
            {
                arrival_offset_seconds: 1560,
                departure_offset_seconds: 1860,
                travel_time_from_previous_seconds: 1560,
                waiting_time_seconds: 300,
            },
            { departureTimeText: "05:00", isFirst: false, isLast: false },
        );

        assert.equal(clocks.arrivalClockTime, "05:26 AM");
        assert.equal(clocks.departureClockTime, "05:31 AM");
        assert.equal(clocks.primaryClockTime, "05:26 AM");
    });

    it("returns null primary clock when departure anchor is missing", () => {
        const clocks = resolveRouteStopClockTimes(
            { departure_offset_seconds: 0, travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { departureTimeText: null, isFirst: true, isLast: false },
        );

        assert.equal(clocks.primaryClockTime, null);
        assert.equal(clocks.hasPrimaryClockData, false);
    });

    it("does not calculate clocks from non-canonical anchor text", () => {
        const clocks = resolveRouteStopClockTimes(
            { departure_offset_seconds: 0, travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { departureTimeText: "05:00 AM", isFirst: true, isLast: false },
        );

        assert.equal(clocks.primaryClockTime, null);
        assert.equal(clocks.hasPrimaryClockData, false);
    });
});

describe("supportsVariantTimetable", () => {
    it("returns true for scheduled transport modes", () => {
        assert.equal(supportsVariantTimetable("bus"), true);
        assert.equal(supportsVariantTimetable("train"), true);
        assert.equal(supportsVariantTimetable("ferry"), true);
        assert.equal(supportsVariantTimetable("express_bus"), true);
    });

    it("returns false for unknown modes", () => {
        assert.equal(supportsVariantTimetable("walking"), false);
        assert.equal(supportsVariantTimetable(null), false);
    });
});

describe("transport time integration", () => {
    it("calculates stop clocks from canonical anchors only", () => {
        assert.equal(offsetSecondsToClockTime("05:00", 1560), "05:26 AM");
        assert.equal(offsetSecondsToClockTime("16:45", 180), "04:48 PM");
        assert.equal(offsetSecondsToClockTime("05:00 AM", 1560), null);
    });
});
