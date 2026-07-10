import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildRouteStopTimingRequestBody,
    draftFromRouteStop,
    draftHasPersistableChanges,
    draftHasTimingPayload,
    getStopTimingEditorClockDisplay,
    isDraftTravelMissing,
    isDraftWaitingMissing,
    minutesInputToSeconds,
    previewRouteStopTimingClocks,
    secondsToEditableMinutesInput,
    secondsToMinutesInput,
} from "./routeStopTimingEditor.js";
import {
    buildVariantTimetableSchedule,
    getRouteStopRowTimingDisplayFromSchedule,
} from "./routeStopTimetableDisplay.js";

const baseStop = {
    id: "rs-1",
    stop_sequence: 2,
    is_timing_point: true,
    geometry_source: null,
    stop: {
        public_id: "stop-1",
        name_mm: "A",
        name_en: "A",
        review_status: "needs_review",
        geometry: null,
    },
} as const;

describe("routeStopTimingEditor", () => {
    it("converts seconds to minute inputs and back", () => {
        assert.equal(secondsToMinutesInput(1560), "26");
        assert.equal(minutesInputToSeconds("26"), 1560);
        assert.equal(minutesInputToSeconds(""), null);
        assert.equal(minutesInputToSeconds("0"), 0);
    });

    it("shows 0 visually for null editable values", () => {
        assert.equal(secondsToEditableMinutesInput(null), "0");
        assert.equal(secondsToEditableMinutesInput(0), "0");
        assert.equal(secondsToEditableMinutesInput(300), "5");
    });

    it("tracks missing vs stored zero in draft state", () => {
        const missingDraft = draftFromRouteStop({
            ...baseStop,
            travel_time_from_previous_seconds: null,
            waiting_time_seconds: null,
        } as never);
        assert.equal(isDraftTravelMissing(missingDraft), true);
        assert.equal(isDraftWaitingMissing(missingDraft), true);

        const zeroDraft = draftFromRouteStop({
            ...baseStop,
            travel_time_from_previous_seconds: 0,
            waiting_time_seconds: 0,
        } as never);
        assert.equal(isDraftTravelMissing(zeroDraft), false);
        assert.equal(isDraftWaitingMissing(zeroDraft), false);
    });

    it("builds timing PATCH bodies from touched draft values", () => {
        const draft = {
            ...draftFromRouteStop({
                ...baseStop,
                travel_time_from_previous_seconds: 1560,
                waiting_time_seconds: 300,
            } as never),
            travelTouched: true,
            waitingTouched: true,
        };

        assert.equal(draft.travelMinutes, "26");
        assert.equal(draft.waitingMinutes, "5");
        assert.deepEqual(buildRouteStopTimingRequestBody(draft), {
            travelTimeFromPreviousSeconds: 1560,
            waitingTimeSeconds: 300,
        });
    });

    it("keeps null DB values out of PATCH until the user edits", () => {
        const draft = draftFromRouteStop({
            ...baseStop,
            travel_time_from_previous_seconds: null,
            waiting_time_seconds: null,
        } as never);

        assert.equal(draft.travelMinutes, "0");
        assert.equal(draft.waitingMinutes, "0");
        assert.equal(draft.travelOriginallyNull, true);
        assert.equal(draft.waitingOriginallyNull, true);
        assert.deepEqual(buildRouteStopTimingRequestBody(draft), {});
        assert.equal(draftHasTimingPayload(draft), false);
        assert.equal(
            draftHasPersistableChanges(draft, {
                ...baseStop,
                travel_time_from_previous_seconds: null,
                waiting_time_seconds: null,
            } as never),
            false,
        );
    });

    it("persists explicit zero separately from unchanged null", () => {
        const explicitZeroDraft = {
            ...draftFromRouteStop({
                ...baseStop,
                travel_time_from_previous_seconds: null,
                waiting_time_seconds: null,
            } as never),
            travelMinutes: "0",
            travelTouched: true,
        };

        assert.deepEqual(buildRouteStopTimingRequestBody(explicitZeroDraft), {
            travelTimeFromPreviousSeconds: 0,
        });
        assert.equal(
            draftHasPersistableChanges(explicitZeroDraft, {
                ...baseStop,
                travel_time_from_previous_seconds: null,
                waiting_time_seconds: null,
            } as never),
            true,
        );

        const storedZeroDraft = draftFromRouteStop({
            ...baseStop,
            travel_time_from_previous_seconds: 0,
            waiting_time_seconds: null,
        } as never);
        assert.deepEqual(buildRouteStopTimingRequestBody(storedZeroDraft), {});
        assert.equal(
            draftHasPersistableChanges(storedZeroDraft, {
                ...baseStop,
                travel_time_from_previous_seconds: 0,
                waiting_time_seconds: null,
            } as never),
            false,
        );
    });

    it("persists a positive value only after the user edits a previously null field", () => {
        const draft = {
            ...draftFromRouteStop({
                ...baseStop,
                travel_time_from_previous_seconds: null,
                waiting_time_seconds: null,
            } as never),
            travelMinutes: "26",
            travelTouched: true,
        };

        assert.deepEqual(buildRouteStopTimingRequestBody(draft), {
            travelTimeFromPreviousSeconds: 1560,
        });
        assert.equal(draftHasTimingPayload(draft), true);
    });

    it("previews calculated arrival and departure clocks from draft inputs", () => {
        const stops = [
            {
                travel_time_from_previous_seconds: null,
                waiting_time_seconds: null,
            },
            {
                travel_time_from_previous_seconds: null,
                waiting_time_seconds: null,
            },
        ];
        const missingDraft = draftFromRouteStop({
            ...baseStop,
            travel_time_from_previous_seconds: null,
            waiting_time_seconds: null,
        } as never);
        const missingPreview = previewRouteStopTimingClocks(
            stops,
            1,
            missingDraft,
            "05:00",
        );
        assert.equal(missingPreview.arrival, "—");
        assert.equal(missingPreview.departure, "—");
        assert.equal(missingPreview.hasArrivalClockData, false);
        assert.equal(missingPreview.hasDepartureClockData, false);

        const draft = {
            ...missingDraft,
            travelMinutes: "26",
            travelTouched: true,
            waitingMinutes: "4",
            waitingTouched: true,
        };
        const preview = previewRouteStopTimingClocks(stops, 1, draft, "05:00");

        assert.equal(preview.arrival, "05:26 AM");
        assert.equal(preview.departure, "—");
        assert.equal(preview.hasArrivalClockData, true);
        assert.equal(preview.hasDepartureClockData, false);
    });

    it("matches ordered stop row clocks when draft is unchanged", () => {
        const stops = [
            {
                travel_time_from_previous_seconds: null,
                waiting_time_seconds: null,
            },
            {
                travel_time_from_previous_seconds: 1560,
                waiting_time_seconds: 300,
            },
            {
                travel_time_from_previous_seconds: 900,
                waiting_time_seconds: null,
            },
        ] as const;

        const schedule = buildVariantTimetableSchedule("05:00", [...stops]);
        const rowDisplay = getRouteStopRowTimingDisplayFromSchedule(stops[1]!, schedule[1]!);
        const editorDisplay = getStopTimingEditorClockDisplay(stops[1]!, schedule[1]!);
        const draft = draftFromRouteStop({
            ...baseStop,
            travel_time_from_previous_seconds: 1560,
            waiting_time_seconds: 300,
        } as never);
        const previewDisplay = previewRouteStopTimingClocks(stops, 1, draft, "05:00");

        assert.equal(editorDisplay.arrival, rowDisplay.arrivalClockTime);
        assert.equal(editorDisplay.departure, rowDisplay.departureClockTime);
        assert.equal(previewDisplay.arrival, rowDisplay.arrivalClockTime);
        assert.equal(previewDisplay.departure, rowDisplay.departureClockTime);
        assert.equal(rowDisplay.clockTime, "05:26 AM");
    });

    it("first stop departure matches variant anchor in editor preview", () => {
        const stops = [
            {
                travel_time_from_previous_seconds: null,
                waiting_time_seconds: null,
            },
        ] as const;
        const schedule = buildVariantTimetableSchedule("16:45", [...stops]);
        const draft = draftFromRouteStop({
            ...baseStop,
            stop_sequence: 1,
            travel_time_from_previous_seconds: null,
            waiting_time_seconds: null,
        } as never);
        const preview = previewRouteStopTimingClocks(stops, 0, draft, "16:45");

        assert.equal(preview.arrival, "—");
        assert.equal(preview.departure, "04:45 PM");
        assert.equal(schedule[0]?.calculatedDepartureTime, "04:45 PM");
    });
});
