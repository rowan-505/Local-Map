import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ROUTE_STOP_EMPTY_DISPLAY,
    ROUTE_STOP_TRAVEL_PLACEHOLDER,
    durationMinutesHint,
    formatClockTime,
    formatInterval,
    formatOffset,
    formatSourceTimeProvenance,
    formatTravelFromPrevious,
    getRouteStopDisplayTime,
    getRouteStopSourceProvenance,
    getRouteStopSourceProvenanceSegments,
    getRouteStopTimingLineSegments,
    getRouteStopTimingTypeBadge,
    hasStoredTimingSeconds,
    isTimingSecondsMissing,
    routeStopHasSourceProvenanceData,
    routeStopHasTimingDisplayData,
} from "./routeStopTimingDisplay.js";

describe("formatSourceTimeProvenance", () => {
    it("returns em dash for null/empty", () => {
        assert.equal(formatSourceTimeProvenance(null), ROUTE_STOP_EMPTY_DISPLAY);
        assert.equal(formatSourceTimeProvenance(undefined), ROUTE_STOP_EMPTY_DISPLAY);
        assert.equal(formatSourceTimeProvenance("   "), ROUTE_STOP_EMPTY_DISPLAY);
    });

    it("returns trimmed source text unchanged", () => {
        assert.equal(formatSourceTimeProvenance("  05:26 AM  "), "05:26 AM");
        assert.equal(formatSourceTimeProvenance("09:00 AM / 09:10 AM"), "09:00 AM / 09:10 AM");
        assert.equal(formatSourceTimeProvenance("04:45 PM"), "04:45 PM");
    });
});

describe("formatClockTime", () => {
    it("aliases formatSourceTimeProvenance", () => {
        assert.equal(formatClockTime(null), ROUTE_STOP_EMPTY_DISPLAY);
        assert.equal(formatClockTime("  05:26 AM  "), "05:26 AM");
        assert.equal(formatClockTime("09:00 AM / 09:10 AM"), "09:00 AM / 09:10 AM");
    });
});

describe("formatInterval", () => {
    it("returns em dash for missing values", () => {
        assert.equal(formatInterval(null), ROUTE_STOP_EMPTY_DISPLAY);
        assert.equal(formatInterval(undefined), ROUTE_STOP_EMPTY_DISPLAY);
    });

    it("formats minutes and hours without raw seconds", () => {
        assert.equal(formatInterval(1560), "+26 min");
        assert.equal(formatInterval(4200), "+1 hr 10 min");
        assert.equal(formatInterval(3600), "+1 hr");
        assert.equal(formatInterval(0), "+0 min");
    });
});

describe("formatTravelFromPrevious", () => {
    it("uses +00 min placeholder for null values", () => {
        assert.equal(formatTravelFromPrevious(null), ROUTE_STOP_TRAVEL_PLACEHOLDER);
        assert.equal(formatTravelFromPrevious(undefined), ROUTE_STOP_TRAVEL_PLACEHOLDER);
        assert.equal(isTimingSecondsMissing(null), true);
        assert.equal(hasStoredTimingSeconds(null), false);
    });

    it("formats stored values including zero", () => {
        assert.equal(formatTravelFromPrevious(1560), "+26 min");
        assert.equal(formatTravelFromPrevious(0), "+0 min");
        assert.equal(hasStoredTimingSeconds(0), true);
        assert.equal(isTimingSecondsMissing(0), false);
    });
});

describe("durationMinutesHint", () => {
    it("does not treat missing placeholder input as stored zero", () => {
        assert.equal(durationMinutesHint("0", { isMissing: true }), null);
        assert.equal(durationMinutesHint("0", { isMissing: false }), "+0 min");
    });
});

describe("formatOffset", () => {
    it("uses the same signed duration style as intervals", () => {
        assert.equal(formatOffset(null), ROUTE_STOP_EMPTY_DISPLAY);
        assert.equal(formatOffset(1560), "+26 min");
        assert.equal(formatOffset(4200), "+1 hr 10 min");
    });
});

describe("getRouteStopSourceProvenance", () => {
    it("maps imported source and stored offsets for diagnostics", () => {
        const provenance = getRouteStopSourceProvenance({
            source_time_text: "05:26 AM",
            source_time_type: "unknown",
            travel_time_from_previous_seconds: 1560,
            arrival_offset_seconds: 3600,
            departure_offset_seconds: 3900,
        });

        assert.equal(provenance.importedSourceTime, "05:26 AM");
        assert.equal(provenance.travelFromPrevious, "+26 min");
        assert.equal(provenance.sourceTimeType, "unknown");
        assert.equal(provenance.arrivalOffset, "+1 hr");
        assert.equal(provenance.departureOffset, "+1 hr 5 min");
    });
});

describe("getRouteStopDisplayTime", () => {
    it("maps all timing fields to display labels", () => {
        const display = getRouteStopDisplayTime({
            source_time_text: "05:26 AM",
            source_time_type: "unknown",
            travel_time_from_previous_seconds: 1560,
            arrival_offset_seconds: 3600,
            departure_offset_seconds: 3900,
        });

        assert.equal(display.clockTime, "05:26 AM");
        assert.equal(display.intervalFromPrevious, "+26 min");
        assert.equal(display.timeType, "unknown");
        assert.equal(display.arrivalOffset, "+1 hr");
        assert.equal(display.departureOffset, "+1 hr 5 min");
    });

    it("uses em dash for null fields", () => {
        const display = getRouteStopDisplayTime({});
        assert.equal(display.clockTime, ROUTE_STOP_EMPTY_DISPLAY);
        assert.equal(display.intervalFromPrevious, ROUTE_STOP_EMPTY_DISPLAY);
        assert.equal(display.timeType, ROUTE_STOP_EMPTY_DISPLAY);
    });
});

describe("getRouteStopSourceProvenanceSegments", () => {
    it("builds import provenance segments without operational clock labels", () => {
        const segments = getRouteStopSourceProvenanceSegments({
            source_time_text: "05:26 AM",
            source_time_type: "unknown",
            travel_time_from_previous_seconds: 1560,
        });

        assert.deepEqual(segments, [
            { text: "Import 05:26 AM", muted: true },
            { text: "+26 min", muted: true },
        ]);
    });

    it("omits empty segments", () => {
        assert.deepEqual(getRouteStopSourceProvenanceSegments({}), []);
        assert.equal(
            routeStopHasSourceProvenanceData({ source_time_text: "06:00 AM" }),
            true,
        );
    });
});

describe("getRouteStopTimingLineSegments", () => {
    it("aliases getRouteStopSourceProvenanceSegments", () => {
        const segments = getRouteStopTimingLineSegments({
            source_time_text: "05:26 AM",
            travel_time_from_previous_seconds: 1560,
        });

        assert.deepEqual(segments, [
            { text: "Import 05:26 AM", muted: true },
            { text: "+26 min", muted: true },
        ]);
    });
});

describe("getRouteStopTimingTypeBadge", () => {
    it("returns labels only for arrival and departure types", () => {
        assert.equal(getRouteStopTimingTypeBadge("arrival"), "arrival");
        assert.equal(getRouteStopTimingTypeBadge("departure"), "departure");
        assert.equal(getRouteStopTimingTypeBadge("arrival_departure"), "arr · dep");
    });

    it("returns null for unknown or empty types", () => {
        assert.equal(getRouteStopTimingTypeBadge("unknown"), null);
        assert.equal(getRouteStopTimingTypeBadge(null), null);
        assert.equal(getRouteStopTimingTypeBadge("   "), null);
    });

    it("does not count unknown-only rows as timing data", () => {
        assert.equal(routeStopHasTimingDisplayData({ source_time_type: "unknown" }), false);
        assert.equal(
            routeStopHasTimingDisplayData({
                source_time_type: "departure",
                source_time_text: "06:00 AM",
            }),
            true,
        );
    });
});
