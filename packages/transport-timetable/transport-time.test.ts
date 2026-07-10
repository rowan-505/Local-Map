import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    TRANSPORT_TIME_EMPTY_DISPLAY,
    addSecondsToCanonicalTime,
    formatCanonicalTimeForDisplay,
    hasExplicitVariantDepartureTime,
    isValidTransportTimeInput,
    parseSourceTimeToCanonical,
    parseTimeInputToCanonical,
    resolveTimeAnchorToCanonical,
    resolveVariantDepartureAnchor,
    validateCanonicalTime,
} from "./transport-time.js";

describe("parseSourceTimeToCanonical", () => {
    it("parses valid 12-hour source values", () => {
        assert.equal(parseSourceTimeToCanonical("04:45 PM"), "16:45");
        assert.equal(parseSourceTimeToCanonical("05:00 AM"), "05:00");
        assert.equal(parseSourceTimeToCanonical("12:30 PM"), "12:30");
        assert.equal(parseSourceTimeToCanonical("12:30 AM"), "00:30");
        assert.equal(parseSourceTimeToCanonical("12:00 AM"), "00:00");
        assert.equal(parseSourceTimeToCanonical("12:00 PM"), "12:00");
    });

    it("rejects malformed and non-12-hour values", () => {
        assert.equal(parseSourceTimeToCanonical(""), null);
        assert.equal(parseSourceTimeToCanonical("16:45"), null);
        assert.equal(parseSourceTimeToCanonical("05:00"), null);
        assert.equal(parseSourceTimeToCanonical("9:00 AM / 9:10 AM"), null);
        assert.equal(parseSourceTimeToCanonical("25:00 AM"), null);
        assert.equal(parseSourceTimeToCanonical("13:00 PM"), null);
        assert.equal(parseSourceTimeToCanonical("00:30 AM"), null);
        assert.equal(parseSourceTimeToCanonical("5 PM"), null);
        assert.equal(parseSourceTimeToCanonical("bad"), null);
    });
});

describe("validateCanonicalTime", () => {
    it("accepts strict HH:mm from 00:00 through 23:59", () => {
        assert.equal(validateCanonicalTime("00:00"), true);
        assert.equal(validateCanonicalTime("05:00"), true);
        assert.equal(validateCanonicalTime("16:45"), true);
        assert.equal(validateCanonicalTime("23:59"), true);
    });

    it("rejects non-strict values", () => {
        assert.equal(validateCanonicalTime("5:00"), false);
        assert.equal(validateCanonicalTime("24:00"), false);
        assert.equal(validateCanonicalTime("05:00 AM"), false);
        assert.equal(validateCanonicalTime(""), false);
    });
});

describe("formatCanonicalTimeForDisplay", () => {
    it("formats canonical values and uses — for missing", () => {
        assert.equal(formatCanonicalTimeForDisplay(null), TRANSPORT_TIME_EMPTY_DISPLAY);
        assert.equal(formatCanonicalTimeForDisplay("16:45"), "04:45 PM");
        assert.equal(formatCanonicalTimeForDisplay("05:00"), "05:00 AM");
        assert.equal(formatCanonicalTimeForDisplay("00:00"), "12:00 AM");
        assert.equal(formatCanonicalTimeForDisplay("bad"), TRANSPORT_TIME_EMPTY_DISPLAY);
    });
});

describe("addSecondsToCanonicalTime", () => {
    it("adds offsets on the same day", () => {
        assert.deepEqual(addSecondsToCanonicalTime("16:45", 180), {
            displayTime: "04:48 PM",
            dayOffset: 0,
            canonical: "16:48",
        });
        assert.deepEqual(addSecondsToCanonicalTime("05:00", 1560), {
            displayTime: "05:26 AM",
            dayOffset: 0,
            canonical: "05:26",
        });
    });

    it("supports midnight crossing", () => {
        assert.deepEqual(addSecondsToCanonicalTime("23:30", 3600), {
            displayTime: "12:30 AM",
            dayOffset: 1,
            canonical: "00:30",
        });
        assert.deepEqual(addSecondsToCanonicalTime("23:50", 20 * 60), {
            displayTime: "12:10 AM",
            dayOffset: 1,
            canonical: "00:10",
        });
        assert.deepEqual(addSecondsToCanonicalTime("23:55", 70 * 60), {
            displayTime: "01:05 AM",
            dayOffset: 1,
            canonical: "01:05",
        });
    });

    it("rejects invalid anchors", () => {
        assert.equal(addSecondsToCanonicalTime("04:45 PM", 0), null);
        assert.equal(addSecondsToCanonicalTime("bad", 0), null);
    });
});

describe("resolveVariantDepartureAnchor", () => {
    it("returns canonical departure_time_text only", () => {
        assert.equal(resolveVariantDepartureAnchor("16:45"), "16:45");
        assert.equal(resolveVariantDepartureAnchor("05:00"), "05:00");
    });

    it("rejects non-canonical stored values", () => {
        assert.equal(resolveVariantDepartureAnchor("04:45 PM"), null);
        assert.equal(resolveVariantDepartureAnchor(null), null);
        assert.equal(resolveVariantDepartureAnchor(""), null);
    });
});

describe("hasExplicitVariantDepartureTime", () => {
    it("detects only canonical stored departure_time_text values", () => {
        assert.equal(hasExplicitVariantDepartureTime("16:45"), true);
        assert.equal(hasExplicitVariantDepartureTime("04:45 PM"), false);
        assert.equal(hasExplicitVariantDepartureTime("  "), false);
        assert.equal(hasExplicitVariantDepartureTime(null), false);
    });
});

describe("resolveTimeAnchorToCanonical", () => {
    it("accepts canonical or source text", () => {
        assert.equal(resolveTimeAnchorToCanonical("16:45"), "16:45");
        assert.equal(resolveTimeAnchorToCanonical("04:45 PM"), "16:45");
    });

    it("normalizes user input through one entry point", () => {
        assert.equal(parseTimeInputToCanonical("05:00 AM"), "05:00");
        assert.equal(parseTimeInputToCanonical("17:30"), "17:30");
        assert.equal(isValidTransportTimeInput("05:00 AM"), true);
        assert.equal(isValidTransportTimeInput("bad"), false);
    });
});
