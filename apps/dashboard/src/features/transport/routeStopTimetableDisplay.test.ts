import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ROUTE_STOP_TRAVEL_PLACEHOLDER } from "./routeStopTimingDisplay.js";
import {
    TRANSPORT_TIME_EMPTY_DISPLAY,
    addSecondsToCanonicalTime,
    buildVariantTimetableSchedule,
    formatCanonicalTimeForDisplay,
    formatVariantDepartureTimeDisplay,
    formatVariantDepartureTimeForInput,
    getCalculatedTimetableRowSegments,
    getRouteStopRowTimingDisplayFromSchedule,
    hasExplicitVariantDepartureTime,
    isValidTransportTimeInput,
    parseSourceTimeToCanonical,
    parseTimeInputToCanonical,
    resolveVariantDepartureAnchor,
    validateCanonicalTime,
} from "./routeStopTimetableDisplay.js";

describe("parseSourceTimeToCanonical", () => {
    it("parses valid 12-hour source values", () => {
        assert.equal(parseSourceTimeToCanonical("04:45 PM"), "16:45");
        assert.equal(parseSourceTimeToCanonical("05:00 AM"), "05:00");
        assert.equal(parseSourceTimeToCanonical("12:30 PM"), "12:30");
        assert.equal(parseSourceTimeToCanonical("12:30 AM"), "00:30");
    });

    it("rejects canonical and malformed values", () => {
        assert.equal(parseSourceTimeToCanonical("16:45"), null);
        assert.equal(parseSourceTimeToCanonical("bad"), null);
    });
});

describe("parseTimeInputToCanonical", () => {
    it("accepts canonical or source input", () => {
        assert.equal(parseTimeInputToCanonical("05:00 AM"), "05:00");
        assert.equal(parseTimeInputToCanonical("17:30"), "17:30");
        assert.equal(isValidTransportTimeInput("05:00 AM"), true);
        assert.equal(isValidTransportTimeInput("bad"), false);
    });
});

describe("formatCanonicalTimeForDisplay", () => {
    it("formats canonical values and uses — for missing", () => {
        assert.equal(formatCanonicalTimeForDisplay(null), TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.equal(formatCanonicalTimeForDisplay("16:45"), "04:45 PM");
        assert.equal(formatCanonicalTimeForDisplay("05:00"), "05:00 AM");
    });
});

describe("addSecondsToCanonicalTime", () => {
    it("adds offsets and supports midnight crossing", () => {
        assert.deepEqual(addSecondsToCanonicalTime("16:45", 180), {
            displayTime: "04:48 PM",
            dayOffset: 0,
            canonical: "16:48",
        });
        assert.deepEqual(addSecondsToCanonicalTime("23:30", 3600), {
            displayTime: "12:30 AM",
            dayOffset: 1,
            canonical: "00:30",
        });
    });
});

describe("buildVariantTimetableSchedule", () => {
    it("calculates stop clocks from variant departure anchor, not per-stop source_time_text", () => {
        const schedule = buildVariantTimetableSchedule("05:00", [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            {
                travel_time_from_previous_seconds: 1560,
                waiting_time_seconds: 300,
            },
            { travel_time_from_previous_seconds: 900, waiting_time_seconds: null },
        ]);

        const display = getRouteStopRowTimingDisplayFromSchedule(
            {
                source_time_text: "05:26 AM",
                travel_time_from_previous_seconds: 1560,
            },
            schedule[1]!,
        );
        assert.equal(display.clockTime, "05:26 AM");
        assert.equal(display.arrivalClockTime, "05:26 AM");
        assert.equal(display.departureClockTime, "05:31 AM");
        assert.equal(display.travelLabel, "+26 min");
        assert.equal(display.hasClockData, true);
        assert.equal(display.hasTravelData, true);
    });

    it("shows — for all clocks when departure anchor is missing", () => {
        const schedule = buildVariantTimetableSchedule(null, [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 180, waiting_time_seconds: 0 },
        ]);

        const firstStop = getRouteStopRowTimingDisplayFromSchedule(
            {
                source_time_text: "04:45 PM",
                travel_time_from_previous_seconds: null,
                waiting_time_seconds: null,
            },
            schedule[0]!,
        );
        assert.equal(firstStop.clockTime, TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.equal(firstStop.departureClockTime, TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.equal(firstStop.arrivalClockTime, TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.equal(firstStop.hasClockData, false);

        const secondStop = getRouteStopRowTimingDisplayFromSchedule(
            {
                travel_time_from_previous_seconds: 180,
                waiting_time_seconds: 0,
            },
            schedule[1]!,
        );
        assert.equal(secondStop.clockTime, TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.equal(secondStop.arrivalClockTime, TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.equal(secondStop.departureClockTime, TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.equal(secondStop.hasClockData, false);
    });

    it("uses variant departure time for the first stop", () => {
        const schedule = buildVariantTimetableSchedule("05:00", [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
        ]);
        const display = getRouteStopRowTimingDisplayFromSchedule(
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            schedule[0]!,
        );
        assert.equal(display.clockTime, "05:00 AM");
        assert.equal(display.hasClockData, true);
    });

    it("calculates middle-stop clock time from offsets", () => {
        const schedule = buildVariantTimetableSchedule("05:00", [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 1560, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 900, waiting_time_seconds: null },
        ]);
        const display = getRouteStopRowTimingDisplayFromSchedule(
            { travel_time_from_previous_seconds: 1560 },
            schedule[1]!,
        );
        assert.equal(display.clockTime, "05:26 AM");
        assert.equal(display.arrivalClockTime, "05:26 AM");
        assert.equal(display.departureClockTime, "05:26 AM");
    });

    it("uses placeholders when database values are null", () => {
        const schedule = buildVariantTimetableSchedule(null, [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
        ]);
        const display = getRouteStopRowTimingDisplayFromSchedule({}, schedule[1]!);
        assert.equal(display.clockTime, TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.equal(display.travelLabel, ROUTE_STOP_TRAVEL_PLACEHOLDER);
        assert.equal(display.hasClockData, false);
        assert.equal(display.hasTravelData, false);
        assert.equal(display.isTravelMissing, true);
    });

    it("shows stored zero travel separately from missing travel", () => {
        const schedule = buildVariantTimetableSchedule(null, [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 0, waiting_time_seconds: null },
        ]);
        const display = getRouteStopRowTimingDisplayFromSchedule(
            { travel_time_from_previous_seconds: 0 },
            schedule[1]!,
        );
        assert.equal(display.travelLabel, "+0 min");
        assert.equal(display.hasTravelData, true);
        assert.equal(display.isTravelMissing, false);
    });
});

describe("getCalculatedTimetableRowSegments", () => {
    it("formats first stop as departure only", () => {
        const schedule = buildVariantTimetableSchedule("05:00", [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
        ]);
        const segments = getCalculatedTimetableRowSegments(
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            schedule[0]!,
        );
        assert.deepEqual(segments, [{ text: "Departure 05:00 AM" }]);
    });

    it("formats middle stop with arrival, departure, and travel", () => {
        const schedule = buildVariantTimetableSchedule("05:00", [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 1560, waiting_time_seconds: 240 },
            { travel_time_from_previous_seconds: 900, waiting_time_seconds: null },
        ]);
        const segments = getCalculatedTimetableRowSegments(
            { travel_time_from_previous_seconds: 1560 },
            schedule[1]!,
        );
        assert.deepEqual(segments, [
            { text: "Arr 05:26 AM" },
            { text: "Dep 05:30 AM" },
            { text: "+26 min travel", muted: true },
        ]);
    });

    it("formats final stop as arrival only", () => {
        const schedule = buildVariantTimetableSchedule("05:00", [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 48600, waiting_time_seconds: null },
        ]);
        const segments = getCalculatedTimetableRowSegments(
            { travel_time_from_previous_seconds: 48600, waiting_time_seconds: null },
            schedule[1]!,
        );
        assert.deepEqual(segments, [{ text: "Arrival 06:30 PM" }]);
    });
});

describe("hasExplicitVariantDepartureTime", () => {
    it("is true only for stored canonical values", () => {
        assert.equal(hasExplicitVariantDepartureTime("16:45"), true);
        assert.equal(hasExplicitVariantDepartureTime("04:45 PM"), false);
        assert.equal(hasExplicitVariantDepartureTime(null), false);
    });
});

describe("formatVariantDepartureTimeForInput", () => {
    it("prefills compact HH:mm inputs from stored canonical anchor", () => {
        assert.equal(formatVariantDepartureTimeForInput("16:45"), "16:45");
        assert.equal(formatVariantDepartureTimeForInput("05:00"), "05:00");
        assert.equal(formatVariantDepartureTimeForInput("04:45 PM"), "");
        assert.equal(formatVariantDepartureTimeForInput(null), "");
    });
});

describe("resolveVariantDepartureAnchor", () => {
    it("accepts strict canonical HH:mm only", () => {
        assert.equal(resolveVariantDepartureAnchor("16:45"), "16:45");
        assert.equal(resolveVariantDepartureAnchor("04:45 PM"), null);
        assert.equal(resolveVariantDepartureAnchor(null), null);
    });
});

describe("formatVariantDepartureTimeDisplay", () => {
    it("returns formatted canonical text or em dash when missing", () => {
        assert.equal(formatVariantDepartureTimeDisplay("05:00"), "05:00 AM");
        assert.equal(formatVariantDepartureTimeDisplay("17:30"), "05:30 PM");
        assert.equal(formatVariantDepartureTimeDisplay("05:00 AM"), TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.equal(formatVariantDepartureTimeDisplay(null), TRANSPORT_TIME_EMPTY_DISPLAY);
    });
});

describe("timing scenarios (dashboard display)", () => {
    it("null anchor shows — in row display and never 00:00 or 12:00 AM", () => {
        const schedule = buildVariantTimetableSchedule(null, [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 600, waiting_time_seconds: 0 },
        ]);

        for (const row of schedule) {
            const display = getRouteStopRowTimingDisplayFromSchedule({}, row);
            assert.equal(display.clockTime, TRANSPORT_TIME_EMPTY_DISPLAY);
            assert.equal(display.departureClockTime, TRANSPORT_TIME_EMPTY_DISPLAY);
            assert.equal(display.arrivalClockTime, TRANSPORT_TIME_EMPTY_DISPLAY);
            assert.equal(display.hasClockData, false);
            assert.notEqual(display.clockTime, "00:00");
            assert.notEqual(display.clockTime, "12:00 AM");
        }
    });

    it("bus with no timing uses placeholders only", () => {
        const schedule = buildVariantTimetableSchedule(null, [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
        ]);
        const middle = getRouteStopRowTimingDisplayFromSchedule(
            { travel_time_from_previous_seconds: null },
            schedule[1]!,
        );
        assert.equal(middle.clockTime, TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.equal(middle.travelLabel, ROUTE_STOP_TRAVEL_PLACEHOLDER);
        assert.equal(middle.hasClockData, false);
    });

    it("train with complete timing renders calculated row segments", () => {
        const schedule = buildVariantTimetableSchedule("16:45", [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 26 * 60, waiting_time_seconds: 5 * 60 },
            { travel_time_from_previous_seconds: 45 * 60, waiting_time_seconds: null },
        ]);

        assert.deepEqual(
            getCalculatedTimetableRowSegments(
                { travel_time_from_previous_seconds: null },
                schedule[0]!,
            ),
            [{ text: "Departure 04:45 PM" }],
        );
        assert.deepEqual(
            getCalculatedTimetableRowSegments(
                { travel_time_from_previous_seconds: 26 * 60 },
                schedule[1]!,
            ),
            [
                { text: "Arr 05:11 PM" },
                { text: "Dep 05:16 PM" },
                { text: "+26 min travel", muted: true },
            ],
        );
        assert.deepEqual(
            getCalculatedTimetableRowSegments(
                { travel_time_from_previous_seconds: 45 * 60 },
                schedule[2]!,
            ),
            [{ text: "Arrival 06:01 PM" }],
        );
    });

    it("circular train closing row shows arrival only", () => {
        const schedule = buildVariantTimetableSchedule("05:00", [
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 30 * 60, waiting_time_seconds: 5 * 60 },
            { travel_time_from_previous_seconds: 25 * 60, waiting_time_seconds: null },
        ]);

        const opening = getRouteStopRowTimingDisplayFromSchedule(
            { source_time_text: "05:00 AM", travel_time_from_previous_seconds: null },
            schedule[0]!,
        );
        const closing = getRouteStopRowTimingDisplayFromSchedule(
            {
                source_time_text: "07:00 AM",
                travel_time_from_previous_seconds: 25 * 60,
            },
            schedule[2]!,
        );

        assert.equal(opening.departureClockTime, "05:00 AM");
        assert.equal(closing.arrivalClockTime, "06:00 AM");
        assert.equal(closing.departureClockTime, TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.notEqual(closing.arrivalClockTime, "07:00 AM");
    });
});

describe("validateCanonicalTime", () => {
    it("accepts strict HH:mm only", () => {
        assert.equal(validateCanonicalTime("05:00"), true);
        assert.equal(validateCanonicalTime("5:00"), false);
        assert.equal(validateCanonicalTime("05:00 AM"), false);
    });
});
