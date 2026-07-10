import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    TRANSPORT_TIME_EMPTY_DISPLAY,
    addSecondsToCanonicalTime,
    formatCanonicalTimeForDisplay,
    parseSourceTimeToCanonical,
    resolveVariantDepartureAnchor,
} from "./transport-time.js";
import {
    calculateVariantTimetableSchedule,
    supportsVariantTimetable,
} from "./timetable.js";

describe("12-hour source parsing", () => {
    const cases: ReadonlyArray<{ readonly source: string; readonly canonical: string }> = [
        { source: "12:00 AM", canonical: "00:00" },
        { source: "12:30 AM", canonical: "00:30" },
        { source: "12:00 PM", canonical: "12:00" },
        { source: "12:30 PM", canonical: "12:30" },
        { source: "04:45 PM", canonical: "16:45" },
        { source: "05:00 AM", canonical: "05:00" },
    ];

    for (const { source, canonical } of cases) {
        it(`parses ${source} => ${canonical}`, () => {
            assert.equal(parseSourceTimeToCanonical(source), canonical);
        });
    }
});

describe("invalid 12-hour source parsing", () => {
    const invalid = ["13:00 PM", "00:30 AM", "5 PM", ""];

    for (const source of invalid) {
        it(`rejects ${source === "" ? "empty string" : JSON.stringify(source)}`, () => {
            assert.equal(parseSourceTimeToCanonical(source), null);
        });
    }
});

describe("midnight crossing", () => {
    it("23:50 + 20 min => 00:10 next day", () => {
        assert.deepEqual(addSecondsToCanonicalTime("23:50", 20 * 60), {
            displayTime: "12:10 AM",
            dayOffset: 1,
            canonical: "00:10",
        });
    });

    it("23:55 + 70 min => 01:05 next day", () => {
        assert.deepEqual(addSecondsToCanonicalTime("23:55", 70 * 60), {
            displayTime: "01:05 AM",
            dayOffset: 1,
            canonical: "01:05",
        });
    });

    it("applies midnight crossing through variant timetable schedule", () => {
        const twentyMinutesPastMidnight = calculateVariantTimetableSchedule({
            departureTimeText: "23:50",
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: 20 * 60, waiting_time_seconds: null },
            ],
        });
        assert.equal(twentyMinutesPastMidnight[1]?.calculatedArrivalTime, "12:10 AM");
        assert.equal(twentyMinutesPastMidnight[1]?.arrivalDayOffset, 1);

        const seventyMinutesPastAnchor = calculateVariantTimetableSchedule({
            departureTimeText: "23:55",
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: 70 * 60, waiting_time_seconds: null },
            ],
        });
        assert.equal(seventyMinutesPastAnchor[1]?.calculatedArrivalTime, "01:05 AM");
        assert.equal(seventyMinutesPastAnchor[1]?.arrivalDayOffset, 1);
    });
});

describe("null departure anchor", () => {
    it("yields no calculated clock times in the schedule", () => {
        const schedule = calculateVariantTimetableSchedule({
            departureTimeText: null,
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: 600, waiting_time_seconds: 120 },
            ],
        });

        for (const row of schedule) {
            assert.equal(row.calculatedArrivalTime, null);
            assert.equal(row.calculatedDepartureTime, null);
            assert.equal(row.primaryClockTime, null);
            assert.equal(row.hasPrimaryClockData, false);
        }
    });

    it("displays — and never 00:00 or midnight placeholders", () => {
        assert.equal(formatCanonicalTimeForDisplay(null), TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.equal(resolveVariantDepartureAnchor(null), null);

        const schedule = calculateVariantTimetableSchedule({
            departureTimeText: null,
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            ],
        });

        const first = schedule[0]!;
        assert.equal(first.calculatedDepartureTime, null);
        assert.notEqual(formatCanonicalTimeForDisplay(first.calculatedDepartureTime), "00:00");
        assert.notEqual(formatCanonicalTimeForDisplay(first.calculatedDepartureTime), "12:00 AM");
        assert.equal(
            formatCanonicalTimeForDisplay(first.calculatedDepartureTime),
            TRANSPORT_TIME_EMPTY_DISPLAY,
        );
    });

    it("still calculates offsets without an anchor", () => {
        const schedule = calculateVariantTimetableSchedule({
            departureTimeText: null,
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: 300, waiting_time_seconds: 60 },
                { travel_time_from_previous_seconds: 600, waiting_time_seconds: null },
            ],
        });

        assert.equal(schedule[1]?.arrivalOffsetSeconds, 300);
        assert.equal(schedule[1]?.departureOffsetSeconds, 360);
        assert.equal(schedule[2]?.arrivalOffsetSeconds, 960);
        assert.equal(schedule[2]?.calculatedArrivalTime, null);
    });
});

describe("bus with no timing", () => {
    it("supports timetable mode but shows no operational clocks", () => {
        assert.equal(supportsVariantTimetable("bus"), true);

        const schedule = calculateVariantTimetableSchedule({
            departureTimeText: null,
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            ],
        });

        assert.equal(schedule.length, 3);
        for (const row of schedule) {
            assert.equal(row.primaryClockTime, null);
            assert.equal(row.calculatedArrivalTime, null);
            assert.equal(row.calculatedDepartureTime, null);
            assert.equal(row.hasPrimaryClockData, false);
        }

        assert.equal(formatCanonicalTimeForDisplay(null), TRANSPORT_TIME_EMPTY_DISPLAY);
    });
});

describe("train with complete timing", () => {
    it("calculates full departure-through-arrival clocks from canonical anchor", () => {
        const schedule = calculateVariantTimetableSchedule({
            departureTimeText: "16:45",
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: 26 * 60, waiting_time_seconds: 5 * 60 },
                { travel_time_from_previous_seconds: 15 * 60, waiting_time_seconds: 3 * 60 },
                { travel_time_from_previous_seconds: 45 * 60, waiting_time_seconds: null },
            ],
        });

        assert.equal(schedule[0]?.isFirst, true);
        assert.equal(schedule[0]?.calculatedDepartureTime, "04:45 PM");
        assert.equal(schedule[0]?.calculatedArrivalTime, null);

        assert.equal(schedule[1]?.calculatedArrivalTime, "05:11 PM");
        assert.equal(schedule[1]?.calculatedDepartureTime, "05:16 PM");

        assert.equal(schedule[2]?.calculatedArrivalTime, "05:31 PM");
        assert.equal(schedule[2]?.calculatedDepartureTime, "05:34 PM");

        assert.equal(schedule[3]?.isLast, true);
        assert.equal(schedule[3]?.calculatedArrivalTime, "06:19 PM");
        assert.equal(schedule[3]?.calculatedDepartureTime, null);
        assert.equal(schedule[3]?.primaryClockTime, "06:19 PM");
    });

    it("migrates imported 04:45 PM source to canonical anchor for calculation", () => {
        assert.equal(parseSourceTimeToCanonical("04:45 PM"), "16:45");
        const schedule = calculateVariantTimetableSchedule({
            departureTimeText: "16:45",
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            ],
        });
        assert.equal(schedule[0]?.calculatedDepartureTime, "04:45 PM");
    });
});

describe("circular train closing occurrence", () => {
    it("treats opening departure and closing arrival as separate timetable rows", () => {
        const schedule = calculateVariantTimetableSchedule({
            departureTimeText: "05:00",
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: 30 * 60, waiting_time_seconds: 5 * 60 },
                { travel_time_from_previous_seconds: 25 * 60, waiting_time_seconds: null },
            ],
        });

        assert.equal(schedule[0]?.isFirst, true);
        assert.equal(schedule[0]?.isLast, false);
        assert.equal(schedule[0]?.calculatedDepartureTime, "05:00 AM");
        assert.equal(schedule[0]?.calculatedArrivalTime, null);
        assert.equal(schedule[0]?.primaryClockTime, "05:00 AM");

        assert.equal(schedule[1]?.isFirst, false);
        assert.equal(schedule[1]?.isLast, false);
        assert.equal(schedule[1]?.calculatedArrivalTime, "05:30 AM");
        assert.equal(schedule[1]?.calculatedDepartureTime, "05:35 AM");

        assert.equal(schedule[2]?.isFirst, false);
        assert.equal(schedule[2]?.isLast, true);
        assert.equal(schedule[2]?.calculatedArrivalTime, "06:00 AM");
        assert.equal(schedule[2]?.calculatedDepartureTime, null);
        assert.equal(schedule[2]?.primaryClockTime, "06:00 AM");
    });

    it("does not use per-stop source_time_text for closing row clocks", () => {
        const schedule = calculateVariantTimetableSchedule({
            departureTimeText: "05:00",
            stops: [
                { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
                { travel_time_from_previous_seconds: 3600, waiting_time_seconds: null },
            ],
        });

        const closing = schedule[1]!;
        assert.equal(closing.calculatedArrivalTime, "06:00 AM");
        assert.notEqual(closing.calculatedArrivalTime, "07:00 AM");
    });
});
