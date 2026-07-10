import {
    buildVariantTimetableSchedule,
    getRouteStopRowTimingDisplayFromSchedule,
    type VariantTimetableStopSchedule,
} from "./routeStopTimetableDisplay";
import { ROUTE_STOP_MINUTES_PLACEHOLDER_DISPLAY } from "./routeStopTimingDisplay";
import type { PatchRouteStopTimingBody, TransportRouteStopItem } from "./types";

export type RouteStopTimingDraft = {
    readonly travelMinutes: string;
    readonly waitingMinutes: string;
    readonly travelOriginallyNull: boolean;
    readonly waitingOriginallyNull: boolean;
    readonly travelTouched: boolean;
    readonly waitingTouched: boolean;
};

export function secondsToMinutesInput(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
        return "";
    }
    return String(Math.round(seconds / 60));
}

/** Visual minute input: null DB values display as 0 without persisting until edited. */
export function secondsToEditableMinutesInput(
    seconds: number | null | undefined,
    options?: { readonly defaultWhenNull?: string },
): string {
    const defaultWhenNull = options?.defaultWhenNull ?? ROUTE_STOP_MINUTES_PLACEHOLDER_DISPLAY;
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
        return defaultWhenNull;
    }
    return String(Math.round(seconds / 60));
}

export function isDraftTravelMissing(draft: RouteStopTimingDraft): boolean {
    return !draft.travelTouched && draft.travelOriginallyNull;
}

export function isDraftWaitingMissing(draft: RouteStopTimingDraft): boolean {
    return !draft.waitingTouched && draft.waitingOriginallyNull;
}

export function minutesInputToSeconds(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const minutes = Number(trimmed);
    if (!Number.isFinite(minutes) || minutes < 0) {
        return null;
    }
    return Math.round(minutes * 60);
}

export function draftFromRouteStop(stop: TransportRouteStopItem): RouteStopTimingDraft {
    const travelOriginallyNull =
        stop.travel_time_from_previous_seconds === null ||
        stop.travel_time_from_previous_seconds === undefined;
    const waitingOriginallyNull =
        stop.waiting_time_seconds === null || stop.waiting_time_seconds === undefined;

    return {
        travelMinutes: secondsToEditableMinutesInput(stop.travel_time_from_previous_seconds),
        waitingMinutes: secondsToEditableMinutesInput(stop.waiting_time_seconds),
        travelOriginallyNull,
        waitingOriginallyNull,
        travelTouched: false,
        waitingTouched: false,
    };
}

function draftTravelSeconds(
    draft: RouteStopTimingDraft,
    includeTravelField: boolean,
): number | null {
    if (!includeTravelField) {
        return null;
    }
    if (!draft.travelTouched && draft.travelOriginallyNull) {
        return null;
    }
    return minutesInputToSeconds(draft.travelMinutes);
}

function draftWaitingSeconds(
    draft: RouteStopTimingDraft,
    includeWaitingField: boolean,
): number | null {
    if (!includeWaitingField) {
        return null;
    }
    if (!draft.waitingTouched && draft.waitingOriginallyNull) {
        return null;
    }
    return minutesInputToSeconds(draft.waitingMinutes);
}

/** PATCH body includes only fields the user edited. Untouched nulls are omitted. */
export function buildRouteStopTimingRequestBody(
    draft: RouteStopTimingDraft,
): PatchRouteStopTimingBody {
    const body: PatchRouteStopTimingBody = {};

    if (draft.travelTouched) {
        body.travelTimeFromPreviousSeconds = minutesInputToSeconds(draft.travelMinutes);
    }
    if (draft.waitingTouched) {
        body.waitingTimeSeconds = minutesInputToSeconds(draft.waitingMinutes);
    }

    return body;
}

/** True when the draft would send at least one timing field to the API. */
export function draftHasTimingPayload(draft: RouteStopTimingDraft): boolean {
    const body = buildRouteStopTimingRequestBody(draft);
    return (
        body.travelTimeFromPreviousSeconds !== undefined ||
        body.waitingTimeSeconds !== undefined
    );
}

export function draftHasPersistableChanges(
    draft: RouteStopTimingDraft,
    stop: TransportRouteStopItem,
): boolean {
    if (draft.travelTouched) {
        const next = minutesInputToSeconds(draft.travelMinutes);
        if (next !== (stop.travel_time_from_previous_seconds ?? null)) {
            return true;
        }
    }
    if (draft.waitingTouched) {
        const next = minutesInputToSeconds(draft.waitingMinutes);
        if (next !== (stop.waiting_time_seconds ?? null)) {
            return true;
        }
    }
    return false;
}

export function routeStopTimingRequestEquals(
    left: PatchRouteStopTimingBody,
    right: PatchRouteStopTimingBody,
): boolean {
    return (
        left.travelTimeFromPreviousSeconds === right.travelTimeFromPreviousSeconds &&
        left.waitingTimeSeconds === right.waitingTimeSeconds
    );
}

export type RouteStopTimingClockPreview = {
    readonly arrival: string;
    readonly departure: string;
    readonly hasArrivalClockData: boolean;
    readonly hasDepartureClockData: boolean;
};

type TimingStopInput = Pick<
    TransportRouteStopItem,
    "travel_time_from_previous_seconds" | "waiting_time_seconds"
>;

/** Maps one shared schedule row to the selected-stop editor read-only clocks. */
export function getStopTimingEditorClockDisplay(
    routeStop: TimingStopInput,
    scheduleRow: VariantTimetableStopSchedule,
): RouteStopTimingClockPreview {
    const display = getRouteStopRowTimingDisplayFromSchedule(routeStop, scheduleRow);
    return {
        arrival: display.arrivalClockTime,
        departure: display.departureClockTime,
        hasArrivalClockData: display.hasArrivalClockData,
        hasDepartureClockData: display.hasDepartureClockData,
    };
}

/** Builds a full variant schedule with draft travel/waiting applied to one stop. */
export function buildVariantTimetableScheduleWithDraft(
    departureTimeText: string | null | undefined,
    stops: readonly TimingStopInput[],
    stopIndex: number,
    draft: RouteStopTimingDraft,
): VariantTimetableStopSchedule[] {
    const inputs = stops.map((row, index) => {
        if (index !== stopIndex) {
            return {
                travel_time_from_previous_seconds: row.travel_time_from_previous_seconds ?? null,
                waiting_time_seconds: row.waiting_time_seconds ?? null,
            };
        }

        const isFirst = index === 0;
        const isLast = index === stops.length - 1;
        return {
            travel_time_from_previous_seconds: draftTravelSeconds(draft, !isFirst),
            waiting_time_seconds: draftWaitingSeconds(draft, !isLast),
        };
    });

    return buildVariantTimetableSchedule(departureTimeText, inputs);
}

/** Client-side preview of calculated clocks from editable inputs (offsets are not edited). */
export function previewRouteStopTimingClocks(
    stops: readonly TimingStopInput[],
    stopIndex: number,
    draft: RouteStopTimingDraft,
    departureTimeText: string | null | undefined,
): RouteStopTimingClockPreview {
    const schedule = buildVariantTimetableScheduleWithDraft(
        departureTimeText,
        stops,
        stopIndex,
        draft,
    );
    const scheduleRow = schedule[stopIndex];
    if (!scheduleRow) {
        return {
            arrival: "—",
            departure: "—",
            hasArrivalClockData: false,
            hasDepartureClockData: false,
        };
    }

    const isFirst = stopIndex === 0;
    const isLast = stopIndex === stops.length - 1;
    const inputRow = {
        travel_time_from_previous_seconds: draftTravelSeconds(draft, !isFirst),
        waiting_time_seconds: draftWaitingSeconds(draft, !isLast),
    };

    return getStopTimingEditorClockDisplay(inputRow, scheduleRow);
}
